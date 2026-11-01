//! Trash of the disks. Each disk has a `.nas-trash` folder at its root that keeps the tree of the
//! original folders and one version per path, a new deletion replacing the previous one. Moving
//! into it is a rename on the same disk, instant for any size. Explorer, its search and its index
//! never show it, and it is read only through the functions below.
//!
//! The change time (ctime) of a file records its rename by Samba or the sync. Explorer also records
//! the time itself, including every descendant of a deleted directory. The ctime of a parent cannot
//! date a file, since later deletions into the same directory would reset its age. Disks without a
//! reliable ctime (exFAT, NTFS) are detected and Explorer keeps their dates in the database.
//!
//! The service on top adds the settings (on by default, 30 days), the page routes and the daily
//! expiry.

use crate::filesystem::{
    file_kind, move_across_devices, sort_folders_first, FileEntry, FileKind, Filesystem,
};
use crate::shares::Shares;
use crate::{blocking, status_of};
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::SqlitePool;
use std::{
    collections::HashMap,
    ffi::OsStr,
    fs,
    io::{self, ErrorKind},
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::{Component, Path, PathBuf},
    sync::atomic::Ordering,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub const TRASH_DIRECTORY: &str = ".nas-trash";
pub const TRASH_OFF: &str = ".nas-trash-off";
const RELIABLE: [&str; 8] = [
    "ext2", "ext3", "ext4", "xfs", "btrfs", "f2fs", "zfs", "tmpfs",
];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    pub name: String,
    pub path: String,
    pub kind: FileKind,
    pub size: u64,
    pub deleted_at: u64,
}

/// The trash of one disk.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrashDisk {
    pub id: String,
    pub name: String,
    pub bytes: u64,
    pub items: u64,
}

/// A file or empty directory in the trash, for its expiry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrashFile {
    pub path: PathBuf,
    pub deleted_at: Option<u64>,
}

fn changed_at(metadata: &fs::Metadata) -> u64 {
    u64::try_from(metadata.ctime()).unwrap_or_default()
}

fn size_of(path: &Path) -> u64 {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return 0;
    };
    if !metadata.is_dir() {
        return metadata.len();
    }
    fs::read_dir(path)
        .map(|entries| entries.flatten().map(|entry| size_of(&entry.path())).sum())
        .unwrap_or_default()
}

/// Filesystem type of a path, from the mounts of the process.
fn filesystem_type(path: &Path) -> Option<String> {
    let mounts = fs::read_to_string("/proc/self/mounts").ok()?;
    mounts
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let (_, point, kind) = (fields.next()?, fields.next()?, fields.next()?);
            let point = PathBuf::from(point.replace("\\040", " "));
            path.starts_with(&point).then(|| (point, kind.to_owned()))
        })
        .max_by_key(|(point, _)| point.components().count())
        .map(|(_, kind)| kind)
}

/// Refuses symbolic links in directory paths and gives new shared directories group access.
/// The volume root is trusted. Components beneath it must be directories within that volume.
fn checked_directories(base: &Path, path: &Path, create: bool) -> io::Result<()> {
    let relative = path
        .strip_prefix(base)
        .map_err(|_| io::Error::new(ErrorKind::PermissionDenied, "not on the selected disk"))?;
    let mut current = base.to_path_buf();
    for component in relative.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err(io::Error::new(
                ErrorKind::PermissionDenied,
                "invalid trash path",
            ));
        }
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if !metadata.is_dir() || metadata.file_type().is_symlink() => {
                return Err(io::Error::new(
                    ErrorKind::PermissionDenied,
                    "a trash directory is a link or file",
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {
                if create {
                    fs::create_dir(&current)?;
                    fs::set_permissions(&current, fs::Permissions::from_mode(0o2770))?;
                }
            }
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

impl Filesystem {
    pub fn set_trash(&self, enabled: bool) {
        self.trash.store(enabled, Ordering::Relaxed);
    }

    pub fn trash_enabled(&self) -> bool {
        self.trash.load(Ordering::Relaxed)
    }

    /// Marks on every disk whether its trash is on, with `.nas-trash-off` at its root while it is
    /// off. A read-only disk keeps its previous state.
    pub fn mark_trash(&self) {
        for (_, _, base) in self.trash_bases() {
            let marker = base.join(TRASH_OFF);
            let _ = if self.trash_enabled() {
                fs::remove_file(&marker)
            } else {
                fs::write(&marker, "")
            };
        }
    }

    /// Disks that have a trash, with id, name and root folder.
    fn trash_bases(&self) -> Vec<(String, String, PathBuf)> {
        if self.volumes.is_empty() && !self.nas_mode {
            return vec![(String::new(), String::new(), self.root.clone())];
        }
        self.volumes
            .iter()
            .map(|volume| (volume.id.clone(), volume.name.clone(), volume.path.clone()))
            .collect()
    }

    /// Disk of a path, by id and root.
    fn trash_base(&self, real: &Path) -> Option<(String, PathBuf)> {
        self.trash_bases()
            .into_iter()
            .find(|(_, _, base)| real.starts_with(base))
            .map(|(id, _, base)| (id, base))
    }

    /// UI path of a disk path.
    fn shown(&self, id: &str, relative: &Path) -> String {
        let relative = relative.to_string_lossy().replace('\\', "/");
        match (id.is_empty(), relative.is_empty()) {
            (true, _) => relative,
            (false, true) => id.to_owned(),
            (false, false) => format!("{id}/{relative}"),
        }
    }

    /// Moves a file or folder into the trash of its disk, replacing any entry with the same path.
    pub fn move_to_trash(&self, real: &Path) -> io::Result<PathBuf> {
        let (_, base) = self
            .trash_base(real)
            .ok_or_else(|| io::Error::new(ErrorKind::PermissionDenied, "not on a disk"))?;
        let relative = real
            .strip_prefix(&base)
            .map_err(|_| io::Error::new(ErrorKind::PermissionDenied, "not on a disk"))?;
        let trash = base.join(TRASH_DIRECTORY);
        checked_directories(&base, &trash, true)?;
        let target = trash.join(relative);
        if let Some(parent) = target.parent() {
            checked_directories(&base, parent, true)?;
        }
        match fs::symlink_metadata(&target) {
            Ok(metadata) if metadata.is_dir() => fs::remove_dir_all(&target)?,
            Ok(_) => fs::remove_file(&target)?,
            Err(_) => {}
        }
        match fs::rename(real, &target) {
            Err(error) if error.kind() == ErrorKind::CrossesDevices => {
                move_across_devices(real, &target)?;
            }
            moved => moved?,
        }
        Ok(target)
    }

    /// Location of a UI path inside the trash, and where it is restored.
    pub fn trash_location(&self, path: impl AsRef<Path>) -> io::Result<(PathBuf, PathBuf)> {
        let original = self.resolve_requested_path(path)?;
        let (_, base) = self
            .trash_base(&original)
            .ok_or_else(|| io::Error::new(ErrorKind::PermissionDenied, "not on a disk"))?;
        let relative = original
            .strip_prefix(&base)
            .map_err(|_| io::Error::new(ErrorKind::PermissionDenied, "not on a disk"))?;
        let inside = base.join(TRASH_DIRECTORY).join(relative);
        checked_directories(&base, &base.join(TRASH_DIRECTORY), false)?;
        if let Some(parent) = inside.parent().filter(|_| !relative.as_os_str().is_empty()) {
            checked_directories(&base, parent, false)?;
        }
        if let Some(parent) = original
            .parent()
            .filter(|_| !relative.as_os_str().is_empty())
        {
            checked_directories(&base, parent, false)?;
        }
        Ok((inside, original))
    }

    /// When this entry changed. Sibling deletions must not reset its age.
    fn deleted_at(&self, real: &Path) -> u64 {
        fs::symlink_metadata(real)
            .map(|metadata| changed_at(&metadata))
            .unwrap_or_default()
    }

    /// Disks with their trash size and item count.
    pub fn trash_disks(&self) -> Vec<TrashDisk> {
        self.trash_bases()
            .into_iter()
            .map(|(id, name, base)| {
                let trash = base.join(TRASH_DIRECTORY);
                let safe = checked_directories(&base, &trash, false).is_ok();
                let items = safe
                    .then(|| fs::read_dir(&trash))
                    .transpose()
                    .ok()
                    .flatten()
                    .map(|entries| entries.flatten().count() as u64)
                    .unwrap_or_default();
                TrashDisk {
                    id,
                    name,
                    bytes: if safe { size_of(&trash) } else { 0 },
                    items,
                }
            })
            .collect()
    }

    /// Trash content under a folder, by original path. A disk is its own top level.
    pub fn trash_list(&self, path: impl AsRef<Path>) -> io::Result<Vec<TrashEntry>> {
        let (folder, original) = self.trash_location(path)?;
        let (id, base) = self
            .trash_base(&original)
            .ok_or_else(|| io::Error::new(ErrorKind::PermissionDenied, "not on a disk"))?;
        let trash = base.join(TRASH_DIRECTORY);
        checked_directories(&base, &folder, false)?;
        let entries = match fs::read_dir(&folder) {
            Ok(entries) => entries,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error),
        };
        let mut listed: Vec<TrashEntry> = entries
            .flatten()
            .filter_map(|entry| {
                let real = entry.path();
                let metadata = fs::symlink_metadata(&real).ok()?;
                let relative = real.strip_prefix(&trash).ok()?;
                Some(TrashEntry {
                    name: entry.file_name().to_string_lossy().into_owned(),
                    path: self.shown(&id, relative),
                    kind: file_kind(&real, metadata.is_dir()),
                    size: size_of(&real),
                    deleted_at: self.deleted_at(&real),
                })
            })
            .collect();
        sort_folders_first(&mut listed, |entry| (&entry.kind, &entry.name));
        Ok(listed)
    }

    /// Restores an entry to its original path. An existing item is kept unless `replace` is set.
    pub fn restore(&self, path: impl AsRef<Path>, replace: bool) -> io::Result<FileEntry> {
        let (inside, original) = self.trash_location(path)?;
        self.require_trash_entry(&inside)?;
        fs::symlink_metadata(&inside)?;
        if let Ok(existing) = fs::symlink_metadata(&original) {
            if !replace {
                return Err(io::Error::new(
                    ErrorKind::AlreadyExists,
                    "destination already exists",
                ));
            }
            if existing.is_dir() {
                fs::remove_dir_all(&original)?;
            } else {
                fs::remove_file(&original)?;
            }
        }
        if let Some(parent) = original.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(&inside, &original)?;
        self.prune_trash(&inside);
        self.entry_from_path(original)
    }

    /// Permanently deletes a trash entry.
    pub fn purge(&self, path: impl AsRef<Path>) -> io::Result<()> {
        let (inside, _) = self.trash_location(path)?;
        self.require_trash_entry(&inside)?;
        let metadata = fs::symlink_metadata(&inside)?;
        if metadata.is_dir() {
            fs::remove_dir_all(&inside)?;
        } else {
            fs::remove_file(&inside)?;
        }
        self.prune_trash(&inside);
        Ok(())
    }

    /// Empties the trash of a disk, or of every disk.
    pub fn empty_trash(&self, disk: Option<&str>) -> io::Result<()> {
        for (id, _, base) in self.trash_bases() {
            if disk.is_some_and(|disk| disk != id) {
                continue;
            }
            let trash = base.join(TRASH_DIRECTORY);
            checked_directories(&base, &trash, false)?;
            let entries = match fs::read_dir(&trash) {
                Ok(entries) => entries,
                Err(error) if error.kind() == ErrorKind::NotFound => continue,
                Err(error) => return Err(error),
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                    fs::remove_dir_all(path)?;
                } else {
                    fs::remove_file(path)?;
                }
            }
        }
        Ok(())
    }

    /// Every file in every trash, with its deletion time when the disk can tell.
    pub fn trash_files(&self) -> Vec<TrashFile> {
        let mut files = Vec::new();
        for (_, _, base) in self.trash_bases() {
            let trash = base.join(TRASH_DIRECTORY);
            if checked_directories(&base, &trash, false).is_err() {
                continue;
            }
            let reliable =
                filesystem_type(&trash).is_some_and(|kind| RELIABLE.contains(&kind.as_str()));
            let mut folders = vec![trash.clone()];
            while let Some(folder) = folders.pop() {
                let Ok(entries) = fs::read_dir(&folder) else {
                    continue;
                };
                for entry in entries.flatten() {
                    let path = entry.path();
                    if entry.file_type().is_ok_and(|kind| kind.is_dir())
                        && !fs::read_dir(&path).is_ok_and(|mut entries| entries.next().is_none())
                    {
                        folders.push(path);
                        continue;
                    }
                    let deleted_at = reliable.then(|| self.deleted_at(&path));
                    files.push(TrashFile { path, deleted_at });
                }
            }
        }
        files.sort_by(|left, right| left.path.cmp(&right.path));
        files
    }

    /// Removes an expired trash file and the folders it leaves empty.
    pub fn expire(&self, path: &Path) -> io::Result<()> {
        let base = self
            .trash_bases()
            .into_iter()
            .map(|(_, _, base)| base)
            .find(|base| path.starts_with(base.join(TRASH_DIRECTORY)))
            .ok_or_else(|| io::Error::new(ErrorKind::PermissionDenied, "not in a granted trash"))?;
        self.require_trash_entry(path)?;
        checked_directories(
            &base,
            path.parent().ok_or_else(|| io::Error::other("no parent"))?,
            false,
        )?;
        let removed = match fs::symlink_metadata(path) {
            Ok(metadata) if metadata.is_dir() => fs::remove_dir(path),
            Ok(_) => fs::remove_file(path),
            Err(error) => Err(error),
        };
        match removed {
            Err(error) if error.kind() != ErrorKind::NotFound => return Err(error),
            _ => {}
        }
        self.prune_trash(path);
        Ok(())
    }

    fn require_trash_entry(&self, path: &Path) -> io::Result<()> {
        if self
            .trash_bases()
            .iter()
            .any(|(_, _, base)| path == base.join(TRASH_DIRECTORY))
        {
            return Err(io::Error::new(
                ErrorKind::PermissionDenied,
                "the trash root is not an entry",
            ));
        }
        Ok(())
    }

    /// Removes the empty folders above a trash path, keeping the trash itself.
    fn prune_trash(&self, path: &Path) {
        for folder in path.ancestors().skip(1) {
            if folder.file_name() == Some(OsStr::new(TRASH_DIRECTORY))
                || fs::remove_dir(folder).is_err()
            {
                break;
            }
        }
    }
}

const DAY: u64 = 24 * 60 * 60;

const FIRST_EXPIRY: Duration = Duration::from_secs(60);

#[derive(Clone)]
pub struct Trash {
    pool: SqlitePool,
    filesystem: Filesystem,
    shares: Option<Shares>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Settings {
    pub enabled: bool,
    pub days: u16,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            enabled: true,
            days: 30,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct PathQuery {
    pub path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Restore {
    pub path: String,
    #[serde(default)]
    pub replace: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Empty {
    #[serde(default)]
    pub disk: Option<String>,
}

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |time| time.as_secs())
}

fn refused(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

/// Filesystem error with the HTTP status the page expects.
fn failed(error: &io::Error) -> Response {
    refused(
        status_of(error, StatusCode::INTERNAL_SERVER_ERROR),
        &error.to_string(),
    )
}

/// Deletion time of this version. Each descendant has its own record.
pub fn recorded(records: &HashMap<String, u64>, path: &Path) -> Option<u64> {
    records.get(path.to_string_lossy().as_ref()).copied()
}

fn signature(metadata: &std::fs::Metadata) -> String {
    format!(
        "{}:{}:{}:{}:{}:{}:{}",
        metadata.dev(),
        metadata.ino(),
        metadata.ctime(),
        metadata.ctime_nsec(),
        metadata.mtime(),
        metadata.mtime_nsec(),
        metadata.len()
    )
}

/// Includes the descendants of a deleted directory without following symbolic links.
fn deleted_entries(inside: &Path) -> Vec<PathBuf> {
    let mut pending = vec![inside.to_path_buf()];
    let mut found = Vec::new();
    while let Some(path) = pending.pop() {
        if std::fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.is_dir()) {
            if let Ok(entries) = std::fs::read_dir(&path) {
                pending.extend(entries.flatten().map(|entry| entry.path()));
            }
        }
        found.push(path);
    }
    found
}

impl Trash {
    pub fn new(pool: SqlitePool, filesystem: Filesystem) -> Self {
        Self {
            pool,
            filesystem,
            shares: None,
        }
    }

    /// Shares whose deleted files go to the trash.
    pub fn with_shares(self, shares: Shares) -> Self {
        Self {
            shares: Some(shares),
            ..self
        }
    }

    pub async fn settings(&self) -> Settings {
        let row: Option<(i64, i64)> =
            sqlx::query_as("SELECT enabled, days FROM trash WHERE id = 1")
                .fetch_optional(&self.pool)
                .await
                .ok()
                .flatten();
        row.map_or_else(Settings::default, |(enabled, days)| Settings {
            enabled: enabled != 0,
            days: u16::try_from(days).unwrap_or(30),
        })
    }

    /// Applies the saved trash setting at start.
    pub async fn apply_saved(&self) {
        self.filesystem.set_trash(self.settings().await.enabled);
        self.mark().await;
        self.upgrade_dates().await;
    }

    // Keeps dates written before per-version signatures, including directory descendants.
    async fn upgrade_dates(&self) {
        let old: Vec<(String, i64)> =
            sqlx::query_as("SELECT path, deleted_at FROM trash_dates WHERE signature IS NULL ORDER BY length(path)")
                .fetch_all(&self.pool)
                .await
                .unwrap_or_default();
        for (path, at) in old {
            let inside = PathBuf::from(path);
            let entries = tokio::task::spawn_blocking(move || deleted_entries(&inside))
                .await
                .unwrap_or_default();
            for entry in entries {
                self.record(&entry, u64::try_from(at).unwrap_or_default())
                    .await;
            }
        }
    }

    /// Marks on each disk whether the trash is on, for the sync.
    async fn mark(&self) {
        let filesystem = self.filesystem.clone();
        let _ = tokio::task::spawn_blocking(move || filesystem.mark_trash()).await;
    }

    async fn records(&self) -> HashMap<String, u64> {
        let rows: Vec<(String, i64, Option<String>)> =
            sqlx::query_as("SELECT path, deleted_at, signature FROM trash_dates")
                .fetch_all(&self.pool)
                .await
                .unwrap_or_default();
        let mut records = HashMap::new();
        for (path, at, stamp) in rows {
            if let Ok(metadata) = tokio::fs::symlink_metadata(&path).await {
                if stamp
                    .as_ref()
                    .is_some_and(|stamp| *stamp == signature(&metadata))
                {
                    records.insert(path, u64::try_from(at).unwrap_or_default());
                }
            }
        }
        records
    }

    async fn record(&self, path: &Path, at: u64) {
        let Ok(metadata) = tokio::fs::symlink_metadata(path).await else {
            return;
        };
        let _ = sqlx::query(
            "INSERT OR REPLACE INTO trash_dates (path, deleted_at, signature) VALUES (?, ?, ?)",
        )
        .bind(path.to_string_lossy())
        .bind(i64::try_from(at).unwrap_or(i64::MAX))
        .bind(signature(&metadata))
        .execute(&self.pool)
        .await;
    }

    /// Records the time of an Explorer deletion that went to the trash.
    pub async fn deleted(&self, path: &str) {
        if !self.filesystem.trash_enabled() {
            return;
        }
        let filesystem = self.filesystem.clone();
        let path = path.to_owned();
        let at = now();
        let entries = tokio::task::spawn_blocking(move || {
            filesystem
                .trash_location(path)
                .map(|(inside, _)| deleted_entries(&inside))
        })
        .await;
        if let Ok(Ok(entries)) = entries {
            for entry in entries {
                self.record(&entry, at).await;
            }
        }
    }

    /// Trash entries with the times Explorer recorded for those versions.
    async fn dated(&self, mut entries: Vec<TrashEntry>) -> Vec<TrashEntry> {
        let records = self.records().await;
        let filesystem = self.filesystem.clone();
        tokio::task::spawn_blocking(move || {
            for entry in &mut entries {
                if let Ok((inside, _)) = filesystem.trash_location(&entry.path) {
                    if let Some(at) = recorded(&records, &inside) {
                        entry.deleted_at = at;
                    }
                }
            }
            entries
        })
        .await
        .unwrap_or_default()
    }

    /// Removes items older than the configured days. Returns how many files were removed.
    pub async fn expire(&self, now: u64) -> usize {
        let days = u64::from(self.settings().await.days);
        let filesystem = self.filesystem.clone();
        let files = tokio::task::spawn_blocking(move || filesystem.trash_files())
            .await
            .unwrap_or_default();
        let records = self.records().await;
        let mut expired = Vec::new();
        for file in files {
            let at = match recorded(&records, &file.path).or(file.deleted_at) {
                Some(at) => at,
                None => {
                    self.record(&file.path, now).await;
                    now
                }
            };
            if now.saturating_sub(at) >= days * DAY {
                expired.push(file.path);
            }
        }
        let count = expired.len();
        let filesystem = self.filesystem.clone();
        let _ = tokio::task::spawn_blocking(move || {
            for path in expired {
                if let Err(error) = filesystem.expire(&path) {
                    eprintln!("<4>{} did not leave the trash: {error}", path.display());
                }
            }
        })
        .await;
        self.forget_gone().await;
        count
    }

    /// Times of items no longer in the trash.
    async fn forget_gone(&self) {
        let paths: Vec<String> = sqlx::query_scalar("SELECT path FROM trash_dates")
            .fetch_all(&self.pool)
            .await
            .unwrap_or_default();
        for path in paths {
            if tokio::fs::symlink_metadata(&path).await.is_err() {
                let _ = sqlx::query("DELETE FROM trash_dates WHERE path = ?")
                    .bind(&path)
                    .execute(&self.pool)
                    .await;
            }
        }
    }

    /// Expires the trash once a day while the application runs.
    pub async fn run(self) {
        tokio::time::sleep(FIRST_EXPIRY).await;
        loop {
            self.expire(now()).await;
            tokio::time::sleep(Duration::from_secs(DAY)).await;
        }
    }

    pub fn router<S>(self) -> Router<S>
    where
        S: Clone + Send + Sync + 'static,
    {
        Router::new()
            .route("/api/trash", get(list).delete(purge))
            .route("/api/trash/settings", get(read_settings).put(save_settings))
            .route("/api/trash/disks", get(disks))
            .route("/api/trash/restore", post(restore))
            .route("/api/trash/empty", post(empty))
            .with_state(self)
    }
}

async fn read_settings(State(trash): State<Trash>) -> Json<Settings> {
    Json(trash.settings().await)
}

async fn save_settings(State(trash): State<Trash>, Json(settings): Json<Settings>) -> Response {
    if !(1..=3650).contains(&settings.days) {
        return refused(StatusCode::BAD_REQUEST, "the days go from 1 to 3650");
    }
    let saved = sqlx::query(
        "INSERT INTO trash (id, enabled, days) VALUES (1, ?, ?) \
         ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, days = excluded.days",
    )
    .bind(i64::from(settings.enabled))
    .bind(i64::from(settings.days))
    .execute(&trash.pool)
    .await;
    if saved.is_err() {
        return refused(
            StatusCode::SERVICE_UNAVAILABLE,
            "the settings cannot be saved",
        );
    }
    let switched = trash.filesystem.trash_enabled() != settings.enabled;
    trash.filesystem.set_trash(settings.enabled);
    trash.mark().await;
    if let Some(shares) = trash.shares.as_ref().filter(|_| switched) {
        shares.hand_over_saved().await;
    }
    Json(settings).into_response()
}

async fn disks(State(trash): State<Trash>) -> Json<Vec<TrashDisk>> {
    let filesystem = trash.filesystem.clone();
    Json(
        tokio::task::spawn_blocking(move || filesystem.trash_disks())
            .await
            .unwrap_or_default(),
    )
}

async fn list(State(trash): State<Trash>, Query(query): Query<PathQuery>) -> Response {
    let filesystem = trash.filesystem.clone();
    let path = query.path.unwrap_or_default();
    match blocking(move || filesystem.trash_list(path)).await {
        Ok(entries) => Json(trash.dated(entries).await).into_response(),
        Err(error) => failed(&error),
    }
}

async fn restore(State(trash): State<Trash>, Json(request): Json<Restore>) -> Response {
    let filesystem = trash.filesystem.clone();
    match blocking(move || filesystem.restore(request.path, request.replace)).await {
        Ok(entry) => Json::<FileEntry>(entry).into_response(),
        Err(error) => failed(&error),
    }
}

async fn purge(State(trash): State<Trash>, Query(query): Query<PathQuery>) -> Response {
    let Some(path) = query.path.filter(|path| !path.is_empty()) else {
        return refused(StatusCode::BAD_REQUEST, "path is required");
    };
    let filesystem = trash.filesystem.clone();
    match blocking(move || filesystem.purge(path)).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => failed(&error),
    }
}

async fn empty(State(trash): State<Trash>, Json(request): Json<Empty>) -> Response {
    let filesystem = trash.filesystem.clone();
    match blocking(move || filesystem.empty_trash(request.disk.as_deref())).await {
        Ok(()) => {
            trash.forget_gone().await;
            StatusCode::NO_CONTENT.into_response()
        }
        Err(error) => failed(&error),
    }
}

#[cfg(test)]
#[path = "../tests/trash.rs"]
mod tests;
