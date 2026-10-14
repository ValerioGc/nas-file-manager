use super::*;
use std::sync::atomic::AtomicU64;

static NEXT: AtomicU64 = AtomicU64::new(0);

fn scratch() -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "fs-explorer-trash-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).unwrap();
    path.canonicalize().unwrap()
}

/// A NAS with two disks, `v-a` and `v-b`, and the trash on.
fn nas() -> (PathBuf, Filesystem) {
    let root = scratch();
    for disk in ["a", "b"] {
        fs::create_dir_all(root.join(disk)).unwrap();
    }
    let filesystem = Filesystem::new_nas(
        &root,
        ["a", "b"]
            .iter()
            .map(|disk| NasVolume {
                id: format!("v-{disk}"),
                name: format!("Disco {disk}"),
                path: root.join(disk),
                kind: StorageKind::Device,
            })
            .collect(),
    )
    .unwrap();
    filesystem.set_trash(true);
    (root, filesystem)
}

#[test]
fn a_deletion_goes_to_the_trash_of_its_disk_with_its_tree_one_version_each() {
    let (root, filesystem) = nas();
    fs::create_dir_all(root.join("a/example")).unwrap();
    fs::write(root.join("a/example/a.pdf"), "first").unwrap();
    fs::write(root.join("a/example/b.pdf"), "other").unwrap();
    filesystem.delete("v-a/example/a.pdf").unwrap();
    filesystem.delete("v-a/example/b.pdf").unwrap();
    assert_eq!(
        fs::read_to_string(root.join("a/.nas-trash/example/a.pdf")).unwrap(),
        "first"
    );
    assert_eq!(
        fs::metadata(root.join("a/.nas-trash"))
            .unwrap()
            .permissions()
            .mode()
            & 0o7777,
        0o2770
    );
    // A new deletion of the same path replaces the one in the trash.
    fs::write(root.join("a/example/a.pdf"), "second").unwrap();
    filesystem.delete("v-a/example/a.pdf").unwrap();
    assert_eq!(
        fs::read_to_string(root.join("a/.nas-trash/example/a.pdf")).unwrap(),
        "second"
    );
    // The trash is never listed, searched or reached as a folder.
    let listed: Vec<String> = filesystem
        .list_directory("v-a")
        .unwrap()
        .into_iter()
        .map(|entry| entry.name)
        .collect();
    assert_eq!(listed, ["example"]);
    assert!(filesystem.search("pdf").unwrap().is_empty());
    assert_eq!(
        filesystem
            .list_directory("v-a/.nas-trash")
            .unwrap_err()
            .kind(),
        ErrorKind::PermissionDenied
    );

    let disks = filesystem.trash_disks();
    assert_eq!(disks[0].id, "v-a");
    assert_eq!((disks[0].items, disks[0].bytes), (1, 11));
    assert_eq!(disks[1].items, 0);
    let top = filesystem.trash_list("v-a").unwrap();
    assert_eq!(top[0].path, "v-a/example");
    assert_eq!(top[0].kind, FileKind::Folder);
    assert!(top[0].deleted_at > 0);
    let inside = filesystem.trash_list("v-a/example").unwrap();
    assert_eq!(
        inside
            .iter()
            .map(|entry| entry.name.as_str())
            .collect::<Vec<_>>(),
        ["a.pdf", "b.pdf"]
    );
    assert!(filesystem.trash_list("v-b/missing").unwrap().is_empty());
}

#[test]
fn an_entry_goes_back_where_it_was_and_asks_before_replacing() {
    let (root, filesystem) = nas();
    fs::create_dir_all(root.join("a/docs/deep")).unwrap();
    fs::write(root.join("a/docs/deep/note.txt"), "old").unwrap();
    filesystem.delete("v-a/docs").unwrap();
    assert!(!root.join("a/docs").exists());
    let restored = filesystem.restore("v-a/docs", false).unwrap();
    assert_eq!(restored.path, "v-a/docs");
    assert_eq!(
        fs::read_to_string(root.join("a/docs/deep/note.txt")).unwrap(),
        "old"
    );
    // The folder left empty in the trash goes.
    assert!(!root.join("a/.nas-trash/docs").exists());
    assert!(root.join("a/.nas-trash").exists());

    filesystem.delete("v-a/docs/deep/note.txt").unwrap();
    fs::write(root.join("a/docs/deep/note.txt"), "new").unwrap();
    assert_eq!(
        filesystem
            .restore("v-a/docs/deep/note.txt", false)
            .unwrap_err()
            .kind(),
        ErrorKind::AlreadyExists
    );
    filesystem.restore("v-a/docs/deep/note.txt", true).unwrap();
    assert_eq!(
        fs::read_to_string(root.join("a/docs/deep/note.txt")).unwrap(),
        "old"
    );
    // A folder whose parent went meanwhile gets it back.
    filesystem.delete("v-a/docs/deep/note.txt").unwrap();
    fs::remove_dir_all(root.join("a/docs")).unwrap();
    filesystem.restore("v-a/docs/deep/note.txt", false).unwrap();
    assert!(root.join("a/docs/deep/note.txt").exists());
    assert_eq!(
        filesystem.restore("v-a/nothing", false).unwrap_err().kind(),
        ErrorKind::NotFound
    );
}

#[test]
fn the_trash_is_emptied_by_entry_by_disk_or_whole_and_expires_file_by_file() {
    let (root, filesystem) = nas();
    for path in ["a/one/x.txt", "a/two.txt", "b/three.txt"] {
        fs::create_dir_all(root.join(path).parent().unwrap()).unwrap();
        fs::write(root.join(path), "x").unwrap();
    }
    filesystem.delete("v-a/one").unwrap();
    filesystem.delete("v-a/two.txt").unwrap();
    filesystem.delete("v-b/three.txt").unwrap();
    filesystem.purge("v-a/two.txt").unwrap();
    assert!(!root.join("a/.nas-trash/two.txt").exists());
    assert_eq!(
        filesystem.purge("v-a/two.txt").unwrap_err().kind(),
        ErrorKind::NotFound
    );

    let files = filesystem.trash_files();
    assert_eq!(
        files
            .iter()
            .map(|file| file.path.clone())
            .collect::<Vec<_>>(),
        [
            root.join("a/.nas-trash/one/x.txt"),
            root.join("b/.nas-trash/three.txt")
        ]
    );
    filesystem.expire(&files[0].path).unwrap();
    assert!(!root.join("a/.nas-trash/one").exists());
    assert_eq!(
        filesystem
            .expire(&root.join("a/visible.txt"))
            .unwrap_err()
            .kind(),
        ErrorKind::PermissionDenied
    );

    filesystem.empty_trash(Some("v-a")).unwrap();
    assert!(root.join("b/.nas-trash/three.txt").exists());
    filesystem.empty_trash(None).unwrap();
    assert!(!root.join("b/.nas-trash/three.txt").exists());
}

#[test]
fn with_the_trash_off_a_deletion_is_for_good_and_in_development_the_root_is_the_disk() {
    let root = scratch();
    fs::write(root.join("gone.txt"), "x").unwrap();
    fs::write(root.join("kept.txt"), "x").unwrap();
    let filesystem = Filesystem::new(&root).unwrap();
    assert!(!filesystem.trash_enabled());
    filesystem.delete("gone.txt").unwrap();
    assert!(!root.join(".nas-trash").exists());
    filesystem.mark_trash();
    assert!(root.join(".nas-trash-off").exists());
    assert!(filesystem
        .list_directory("")
        .unwrap()
        .iter()
        .all(|entry| entry.name != ".nas-trash-off"));
    filesystem.set_trash(true);
    filesystem.mark_trash();
    assert!(!root.join(".nas-trash-off").exists());
    filesystem.delete("kept.txt").unwrap();
    assert_eq!(filesystem.trash_list("").unwrap()[0].path, "kept.txt");
    assert_eq!(filesystem.trash_disks()[0].id, "");
    assert_eq!(
        filesystem.list_directory(".nas-trash").unwrap_err().kind(),
        ErrorKind::PermissionDenied
    );
}

#[test]
fn trash_operations_refuse_linked_directories_and_never_operate_outside_the_disk() {
    use std::os::unix::fs::symlink;
    let (root, filesystem) = nas();
    let outside = root.join("outside");
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("kept.txt"), "keep").unwrap();
    let trash = root.join("a/.nas-trash");
    symlink(&outside, &trash).unwrap();
    assert!(filesystem.empty_trash(None).is_err());
    assert!(filesystem.trash_list("v-a").is_err());
    assert!(filesystem.trash_files().is_empty());
    assert_eq!(filesystem.trash_disks()[0].bytes, 0);
    fs::write(root.join("a/kept.txt"), "source").unwrap();
    assert!(filesystem.delete("v-a/kept.txt").is_err());
    fs::remove_file(&trash).unwrap();
    fs::create_dir(&trash).unwrap();
    symlink(&outside, trash.join("link")).unwrap();
    for result in [
        filesystem.purge("v-a/link/kept.txt"),
        filesystem.restore("v-a/link/kept.txt", true).map(|_| ()),
        filesystem.expire(&trash.join("link/kept.txt")),
    ] {
        assert_eq!(result.unwrap_err().kind(), ErrorKind::PermissionDenied);
    }
    assert!(filesystem.trash_list("v-a/link").is_err());
    assert!(filesystem.purge("v-a").is_err());
    assert!(filesystem.restore("v-a", true).is_err());
    assert!(filesystem
        .expire(&outside.join(".nas-trash/kept.txt"))
        .is_err());
    assert_eq!(
        fs::read_to_string(outside.join("kept.txt")).unwrap(),
        "keep"
    );
    assert_eq!(
        fs::read_to_string(root.join("a/kept.txt")).unwrap(),
        "source"
    );
    // A leaf link is moved or removed as an entry, without following its target.
    filesystem.purge("v-a/link").unwrap();
    assert!(outside.join("kept.txt").exists());
}

#[test]
fn trash_parents_are_writable_by_the_storage_group_and_restore_refuses_a_linked_destination() {
    use std::os::unix::fs::symlink;
    let (root, filesystem) = nas();
    fs::create_dir_all(root.join("a/docs/deep")).unwrap();
    fs::write(root.join("a/docs/deep/a.txt"), "old").unwrap();
    filesystem.delete("v-a/docs/deep/a.txt").unwrap();
    for directory in [
        "a/.nas-trash",
        "a/.nas-trash/docs",
        "a/.nas-trash/docs/deep",
    ] {
        assert_eq!(
            fs::metadata(root.join(directory))
                .unwrap()
                .permissions()
                .mode()
                & 0o7777,
            0o2770
        );
    }
    fs::remove_dir_all(root.join("a/docs")).unwrap();
    fs::create_dir(root.join("outside")).unwrap();
    fs::write(root.join("outside/a.txt"), "keep").unwrap();
    symlink(root.join("outside"), root.join("a/docs")).unwrap();
    assert!(filesystem.restore("v-a/docs/deep/a.txt", true).is_err());
    assert!(root.join("a/.nas-trash/docs/deep/a.txt").exists());
    assert_eq!(
        fs::read_to_string(root.join("outside/a.txt")).unwrap(),
        "keep"
    );
}

#[test]
fn a_new_deletion_into_the_same_directory_does_not_reset_a_siblings_age() {
    let (root, filesystem) = nas();
    fs::create_dir_all(root.join("a/docs")).unwrap();
    fs::write(root.join("a/docs/old.txt"), "old").unwrap();
    filesystem.delete("v-a/docs/old.txt").unwrap();
    let first = filesystem.trash_list("v-a/docs").unwrap()[0].deleted_at;
    std::thread::sleep(std::time::Duration::from_millis(1100));
    fs::write(root.join("a/docs/new.txt"), "new").unwrap();
    filesystem.delete("v-a/docs/new.txt").unwrap();
    let entries = filesystem.trash_list("v-a/docs").unwrap();
    assert_eq!(
        entries
            .iter()
            .find(|entry| entry.name == "old.txt")
            .unwrap()
            .deleted_at,
        first
    );
    assert!(
        entries
            .iter()
            .find(|entry| entry.name == "new.txt")
            .unwrap()
            .deleted_at
            > first
    );
}
