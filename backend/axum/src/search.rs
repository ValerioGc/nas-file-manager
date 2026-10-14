//! The index of the search: every file and folder of the disks of the NAS in the database of the
//! application, so the search finds a part of a name at once, anywhere, instead of walking the
//! disks with a limit. The network shares are left out (they say nothing of their changes): their
//! search walks them as before, and so does the one of a disk whose index is not whole yet.
//!
//! The first build reads every folder, among the operations of the NAS. Then each folder is
//! watched with inotify (`notify`), one watch each, and a change in it reads that folder again;
//! a folder that changed time since the index last read it is read again at start, for what
//! happened while the Explorer was off. The application tells the launcher it works in background,
//! so it starts with the NAS and stays on with its window closed.
//!
//! The kernel limits the watches of a user (`fs.inotify.max_user_watches`, read through the
//! launcher): the folders past it are read again every ten minutes, when their time changed. A
//! notification says when the watches reach 80% of the limit and when they pass it, once until it
//! no longer holds. A lost change (the queue of the kernel overflowed) reads every disk again.

use crate::launcher::Launcher;
use fs_core::{Filesystem, CACHE_DIRECTORY, TRASH_DIRECTORY, TRASH_OFF};
use notify::{
    event::{EventKind, ModifyKind},
    Event, RecursiveMode, Watcher,
};
use serde_json::json;
use sqlx::{QueryBuilder, Row, Sqlite, SqlitePool, Transaction};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    fs,
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    sync::{mpsc, RwLock},
    time::Instant,
};

#[cfg(not(test))]
const SETTLE: Duration = Duration::from_secs(1);
#[cfg(test)]
const SETTLE: Duration = Duration::from_millis(100);
const POLL: Duration = Duration::from_secs(10 * 60);
/// The changes waiting at most: past this every disk is read again instead.
const QUEUE: usize = 8192;
/// What one disk gives to a search at most, as when it is walked.
const RESULTS: i64 = 2_000;
/// Names written in one statement.
const BATCH: usize = 400;
/// Folders read before the database takes them, during a build.
const CHUNK: usize = 200;
const TASK: &str = "nas-file-manager-search-index";
/// The kernel dates a folder by a coarse clock: a change right after a reading can leave the same
/// time. A folder this recent is kept without its time, and read again the next time.
const RECENT_NS: i64 = 2_000_000_000;
/// The time of a folder too recent to tell its changes apart.
const UNTRUSTED: i64 = 0;

/// The folders read since the index last did, by the path the machine knows them by, with their time.
type Known = BTreeMap<PathBuf, i64>;

/// A folder whose content changed, or every disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Change {
    Folder(PathBuf),
    Everything,
    /// The index is emptied, and built again.
    Reset,
}

#[derive(Clone)]
pub struct SearchIndex {
    pool: SqlitePool,
    filesystem: Filesystem,
    /// The disks whose index is whole, by their path, with their id.
    ready: Arc<RwLock<HashMap<PathBuf, String>>>,
    changes: mpsc::Sender<Change>,
    overflowed: Arc<AtomicBool>,
}

/// A folder read from the disk: its time, its names (folders marked), and the folders it held
/// before and holds no more, which leave the index with all they held.
#[derive(Debug, PartialEq, Eq)]
pub struct Listing {
    pub folder: PathBuf,
    pub modified_ns: i64,
    pub children: Vec<(String, bool)>,
    pub dropped: Vec<PathBuf>,
}

pub fn modified_ns(metadata: &fs::Metadata) -> i64 {
    metadata
        .mtime()
        .saturating_mul(1_000_000_000)
        .saturating_add(metadata.mtime_nsec())
}

/// Reads what changed under `starts` (a start that is forced is read even with the same time) and
/// hands each folder read to `found`, after the new folders it holds: a folder the index knows has
/// all its folders known too, whenever the work stops. `deep` checks the time of every known folder
/// under the starts as well; otherwise only the starts and what is new under them are read. The
/// links are never followed. A folder changed in the last two seconds keeps no time
/// (`UNTRUSTED`), so it is read again the next time.
pub fn scan(
    starts: &[(PathBuf, bool)],
    mut known: Known,
    deep: bool,
    mut found: impl FnMut(Listing) -> bool,
) -> Known {
    enum Step {
        Visit(PathBuf, bool),
        Emit(Listing),
    }
    let recent = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |time| i64::try_from(time.as_nanos()).unwrap_or(i64::MAX))
        - RECENT_NS;
    let mut steps = Vec::new();
    for (start, forced) in starts {
        if deep {
            steps.extend(
                known
                    .range(start.clone()..)
                    .take_while(|(path, _)| path.starts_with(start))
                    .filter(|(path, _)| *path != start)
                    .map(|(path, _)| Step::Visit(path.clone(), false)),
            );
        }
        steps.push(Step::Visit(start.clone(), *forced));
    }
    while let Some(step) = steps.pop() {
        let (folder, forced) = match step {
            Step::Emit(listing) => {
                if !found(listing) {
                    break;
                }
                continue;
            }
            Step::Visit(folder, forced) => (folder, forced),
        };
        let Some(listing) = read_listing(&folder, forced, &mut known, recent) else {
            continue;
        };
        let new: Vec<PathBuf> = listing
            .children
            .iter()
            .filter(|(_, is_folder)| *is_folder)
            .map(|(name, _)| folder.join(name))
            .filter(|child| !known.contains_key(child))
            .collect();
        known.insert(folder, listing.modified_ns);
        steps.push(Step::Emit(listing));
        steps.extend(new.into_iter().map(|child| Step::Visit(child, false)));
    }
    known
}

/// Reads a changed folder and forgets the known folders it no longer holds.
fn read_listing(folder: &Path, forced: bool, known: &mut Known, recent: i64) -> Option<Listing> {
    let Ok(metadata) = fs::symlink_metadata(folder) else {
        return None;
    };
    let modified = modified_ns(&metadata);
    let modified = if modified > recent {
        UNTRUSTED
    } else {
        modified
    };
    if !metadata.is_dir()
        || (!forced && modified != UNTRUSTED && known.get(folder) == Some(&modified))
    {
        return None;
    }
    let Ok(reader) = fs::read_dir(folder) else {
        return None;
    };
    let children: Vec<(String, bool)> = reader
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let is_folder = entry.file_type().is_ok_and(|kind| kind.is_dir());
            (![CACHE_DIRECTORY, TRASH_DIRECTORY, TRASH_OFF].contains(&name.as_str()))
                .then_some((name, is_folder))
        })
        .collect();
    let held: HashSet<&str> = children
        .iter()
        .filter(|(_, is_folder)| *is_folder)
        .map(|(name, _)| name.as_str())
        .collect();
    let dropped: Vec<PathBuf> = known
        .range(folder.to_path_buf()..)
        .take_while(|(path, _)| path.starts_with(folder))
        .filter(|(path, _)| path.parent() == Some(folder))
        .filter(|(path, _)| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_none_or(|name| !held.contains(name))
        })
        .map(|(path, _)| path.clone())
        .collect();
    for gone in &dropped {
        let under: Vec<PathBuf> = known
            .range(gone.clone()..)
            .take_while(|(path, _)| path.starts_with(gone))
            .map(|(path, _)| path.clone())
            .collect();
        for path in under {
            known.remove(&path);
        }
    }
    Some(Listing {
        folder: folder.to_path_buf(),
        modified_ns: modified,
        children,
        dropped,
    })
}

/// The watches of the folders, and those left to the reading every ten minutes.
#[derive(Default)]
struct Watches {
    watcher: Option<notify::RecommendedWatcher>,
    watched: HashSet<PathBuf>,
    /// Folders without a watch: past the limit, or refused.
    polled: BTreeSet<PathBuf>,
    /// A watch failed for the limit: no other is tried until the next round.
    full: bool,
    /// Folders without a watch because of the limit.
    over: usize,
}

impl Watches {
    /// Watches the known folders, and forgets those gone. Returns the folders watched now.
    fn follow(&mut self, known: &Known) -> Vec<PathBuf> {
        let mut added = Vec::new();
        let Some(watcher) = self.watcher.as_mut() else {
            return added;
        };
        self.watched.retain(|path| {
            known.contains_key(path) || {
                let _ = watcher.unwatch(path);
                false
            }
        });
        self.polled.retain(|path| known.contains_key(path));
        for path in known.keys() {
            if self.watched.contains(path) || self.polled.contains(path) {
                continue;
            }
            if self.full {
                self.polled.insert(path.clone());
                self.over += 1;
                continue;
            }
            match watcher.watch(path, RecursiveMode::NonRecursive) {
                Ok(()) => {
                    self.watched.insert(path.clone());
                    added.push(path.clone());
                }
                Err(error) => {
                    if matches!(error.kind, notify::ErrorKind::MaxFilesWatch) {
                        self.full = true;
                        self.over += 1;
                    }
                    self.polled.insert(path.clone());
                }
            }
        }
        added
    }

    /// Tries again the folders without a watch.
    fn retry(&mut self, known: &Known) -> Vec<PathBuf> {
        self.polled.clear();
        self.full = false;
        self.over = 0;
        self.follow(known)
    }
}

/// The warnings about the limit of inotify already given, so each is given once.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Warned {
    pub near: bool,
    pub over: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Warning {
    Near,
    Over,
}

/// What to warn of now: the watches at 80% of the limit, or some folders past it. Passing the limit
/// says it alone.
pub fn warnings(
    watched: usize,
    over: usize,
    limit: Option<u64>,
    warned: &mut Warned,
) -> Vec<Warning> {
    let near = limit.is_some_and(|limit| watched as u64 * 5 >= limit * 4);
    let over = over > 0;
    let mut now = Vec::new();
    if over && !warned.over {
        now.push(Warning::Over);
    } else if near && !warned.near && !over {
        now.push(Warning::Near);
    }
    warned.over = over;
    warned.near = near || over;
    now
}

/// The handler of the watcher: which folder changed for each event, or every disk.
fn changed(event: notify::Result<Event>) -> Vec<Change> {
    match event {
        Ok(event) if event.need_rescan() => vec![Change::Everything],
        Ok(Event {
            kind:
                EventKind::Access(_) | EventKind::Modify(ModifyKind::Data(_) | ModifyKind::Metadata(_)),
            ..
        }) => Vec::new(),
        Ok(event) => event
            .paths
            .iter()
            .filter_map(|path| {
                path.parent()
                    .map(|folder| Change::Folder(folder.to_path_buf()))
            })
            .collect(),
        Err(_) => vec![Change::Everything],
    }
}

/// Changes grouped during the settling period, before updating any disk.
#[derive(Default)]
struct ChangeBatch {
    folders: BTreeSet<PathBuf>,
    everything: bool,
    reset: bool,
}

impl ChangeBatch {
    fn take(&mut self, change: Change) {
        match change {
            Change::Folder(folder) => {
                self.folders.insert(folder);
            }
            Change::Everything => self.everything = true,
            Change::Reset => self.reset = true,
        }
    }

    async fn collect(first: Change, changes: &mut mpsc::Receiver<Change>) -> Self {
        let mut batch = Self::default();
        batch.take(first);
        let settle = Instant::now() + SETTLE;
        while let Ok(Some(change)) = tokio::time::timeout_at(settle, changes.recv()).await {
            batch.take(change);
        }
        batch
    }
}

/// A disk the index covers.
struct Root {
    id: String,
    path: PathBuf,
    known: Known,
    ready: bool,
}

impl SearchIndex {
    pub fn new(pool: SqlitePool, filesystem: Filesystem) -> (Self, mpsc::Receiver<Change>) {
        let (changes, receiver) = mpsc::channel(QUEUE);
        let index = Self {
            pool,
            filesystem,
            ready: Arc::default(),
            changes,
            overflowed: Arc::default(),
        };
        (index, receiver)
    }

    /// Empties the index, which is built again at once: the search walks the disks meanwhile.
    pub async fn reset(&self) {
        let _ = self.changes.send(Change::Reset).await;
    }

    /// The room the index takes in the database, and the names it holds.
    pub async fn usage(&self) -> Result<(u64, u64), sqlx::Error> {
        let bytes: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(pgsize), 0) FROM dbstat \
             WHERE name LIKE 'search%' OR name LIKE 'sqlite_autoindex_search%'",
        )
        .fetch_one(&self.pool)
        .await?;
        let items: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM search_entries")
            .fetch_one(&self.pool)
            .await?;
        Ok((
            u64::try_from(bytes).unwrap_or_default(),
            u64::try_from(items).unwrap_or_default(),
        ))
    }

    /// A change made by the Explorer itself, at the path it shows: its folder is read again now.
    pub fn touched(&self, path: &str) {
        if let Some(folder) = self.filesystem.folder_of(path) {
            self.send(Change::Folder(folder));
        }
    }

    fn send(&self, change: Change) {
        if let Err(mpsc::error::TrySendError::Full(_)) = self.changes.try_send(change) {
            self.overflowed.store(true, Ordering::Relaxed);
        }
    }

    /// What the index finds for a search, by the path of each disk it holds whole: the others are
    /// not there, and are walked.
    pub async fn found(&self, query: &str) -> HashMap<PathBuf, Vec<PathBuf>> {
        let folded = query.trim().to_lowercase();
        let mut found = HashMap::new();
        if folded.is_empty() {
            return found;
        }
        let ready = self.ready.read().await.clone();
        for (root, volume) in ready {
            // Three letters or more go by their trigrams; fewer read the names one by one.
            let rows = if folded.chars().count() >= 3 {
                sqlx::query(
                    "SELECT e.path FROM search_names JOIN search_entries e ON e.id = search_names.rowid \
                     WHERE search_names MATCH ? AND e.volume = ? LIMIT ?",
                )
                .bind(format!("\"{}\"", folded.replace('"', "\"\"")))
            } else {
                sqlx::query(
                    "SELECT path FROM search_entries WHERE instr(folded, ?) > 0 AND volume = ? \
                     LIMIT ?",
                )
                .bind(folded.as_str())
            }
            .bind(&volume)
            .bind(RESULTS)
            .fetch_all(&self.pool)
            .await;
            match rows {
                Ok(rows) => {
                    let paths = rows
                        .iter()
                        .map(|row| PathBuf::from(row.get::<String, _>(0)))
                        .collect();
                    found.insert(root, paths);
                }
                Err(error) => eprintln!("<4>the index of {volume} cannot search: {error}"),
            }
        }
        found
    }

    /// Builds the index, then follows the disks until the application stops.
    pub async fn run(self, mut changes: mpsc::Receiver<Change>, launcher: Launcher) {
        launcher.background(true).await;
        let limit = launcher.inotify_limit().await;
        let mut roots = self.roots().await;
        let mut watches = self.watch();
        let mut warned = Warned::default();
        for root in &mut roots {
            self.reconcile(root, &launcher).await;
        }
        watches = self.follow(watches, &mut roots, false).await;
        self.warn(&watches, limit, &mut warned, &launcher).await;
        let mut poll = Instant::now() + POLL;
        loop {
            let first = tokio::select! {
                change = changes.recv() => match change {
                    Some(change) => Some(change),
                    None => return,
                },
                () = tokio::time::sleep_until(poll) => None,
            };
            let Some(first) = first else {
                poll = Instant::now() + POLL;
                watches = self.poll(&mut roots, watches, &launcher).await;
                self.warn(&watches, limit, &mut warned, &launcher).await;
                continue;
            };
            let mut batch = ChangeBatch::collect(first, &mut changes).await;
            batch.everything |= self.overflowed.swap(false, Ordering::Relaxed) || batch.reset;
            if batch.reset {
                self.reset_roots(&mut roots).await;
            }
            if self.filesystem.verify_nas_mounts().is_err() {
                continue;
            }
            self.update_roots(&mut roots, &batch, &launcher).await;
            watches = self.follow(watches, &mut roots, false).await;
            self.warn(&watches, limit, &mut warned, &launcher).await;
        }
    }

    /// Installs the watcher; a full queue requests a complete rescan.
    fn watch(&self) -> Watches {
        let mut watches = Watches::default();
        let sender = self.changes.clone();
        let overflowed = Arc::clone(&self.overflowed);
        match notify::recommended_watcher(move |event| {
            for change in changed(event) {
                if let Err(mpsc::error::TrySendError::Full(_)) = sender.try_send(change) {
                    overflowed.store(true, Ordering::Relaxed);
                }
            }
        }) {
            Ok(watcher) => watches.watcher = Some(watcher),
            Err(error) => eprintln!("<4>the search cannot watch the disks: {error}"),
        }
        watches
    }

    /// Clears every disk before rebuilding an explicitly reset index.
    async fn reset_roots(&self, roots: &mut [Root]) {
        for root in roots {
            self.ready.write().await.remove(&root.path);
            if let Err(error) = self.forget(&root.id).await {
                eprintln!("<4>the index of {} was not emptied: {error}", root.id);
            }
            root.ready = false;
            root.known.clear();
        }
    }

    /// Applies a batch to each disk, reading only affected folders unless a rescan is needed.
    async fn update_roots(&self, roots: &mut [Root], batch: &ChangeBatch, launcher: &Launcher) {
        for root in roots {
            if batch.everything {
                self.reconcile(root, launcher).await;
            } else if root.ready {
                let starts: Vec<PathBuf> = batch
                    .folders
                    .iter()
                    .filter(|folder| folder.starts_with(&root.path))
                    .cloned()
                    .collect();
                self.update_folders(root, starts, true).await;
            }
        }
    }

    /// The disks to index, with what the database knows of them; the disks gone leave it.
    async fn roots(&self) -> Vec<Root> {
        let roots: Vec<(String, PathBuf)> = self
            .filesystem
            .search_roots()
            .into_iter()
            .filter(|(_, path)| path.to_str().is_some())
            .collect();
        let saved: Vec<(String, String)> =
            sqlx::query_as("SELECT volume, path FROM search_volumes")
                .fetch_all(&self.pool)
                .await
                .unwrap_or_default();
        let mut gone: Vec<String> = saved
            .iter()
            .filter(|(volume, path)| {
                !roots
                    .iter()
                    .any(|(id, root)| id == volume && root.to_str() == Some(path.as_str()))
            })
            .map(|(volume, _)| volume.clone())
            .collect();
        // A disk without a whole index, from an earlier start, is built again from the start.
        let partial: Vec<String> = sqlx::query_scalar("SELECT DISTINCT volume FROM search_folders")
            .fetch_all(&self.pool)
            .await
            .unwrap_or_default();
        gone.extend(
            partial
                .into_iter()
                .filter(|volume| !saved.iter().any(|(saved, _)| saved == volume)),
        );
        for volume in gone {
            if let Err(error) = self.forget(&volume).await {
                eprintln!("<4>the index of {volume} was not cleared: {error}");
            }
        }
        let mut indexed = Vec::new();
        for (id, path) in roots {
            let ready = saved
                .iter()
                .any(|(volume, saved)| volume == &id && path.to_str() == Some(saved.as_str()));
            let known = if ready {
                self.known(&id).await
            } else {
                Known::new()
            };
            if ready {
                self.ready.write().await.insert(path.clone(), id.clone());
            }
            indexed.push(Root {
                id,
                path,
                known,
                ready,
            });
        }
        indexed
    }

    async fn known(&self, volume: &str) -> Known {
        let rows: Vec<(String, i64)> =
            sqlx::query_as("SELECT path, modified_ns FROM search_folders WHERE volume = ?")
                .bind(volume)
                .fetch_all(&self.pool)
                .await
                .unwrap_or_default();
        rows.into_iter()
            .map(|(path, modified)| (PathBuf::from(path), modified))
            .collect()
    }

    async fn forget(&self, volume: &str) -> Result<(), sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        for statement in [
            "DELETE FROM search_entries WHERE volume = ?",
            "DELETE FROM search_folders WHERE volume = ?",
            "DELETE FROM search_volumes WHERE volume = ?",
        ] {
            sqlx::query(statement)
                .bind(volume)
                .execute(&mut *transaction)
                .await?;
        }
        transaction.commit().await
    }

    /// Reads a disk again where it changed; a disk without a whole index is built, among the
    /// operations of the NAS, and its search walks it until then.
    async fn reconcile(&self, root: &mut Root, launcher: &Launcher) {
        // A disk unplugged leaves its empty mount point: read, it would empty the index.
        if self.filesystem.verify_nas_mounts().is_err() || !root.path.is_dir() {
            return;
        }
        if root.ready {
            let start = vec![(root.path.clone(), false)];
            self.update(root, start, true).await;
            return;
        }
        let name = self
            .filesystem
            .volumes()
            .into_iter()
            .find(|volume| volume.id == root.id)
            .map_or_else(
                || "Indice della ricerca".to_owned(),
                |volume| format!("Indice della ricerca: {}", volume.name),
            );
        launcher.start_task(TASK, &name).await;
        root.known.clear();
        let start = vec![(root.path.clone(), true)];
        let whole = self.update(root, start, true).await;
        let saved = whole
            && sqlx::query("INSERT OR REPLACE INTO search_volumes (volume, path) VALUES (?, ?)")
                .bind(&root.id)
                .bind(root.path.to_string_lossy())
                .execute(&self.pool)
                .await
                .is_ok();
        if saved {
            root.ready = true;
            self.ready
                .write()
                .await
                .insert(root.path.clone(), root.id.clone());
        }
        let state = if saved { "done" } else { "failed" };
        launcher
            .update_task(
                TASK,
                &json!({ "state": state, "detail": format!("{} cartelle", root.known.len()) }),
            )
            .await;
    }

    /// Reads the folders that changed and writes them, as they come. False when the database
    /// failed: the disk then is no longer whole, and is built again at the next round.
    async fn update(&self, root: &mut Root, starts: Vec<(PathBuf, bool)>, deep: bool) -> bool {
        let (sender, mut listings) = mpsc::channel::<Listing>(CHUNK);
        let known = std::mem::take(&mut root.known);
        let reading = tokio::task::spawn_blocking(move || {
            scan(&starts, known, deep, |listing| {
                sender.blocking_send(listing).is_ok()
            })
        });
        let mut whole = true;
        let mut chunk = Vec::new();
        loop {
            let next = listings.recv().await;
            let end = next.is_none();
            chunk.extend(next);
            if chunk.len() >= CHUNK || (end && !chunk.is_empty()) {
                if let Err(error) = self.write(&root.id, &chunk).await {
                    eprintln!("<4>the index of {} was not written: {error}", root.id);
                    whole = false;
                    break;
                }
                chunk.clear();
            }
            if end {
                break;
            }
        }
        drop(listings);
        root.known = reading.await.unwrap_or_default();
        if !whole {
            root.ready = false;
            self.ready.write().await.remove(&root.path);
            let _ = self.forget(&root.id).await;
            root.known.clear();
        }
        whole
    }

    /// Writes folders read: the names they gained, without those they lost and all under them.
    async fn write(&self, volume: &str, listings: &[Listing]) -> Result<(), sqlx::Error> {
        let mut transaction = self.pool.begin().await?;
        for listing in listings {
            let Some(folder) = listing.folder.to_str() else {
                continue;
            };
            for dropped in &listing.dropped {
                remove_under(&mut transaction, &dropped.to_string_lossy()).await?;
            }
            let existing: Vec<(i64, String)> =
                sqlx::query_as("SELECT id, path FROM search_entries WHERE parent = ?")
                    .bind(folder)
                    .fetch_all(&mut *transaction)
                    .await?;
            let names: HashSet<&str> = listing
                .children
                .iter()
                .map(|(name, _)| name.as_str())
                .collect();
            let mut present = HashSet::new();
            for (id, path) in &existing {
                let name = Path::new(path)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default();
                if names.contains(name) {
                    present.insert(name.to_owned());
                    continue;
                }
                sqlx::query("DELETE FROM search_entries WHERE id = ?")
                    .bind(id)
                    .execute(&mut *transaction)
                    .await?;
                remove_under(&mut transaction, path).await?;
            }
            let added: Vec<&str> = listing
                .children
                .iter()
                .map(|(name, _)| name.as_str())
                .filter(|name| !present.contains(*name))
                .collect();
            for names in added.chunks(BATCH) {
                let mut insert = QueryBuilder::<Sqlite>::new(
                    "INSERT OR IGNORE INTO search_entries (path, parent, volume, folded) ",
                );
                insert.push_values(names, |mut row, name| {
                    row.push_bind(format!("{}/{name}", folder.trim_end_matches('/')))
                        .push_bind(folder)
                        .push_bind(volume)
                        .push_bind(name.to_lowercase());
                });
                insert.build().execute(&mut *transaction).await?;
            }
            sqlx::query(
                "INSERT OR REPLACE INTO search_folders (path, volume, modified_ns) VALUES (?, ?, ?)",
            )
            .bind(folder)
            .bind(volume)
            .bind(listing.modified_ns)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await
    }

    /// Reads again, among the folders given, those whose time changed since they were read.
    async fn update_folders(&self, root: &mut Root, folders: Vec<PathBuf>, forced: bool) {
        let starts: Vec<(PathBuf, bool)> = folders
            .into_iter()
            .filter(|folder| folder.starts_with(&root.path))
            .map(|folder| (folder, forced))
            .collect();
        if !starts.is_empty() {
            self.update(root, starts, false).await;
        }
    }

    /// Watches the known folders of every disk (`retry`: those without a watch too). A folder
    /// changed between its reading and its watch: each folder watched now is read again if its
    /// time is another, until no new folder comes.
    async fn follow(&self, mut watches: Watches, roots: &mut [Root], retry: bool) -> Watches {
        let mut retry = retry;
        loop {
            let known: Known = roots
                .iter()
                .flat_map(|root| root.known.iter().map(|(path, time)| (path.clone(), *time)))
                .collect();
            let again = retry;
            let followed = tokio::task::spawn_blocking(move || {
                let added = if again {
                    watches.retry(&known)
                } else {
                    watches.follow(&known)
                };
                (watches, added)
            })
            .await;
            let Ok((followed, added)) = followed else {
                return Watches::default();
            };
            watches = followed;
            retry = false;
            if added.is_empty() {
                return watches;
            }
            for root in roots.iter_mut().filter(|root| root.ready) {
                self.update_folders(root, added.clone(), false).await;
            }
        }
    }

    /// Every ten minutes: the folders without a watch are read again where their time changed, and
    /// get a watch if there is room now. Without any watch, every disk is read again; a disk whose
    /// index is not whole is built again.
    async fn poll(&self, roots: &mut [Root], watches: Watches, launcher: &Launcher) -> Watches {
        if self.filesystem.verify_nas_mounts().is_err() {
            return watches;
        }
        for root in roots.iter_mut() {
            if watches.watcher.is_none() || !root.ready {
                self.reconcile(root, launcher).await;
            } else {
                let polled = watches.polled.iter().cloned().collect();
                self.update_folders(root, polled, false).await;
            }
        }
        self.follow(watches, roots, true).await
    }

    async fn warn(
        &self,
        watches: &Watches,
        limit: Option<u64>,
        warned: &mut Warned,
        launcher: &Launcher,
    ) {
        let watched = watches.watched.len();
        for warning in warnings(watched, watches.over, limit, warned) {
            let params = json!({
                "watched": watched.to_string(),
                "limit": limit.map(|limit| limit.to_string()).unwrap_or_default(),
                "folders": watches.over.to_string(),
            });
            let (key, title, message) = match warning {
                Warning::Near => (
                    "searchWatchesNear",
                    "Ricerca di Explorer vicina al limite",
                    "Le cartelle osservate sono all'80% del limite di inotify. Oltre il limite, la \
                     ricerca si aggiorna ogni 10 minuti nelle cartelle in più.",
                ),
                Warning::Over => (
                    "searchWatchesOver",
                    "Ricerca di Explorer oltre il limite",
                    "Alcune cartelle superano il limite di inotify: in quelle la ricerca si \
                     aggiorna ogni 10 minuti. Il limite si alza a mano con fs.inotify.max_user_watches.",
                ),
            };
            launcher.notify(title, message, key, &params).await;
        }
    }
}

/// Removes what was under a folder of the index: its names and the folders read.
async fn remove_under(
    transaction: &mut Transaction<'_, Sqlite>,
    folder: &str,
) -> Result<(), sqlx::Error> {
    // Every path under `folder/` sorts between it and `folder0`, the character after the slash.
    let from = format!("{}/", folder.trim_end_matches('/'));
    let to = format!("{}0", folder.trim_end_matches('/'));
    sqlx::query("DELETE FROM search_entries WHERE path >= ? AND path < ?")
        .bind(&from)
        .bind(&to)
        .execute(&mut **transaction)
        .await?;
    sqlx::query("DELETE FROM search_folders WHERE path = ? OR (path >= ? AND path < ?)")
        .bind(folder)
        .bind(&from)
        .bind(&to)
        .execute(&mut **transaction)
        .await?;
    Ok(())
}

#[cfg(test)]
#[path = "../../tests/unit/axum/search.rs"]
mod tests;
