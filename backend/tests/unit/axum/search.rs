use super::*;
use axum::{body::Body, http::Request, http::StatusCode};
use notify::event::{AccessKind, CreateKind, DataChange, Flag, MetadataKind, RenameMode};
use std::sync::atomic::AtomicU64;
use tower::ServiceExt;

static NEXT: AtomicU64 = AtomicU64::new(0);

fn scratch() -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "fs-explorer-search-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(path.join("root")).unwrap();
    path.canonicalize().unwrap()
}

/// The folders of a scan in the order it handed them over, by their name.
fn names(listings: &[Listing]) -> Vec<String> {
    listings
        .iter()
        .map(|listing| {
            listing
                .folder
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned()
        })
        .collect()
}

/// Dates folders an hour back, past the time a change could go unseen.
fn age(folders: &[PathBuf]) {
    let past = std::time::SystemTime::now() - Duration::from_secs(3600);
    for folder in folders {
        fs::File::open(folder).unwrap().set_modified(past).unwrap();
    }
}

fn collect(starts: &[(PathBuf, bool)], known: Known, deep: bool) -> (Vec<Listing>, Known) {
    let mut listings = Vec::new();
    let known = scan(starts, known, deep, |listing| {
        listings.push(listing);
        true
    });
    (listings, known)
}

#[test]
fn a_scan_hands_each_folder_over_after_its_new_folders_and_never_follows_links() {
    let folder = scratch();
    let root = folder.join("root");
    fs::create_dir_all(root.join("a/b")).unwrap();
    fs::write(root.join("a/b/report.txt"), "x").unwrap();
    fs::write(root.join("notes.txt"), "x").unwrap();
    fs::create_dir(root.join(CACHE_DIRECTORY)).unwrap();
    std::os::unix::fs::symlink(root.join("a"), root.join("link")).unwrap();
    age(&[root.clone(), root.join("a"), root.join("a/b")]);

    let (listings, known) = collect(&[(root.clone(), true)], Known::new(), true);
    assert_eq!(names(&listings), ["b", "a", "root"]);
    let top = listings.last().unwrap();
    let mut children = top.children.clone();
    children.sort();
    assert_eq!(
        children,
        [
            ("a".to_owned(), true),
            ("link".to_owned(), false),
            ("notes.txt".to_owned(), false)
        ]
    );
    assert_eq!(known.len(), 3);

    // Nothing changed: nothing is read, deep or not.
    let (listings, known) = collect(&[(root.clone(), false)], known, true);
    assert!(listings.is_empty());

    // A folder gone leaves with all it held; a folder changed this recently is read again.
    fs::remove_dir_all(root.join("a/b")).unwrap();
    let (listings, known) = collect(&[(root.clone(), false)], known, true);
    assert_eq!(names(&listings), ["a"]);
    assert_eq!(listings[0].dropped, [root.join("a/b")]);
    assert!(!known.contains_key(&root.join("a/b")));
    assert_eq!(known[&root.join("a")], UNTRUSTED);
    let (listings, known) = collect(&[(root.clone(), false)], known, true);
    assert_eq!(names(&listings), ["a"]);

    // Not deep, only the start is read, even unchanged when forced.
    let (listings, _) = collect(&[(root.clone(), true)], known.clone(), false);
    assert_eq!(names(&listings), ["root"]);
    let (listings, _) = collect(&[(root.join("missing"), true)], known, false);
    assert!(listings.is_empty());
}

#[test]
fn a_scan_stops_when_nobody_takes_what_it_reads() {
    let folder = scratch();
    let root = folder.join("root");
    fs::create_dir_all(root.join("a/b/c")).unwrap();
    let mut taken = 0;
    scan(&[(root, true)], Known::new(), true, |_| {
        taken += 1;
        false
    });
    assert_eq!(taken, 1);
}

#[test]
fn each_warning_about_the_limit_is_given_once_until_it_no_longer_holds() {
    let mut warned = Warned::default();
    assert!(warnings(10, 0, Some(100), &mut warned).is_empty());
    assert!(warnings(10, 0, None, &mut warned).is_empty());
    assert_eq!(warnings(80, 0, Some(100), &mut warned), [Warning::Near]);
    assert!(warnings(90, 0, Some(100), &mut warned).is_empty());
    assert_eq!(warnings(100, 3, Some(100), &mut warned), [Warning::Over]);
    assert!(warnings(100, 3, Some(100), &mut warned).is_empty());
    assert!(warnings(10, 0, Some(100), &mut warned).is_empty());
    assert_eq!(warned, Warned::default());
    // Past the limit at once: only that is said.
    assert_eq!(warnings(100, 1, Some(100), &mut warned), [Warning::Over]);
}

#[test]
fn an_event_says_which_folder_to_read_again() {
    let file = PathBuf::from("/srv/a/file.txt");
    let event = |kind| Ok(Event::new(kind).add_path(file.clone()));
    assert_eq!(
        changed(event(EventKind::Create(CreateKind::File))),
        [Change::Folder(PathBuf::from("/srv/a"))]
    );
    assert_eq!(
        changed(event(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))),
        [Change::Folder(PathBuf::from("/srv/a"))]
    );
    for kind in [
        EventKind::Access(AccessKind::Any),
        EventKind::Modify(ModifyKind::Data(DataChange::Any)),
        EventKind::Modify(ModifyKind::Metadata(MetadataKind::Any)),
    ] {
        assert!(changed(event(kind)).is_empty());
    }
    assert_eq!(
        changed(Ok(Event::new(EventKind::Other).set_flag(Flag::Rescan))),
        [Change::Everything]
    );
    assert_eq!(
        changed(Err(notify::Error::generic("lost"))),
        [Change::Everything]
    );
}

/// Waits until the index finds `query` as `expected` (paths under the root), or fails.
async fn eventually(index: &SearchIndex, root: &Path, query: &str, expected: &[&str]) {
    let mut expected: Vec<PathBuf> = expected.iter().map(|path| root.join(path)).collect();
    expected.sort();
    let mut last = Vec::new();
    for _ in 0..100 {
        let found = index.found(query).await;
        if let Some(paths) = found.get(root) {
            last = paths.clone();
            last.sort();
            if last == expected {
                return;
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("{query}: found {last:?}, expected {expected:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn the_index_finds_any_part_of_a_name_and_follows_the_disk() {
    let folder = scratch();
    let root = folder.join("root");
    fs::create_dir_all(root.join("Lavoro/2026")).unwrap();
    fs::write(root.join("Lavoro/2026/Report \"finale\".pdf"), "x").unwrap();
    fs::write(root.join("Lavoro/report.txt"), "x").unwrap();
    fs::write(root.join("foto.jpg"), "x").unwrap();
    let pool = crate::documents::open(&folder.join("db.sqlite3"))
        .await
        .unwrap();
    let filesystem = Filesystem::new(&root).unwrap();
    let (index, changes) = SearchIndex::new(pool.clone(), filesystem.clone());
    assert!(index.found("report").await.is_empty());
    let running = tokio::spawn(index.clone().run(changes, Launcher::new(None)));

    let both = ["Lavoro/2026/Report \"finale\".pdf", "Lavoro/report.txt"];
    eventually(&index, &root, "REPORT", &both).await;
    eventually(
        &index,
        &root,
        "\"fin",
        &["Lavoro/2026/Report \"finale\".pdf"],
    )
    .await;
    // Fewer than three letters read the names one by one.
    eventually(&index, &root, "fo", &["foto.jpg"]).await;
    assert!(index.found("  ").await.is_empty());

    // Followed by inotify: a new folder with what it holds, a folder gone with all it held.
    fs::create_dir_all(root.join("Nuovo/dentro")).unwrap();
    fs::write(root.join("Nuovo/dentro/report-2.txt"), "x").unwrap();
    eventually(
        &index,
        &root,
        "report",
        &[both[0], both[1], "Nuovo/dentro/report-2.txt"],
    )
    .await;
    fs::remove_dir_all(root.join("Lavoro")).unwrap();
    eventually(&index, &root, "report", &["Nuovo/dentro/report-2.txt"]).await;
    fs::rename(root.join("Nuovo"), root.join("Spostato")).unwrap();
    eventually(&index, &root, "report", &["Spostato/dentro/report-2.txt"]).await;

    // What the Explorer does itself is read at once.
    fs::write(root.join("Spostato/fatto.txt"), "x").unwrap();
    index.touched("Spostato/fatto.txt");
    eventually(&index, &root, "fatto", &["Spostato/fatto.txt"]).await;

    // The search of the Explorer and of the launcher take what the index found.
    let app = crate::router(filesystem.clone()).layer(axum::Extension(index.clone()));
    for uri in ["/api/search?query=fatto", "/api/launcher/search?q=fatto"] {
        let response = app
            .clone()
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), 1 << 16)
            .await
            .unwrap();
        assert!(
            String::from_utf8_lossy(&body).contains("fatto.txt"),
            "{uri}"
        );
    }
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/directories")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"path":"Spostato/creata"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    eventually(&index, &root, "creata", &["Spostato/creata"]).await;

    // Off, then on again: the index is whole at once, and reads what changed meanwhile.
    running.abort();
    let _ = running.await;
    fs::write(root.join("Spostato/dentro/report-3.txt"), "x").unwrap();
    let (again, changes) = SearchIndex::new(pool.clone(), filesystem);
    tokio::spawn(again.clone().run(changes, Launcher::new(None)));
    eventually(
        &again,
        &root,
        "report",
        &[
            "Spostato/dentro/report-2.txt",
            "Spostato/dentro/report-3.txt",
        ],
    )
    .await;
}

#[tokio::test]
async fn a_disk_no_longer_there_or_never_finished_leaves_the_index() {
    let folder = scratch();
    let root = folder.join("root");
    let pool = crate::documents::open(&folder.join("db.sqlite3"))
        .await
        .unwrap();
    for (volume, path) in [("old", "/srv/old"), ("", root.to_str().unwrap())] {
        sqlx::query("INSERT INTO search_volumes (volume, path) VALUES (?, ?)")
            .bind(volume)
            .bind(path)
            .execute(&pool)
            .await
            .unwrap();
    }
    for (path, volume) in [("/srv/old/a", "old"), ("/srv/half/a", "half")] {
        sqlx::query(
            "INSERT INTO search_entries (path, parent, volume, folded) VALUES (?, '/srv', ?, 'a')",
        )
        .bind(path)
        .bind(volume)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO search_folders (path, volume, modified_ns) VALUES (?, ?, 1)")
            .bind(path)
            .bind(volume)
            .execute(&pool)
            .await
            .unwrap();
    }
    let (index, _changes) = SearchIndex::new(pool.clone(), Filesystem::new(&root).unwrap());
    let roots = index.roots().await;
    assert_eq!(roots.len(), 1);
    assert!(roots[0].ready);
    let left: Vec<String> = sqlx::query_scalar("SELECT path FROM search_entries")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert!(left.is_empty(), "{left:?}");
    let volumes: Vec<String> = sqlx::query_scalar("SELECT volume FROM search_volumes")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(volumes, [""]);
}

#[tokio::test]
async fn a_folder_removed_takes_only_what_is_under_it() {
    let folder = scratch();
    let pool = crate::documents::open(&folder.join("db.sqlite3"))
        .await
        .unwrap();
    for path in ["/srv/a", "/srv/a/b", "/srv/a b", "/srv/a0", "/srv/ab"] {
        sqlx::query(
            "INSERT INTO search_entries (path, parent, volume, folded) VALUES (?, '/srv', 'v', 'x')",
        )
        .bind(path)
        .execute(&pool)
        .await
        .unwrap();
    }
    let mut transaction = pool.begin().await.unwrap();
    remove_under(&mut transaction, "/srv/a").await.unwrap();
    transaction.commit().await.unwrap();
    let mut left: Vec<String> = sqlx::query_scalar("SELECT path FROM search_entries")
        .fetch_all(&pool)
        .await
        .unwrap();
    left.sort();
    assert_eq!(left, ["/srv/a", "/srv/a b", "/srv/a0", "/srv/ab"]);
}

#[test]
fn the_watches_follow_the_folders_known() {
    let folder = scratch();
    let root = folder.join("root");
    fs::create_dir_all(root.join("a")).unwrap();
    let mut watches = Watches {
        watcher: Some(notify::recommended_watcher(|_| {}).unwrap()),
        ..Watches::default()
    };
    let mut known = Known::new();
    known.insert(root.clone(), 1);
    known.insert(root.join("a"), 1);
    known.insert(root.join("missing"), 1);
    let mut added = watches.follow(&known);
    added.sort();
    assert_eq!(added, [root.clone(), root.join("a")]);
    assert!(watches.polled.contains(&root.join("missing")));
    assert_eq!(watches.over, 0);
    known.remove(&root.join("a"));
    assert!(watches.follow(&known).is_empty());
    assert!(!watches.watched.contains(&root.join("a")));
    assert!(watches.retry(&known).is_empty());
    assert!(Watches::default().follow(&known).is_empty());
}
