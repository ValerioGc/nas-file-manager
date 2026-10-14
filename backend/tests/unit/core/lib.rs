use std::{
    env, fs,
    io::{Cursor, Write},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use super::*;
use image::GenericImageView;

static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

fn test_root() -> PathBuf {
    let path = env::temp_dir().join(format!(
        "fs-explorer-core-{}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&path).unwrap();
    path
}

#[test]
fn lists_and_classifies_entries() {
    let root = test_root();
    fs::create_dir(root.join("assets")).unwrap();
    fs::write(root.join("photo.png"), b"image").unwrap();
    fs::write(root.join("notes.md"), b"notes").unwrap();
    let filesystem = Filesystem::new(&root).unwrap();
    let entries = filesystem.list_directory("").unwrap();

    assert_eq!(entries.len(), 3);
    assert_eq!(entries[0].kind, FileKind::Folder);
    assert_eq!(entries[1].kind, FileKind::Document);
    assert_eq!(entries[2].kind, FileKind::Image);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn nas_with_no_volumes_never_falls_back_to_its_storage_root() {
    let root = test_root();
    fs::write(root.join("private.txt"), b"hidden").unwrap();
    let filesystem = Filesystem::new_nas(&root, vec![]).unwrap();

    assert!(filesystem.list_directory("").unwrap().is_empty());
    assert!(filesystem.search("private").unwrap().is_empty());
    assert_eq!(filesystem.storage_info().unwrap().total_bytes, 0);
    assert_eq!(
        filesystem.read_file("private.txt").unwrap_err().kind(),
        ErrorKind::PermissionDenied
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn nas_exposes_only_the_users_area_under_each_configured_volume() {
    let root = test_root();
    let mount = root.join("volume");
    let user = mount.join(".nas-users/alice");
    fs::create_dir_all(&user).unwrap();
    fs::write(mount.join("other.txt"), b"private").unwrap();
    let filesystem = Filesystem::new_nas(
        &root,
        vec![NasVolume {
            id: "v-a".to_string(),
            name: "Dati".to_string(),
            path: user.clone(),
            kind: StorageKind::Device,
        }],
    )
    .unwrap();

    assert_eq!(filesystem.list_directory("").unwrap()[0].name, "Dati");
    let results = filesystem.search("DATI").unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].name, "Dati");
    assert_eq!(results[0].path, "v-a");
    assert_eq!(filesystem.search("v-a").unwrap()[0].name, "Dati");
    assert!(filesystem.list_directory("v-a").unwrap().is_empty());
    assert_eq!(
        filesystem.create_directory("v-a/Foto").unwrap().path,
        "v-a/Foto"
    );
    assert_eq!(
        filesystem.read_file("volume/other.txt").unwrap_err().kind(),
        ErrorKind::PermissionDenied
    );
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn nas_omits_symlinks_outside_the_user_area() {
    use std::os::unix::fs::symlink;

    let root = test_root();
    let user = root.join("volume/.nas-users/alice");
    fs::create_dir_all(&user).unwrap();
    fs::write(root.join("secret.txt"), b"private").unwrap();
    symlink(root.join("secret.txt"), user.join("secret.txt")).unwrap();
    let filesystem = Filesystem::new_nas(
        &root,
        vec![NasVolume {
            id: "v-a".into(),
            name: "Data".into(),
            path: user,
            kind: StorageKind::Device,
        }],
    )
    .unwrap();

    assert!(filesystem.list_directory("v-a").unwrap().is_empty());
    assert!(filesystem.search("secret").unwrap().is_empty());
    assert_eq!(
        filesystem.read_file("v-a/secret.txt").unwrap_err().kind(),
        ErrorKind::PermissionDenied
    );
    fs::remove_dir_all(root).unwrap();
}

#[cfg(target_os = "linux")]
#[test]
fn nas_registry_rejects_an_unmounted_directory() {
    let root = test_root();
    let user = root.join("v-a");
    fs::create_dir(&user).unwrap();
    let filesystem = Filesystem::new_nas(
        &root,
        vec![NasVolume {
            id: "v-a".into(),
            name: "Data".into(),
            path: user,
            kind: StorageKind::Device,
        }],
    )
    .unwrap();

    assert_eq!(
        filesystem.require_nas_mounts().unwrap_err().kind(),
        ErrorKind::NotFound
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn marks_dot_files_as_hidden() {
    let root = test_root();
    fs::write(root.join(".env"), b"secret").unwrap();
    fs::write(root.join("visible.txt"), b"visible").unwrap();
    let filesystem = Filesystem::new(&root).unwrap();

    let entries = filesystem.list_directory("").unwrap();

    assert_eq!(entries.len(), 2);
    assert!(
        entries
            .iter()
            .find(|entry| entry.name == ".env")
            .unwrap()
            .hidden
    );
    assert!(
        !entries
            .iter()
            .find(|entry| entry.name == "visible.txt")
            .unwrap()
            .hidden
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reads_storage_information_for_the_filesystem_root() {
    let root = test_root();
    let filesystem = Filesystem::new(&root).unwrap();
    let storage = filesystem.storage_info().unwrap();

    assert!(storage.total_bytes > 0);
    assert!(storage.available_bytes <= storage.total_bytes);
    assert_eq!(
        storage.used_bytes,
        storage.total_bytes - storage.available_bytes
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn blocks_paths_outside_the_root() {
    let root = test_root();
    let filesystem = Filesystem::new(&root).unwrap();
    assert_eq!(
        filesystem.list_directory("../").unwrap_err().kind(),
        ErrorKind::PermissionDenied
    );
    assert_eq!(
        filesystem.create_directory("../unsafe").unwrap_err().kind(),
        ErrorKind::PermissionDenied
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn creates_renames_copies_moves_and_deletes_entries() {
    let root = test_root();
    let filesystem = Filesystem::new(&root).unwrap();
    filesystem.create_directory("drafts").unwrap();
    let created = filesystem.create_file("drafts/empty.txt").unwrap();
    assert_eq!(created.name, "empty.txt");
    assert_eq!(
        filesystem
            .create_file("drafts/empty.txt")
            .unwrap_err()
            .kind(),
        ErrorKind::AlreadyExists
    );
    fs::write(root.join("drafts/note.txt"), b"hello").unwrap();
    filesystem.rename("drafts/note.txt", "idea.txt").unwrap();
    filesystem.copy("drafts/idea.txt", "copy.txt").unwrap();
    filesystem.move_entry("copy.txt", "moved.txt").unwrap();
    assert!(root.join("moved.txt").exists());
    filesystem.delete("drafts").unwrap();
    assert!(!root.join("drafts").exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_move_never_puts_a_folder_inside_itself() {
    let root = test_root();
    let filesystem = Filesystem::new(&root).unwrap();
    filesystem.create_directory("photos").unwrap();
    filesystem.create_directory("photos/2026").unwrap();

    assert_eq!(
        filesystem
            .move_entry("photos", "photos/2026/photos")
            .unwrap_err()
            .kind(),
        ErrorKind::InvalidInput
    );
    assert!(root.join("photos/2026").is_dir());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_move_to_another_disk_copies_and_then_removes_the_original() {
    let root = test_root();
    fs::create_dir_all(root.join("album/inner")).unwrap();
    fs::write(root.join("album/inner/photo.png"), b"image").unwrap();
    fs::write(root.join("note.txt"), b"note").unwrap();

    move_across_devices(&root.join("album"), &root.join("moved")).unwrap();
    move_across_devices(&root.join("note.txt"), &root.join("moved/note.txt")).unwrap();

    assert!(!root.join("album").exists());
    assert!(!root.join("note.txt").exists());
    assert_eq!(
        fs::read(root.join("moved/inner/photo.png")).unwrap(),
        b"image"
    );
    assert_eq!(fs::read(root.join("moved/note.txt")).unwrap(), b"note");

    // A copy that cannot finish leaves the original and nothing half written.
    fs::write(root.join("kept.txt"), b"kept").unwrap();
    assert!(move_across_devices(&root.join("kept.txt"), &root.join("missing/kept.txt")).is_err());
    assert!(root.join("kept.txt").exists());
    assert!(!root.join("missing").exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn writes_and_reads_files_inside_the_root() {
    let root = test_root();
    let filesystem = Filesystem::new(&root).unwrap();

    let entry = filesystem.write_file("upload.txt", b"uploaded").unwrap();
    let (downloaded, bytes) = filesystem.read_file("upload.txt").unwrap();

    assert_eq!(entry.name, "upload.txt");
    assert_eq!(downloaded.path, "upload.txt");
    assert_eq!(bytes, b"uploaded");
    assert_eq!(
        filesystem.read_file("").unwrap_err().kind(),
        ErrorKind::InvalidInput
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn rejects_unsafe_names_and_root_mutation() {
    let root = test_root();
    let filesystem = Filesystem::new(&root).unwrap();
    assert_eq!(
        filesystem.rename("", "../bad").unwrap_err().kind(),
        ErrorKind::InvalidInput
    );
    assert_eq!(
        filesystem.delete("").unwrap_err().kind(),
        ErrorKind::PermissionDenied
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn searches_recursively() {
    let root = test_root();
    fs::create_dir(root.join("nested")).unwrap();
    fs::write(root.join("nested/report.md"), "report").unwrap();
    let filesystem = Filesystem::new(&root).unwrap();

    let entries = filesystem.search("report").unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].path, "nested/report.md");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn the_search_takes_what_the_index_found_and_reads_it_again_from_the_disk() {
    let root = test_root().canonicalize().unwrap();
    fs::create_dir(root.join("nested")).unwrap();
    fs::write(root.join("nested/report.md"), "report").unwrap();
    fs::write(root.join("walked-report.md"), "report").unwrap();
    let filesystem = Filesystem::new(&root).unwrap();
    assert_eq!(filesystem.search_roots(), [(String::new(), root.clone())]);
    assert_eq!(
        filesystem.folder_of("nested/report.md"),
        Some(root.join("nested"))
    );
    assert_eq!(filesystem.folder_of("../outside"), None);

    // The index holds the root whole: what it found is read again, what is gone is left out.
    let indexed = HashMap::from([(
        root.clone(),
        vec![root.join("nested/report.md"), root.join("gone.md")],
    )]);
    let entries = filesystem.search_with("report", &indexed).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].path, "nested/report.md");
    assert_eq!(entries[0].size, Some(6));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn the_index_covers_the_disks_and_leaves_the_network_shares_to_the_walk() {
    let root = test_root().canonicalize().unwrap();
    let (disk, share) = (root.join("disk"), root.join("share"));
    fs::create_dir_all(disk.join("Foto")).unwrap();
    fs::create_dir_all(&share).unwrap();
    fs::write(share.join("foto-rete.jpg"), "x").unwrap();
    let filesystem = Filesystem::new_nas(
        &root,
        vec![
            NasVolume {
                id: "v-disk".to_string(),
                name: "Dati".to_string(),
                path: disk.clone(),
                kind: StorageKind::Device,
            },
            NasVolume {
                id: "v-share".to_string(),
                name: "Rete".to_string(),
                path: share.clone(),
                kind: StorageKind::Network,
            },
        ],
    )
    .unwrap();
    assert_eq!(
        filesystem.search_roots(),
        [("v-disk".to_string(), disk.clone())]
    );
    let indexed = HashMap::from([(disk.clone(), vec![disk.join("Foto")])]);
    let mut paths: Vec<String> = filesystem
        .search_with("foto", &indexed)
        .unwrap()
        .into_iter()
        .map(|entry| entry.path)
        .collect();
    paths.sort();
    assert_eq!(paths, ["v-disk/Foto", "v-share/foto-rete.jpg"]);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn creates_and_reuses_cached_previews_without_exposing_cache_files() {
    let root = test_root();
    let image = image::RgbaImage::from_pixel(16, 8, image::Rgba([12, 34, 56, 255]));
    image.save(root.join("photo.png")).unwrap();
    let filesystem = Filesystem::new(&root).unwrap();

    let first = filesystem.preview("photo.png", PreviewSize::Large).unwrap();
    let second = filesystem.preview("photo.png", PreviewSize::Large).unwrap();
    let entries = filesystem.list_directory("").unwrap();

    assert_eq!(first.content_type, "image/jpeg");
    assert!(first.bytes.len() > 8);
    assert!(!first.cache_hit);
    assert!(second.cache_hit);
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].name, "photo.png");
    fs::remove_dir_all(root).unwrap();
}

/// A JPEG of `width` by `height` that says, in its EXIF, to be turned by `orientation`.
fn jpeg_with_orientation(path: &Path, width: u32, height: u32, orientation: u16) {
    let image = image::RgbImage::from_pixel(width, height, image::Rgb([200, 120, 40]));
    let mut plain = Cursor::new(Vec::new());
    image
        .write_to(&mut plain, image::ImageFormat::Jpeg)
        .unwrap();
    let plain = plain.into_inner();
    // APP1 with a little-endian TIFF header and one IFD entry: Orientation (0x0112), SHORT, 1.
    let mut tiff = b"II*\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0".to_vec();
    tiff.extend_from_slice(&orientation.to_le_bytes());
    tiff.extend_from_slice(&[0, 0, 0, 0, 0, 0]);
    let mut app1 = b"Exif\0\0".to_vec();
    app1.extend_from_slice(&tiff);
    let mut bytes = plain[..2].to_vec();
    bytes.extend_from_slice(&[0xff, 0xe1]);
    bytes.extend_from_slice(&u16::try_from(app1.len() + 2).unwrap().to_be_bytes());
    bytes.extend_from_slice(&app1);
    bytes.extend_from_slice(&plain[2..]);
    fs::write(path, bytes).unwrap();
}

#[test]
fn makes_jpeg_previews_of_photos_png_of_transparent_images_at_two_sizes() {
    let root = test_root();
    image::RgbImage::from_pixel(1200, 600, image::Rgb([10, 200, 90]))
        .save(root.join("photo.jpg"))
        .unwrap();
    image::RgbaImage::from_pixel(64, 32, image::Rgba([10, 20, 30, 100]))
        .save(root.join("icon.png"))
        .unwrap();
    let filesystem = Filesystem::new(&root).unwrap();

    assert!(filesystem
        .cached_preview("photo.jpg", PreviewSize::Small)
        .unwrap()
        .is_none());
    let small = filesystem.preview("photo.jpg", PreviewSize::Small).unwrap();
    let large = filesystem.preview("photo.jpg", PreviewSize::Large).unwrap();
    assert_eq!(small.content_type, "image/jpeg");
    assert_eq!(
        image::load_from_memory(&small.bytes).unwrap().dimensions(),
        (256, 128)
    );
    assert_eq!(
        image::load_from_memory(&large.bytes).unwrap().dimensions(),
        (640, 320)
    );
    assert!(filesystem
        .cached_preview("photo.jpg", PreviewSize::Small)
        .unwrap()
        .is_some_and(|preview| preview.cache_hit));

    let transparent = filesystem.preview("icon.png", PreviewSize::Small).unwrap();
    assert_eq!(transparent.content_type, "image/png");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn turns_a_photo_as_its_camera_said() {
    let root = test_root();
    // Orientation 6: the photo was taken with the camera turned, and shows upright turned by 90°.
    jpeg_with_orientation(&root.join("phone.jpg"), 40, 20, 6);
    let filesystem = Filesystem::new(&root).unwrap();

    let preview = filesystem.preview("phone.jpg", PreviewSize::Small).unwrap();

    assert_eq!(
        image::load_from_memory(&preview.bytes)
            .unwrap()
            .dimensions(),
        (20, 40)
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn keeps_the_previews_under_their_limit_dropping_those_read_least_recently() {
    let root = test_root();
    for name in ["a", "b", "c", "d"] {
        image::RgbImage::from_fn(300, 300, |x, y| {
            image::Rgb([x as u8, y as u8, name.as_bytes()[0]])
        })
        .save(root.join(format!("{name}.png")))
        .unwrap();
    }
    let filesystem = Filesystem::new(&root).unwrap();
    let first = filesystem.preview("a.png", PreviewSize::Small).unwrap();
    let size = first.bytes.len() as u64;
    // Room for two and a half previews: the third one prunes to nine tenths of it.
    filesystem.set_preview_cache_limit(size * 5 / 2);
    assert_eq!(filesystem.preview_cache_limit(), size * 5 / 2);
    std::thread::sleep(std::time::Duration::from_millis(20));
    filesystem.preview("b.png", PreviewSize::Small).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    // Read again, "a" is now the most recent.
    assert!(
        filesystem
            .preview("a.png", PreviewSize::Small)
            .unwrap()
            .cache_hit
    );
    std::thread::sleep(std::time::Duration::from_millis(20));
    filesystem.preview("c.png", PreviewSize::Small).unwrap();

    assert!(filesystem.preview_cache_usage().unwrap() <= size * 5 / 2);
    assert!(filesystem
        .cached_preview("b.png", PreviewSize::Small)
        .unwrap()
        .is_none());
    assert!(filesystem
        .cached_preview("a.png", PreviewSize::Small)
        .unwrap()
        .is_some());

    // A lower limit prunes at once; emptying leaves nothing.
    filesystem.set_preview_cache_limit(1);
    filesystem.prune_preview_cache_to_limit().unwrap();
    assert!(filesystem.preview_cache_usage().unwrap() <= 1);
    filesystem.preview("d.png", PreviewSize::Small).unwrap();
    filesystem.clear_preview_cache().unwrap();
    assert_eq!(filesystem.preview_cache_usage().unwrap(), 0);
    filesystem.clear_preview_cache().unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_preview_keeps_its_name_from_one_build_to_the_next() {
    // FNV-1a of "a" and its separator, fixed: a change of the compiler never renames the cache.
    assert_eq!(fnv1a(&[b"a"]), 0x089b_c907_b544_c769);
    let root = test_root();
    image::RgbImage::from_pixel(8, 8, image::Rgb([1, 2, 3]))
        .save(root.join("same.png"))
        .unwrap();
    Filesystem::new(&root)
        .unwrap()
        .preview("same.png", PreviewSize::Small)
        .unwrap();
    let again = Filesystem::new(&root).unwrap();
    assert!(
        again
            .preview("same.png", PreviewSize::Small)
            .unwrap()
            .cache_hit
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn caches_a_safe_poster_for_non_image_files() {
    let root = test_root();
    fs::write(root.join("clip.mp4"), b"not a real video").unwrap();
    let filesystem = Filesystem::new(&root).unwrap();

    let first = filesystem.preview("clip.mp4", PreviewSize::Large).unwrap();
    let second = filesystem.preview("clip.mp4", PreviewSize::Large).unwrap();

    assert_eq!(first.content_type, "image/svg+xml");
    assert!(String::from_utf8(first.bytes).unwrap().contains("VIDEO"));
    assert!(second.cache_hit);
    assert_eq!(
        filesystem
            .list_directory(".fs-explorer-cache")
            .unwrap_err()
            .kind(),
        ErrorKind::PermissionDenied
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn serves_svg_images_as_real_previews() {
    let root = test_root();
    fs::write(
            root.join("logo.svg"),
            br#"<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>"#,
        )
        .unwrap();
    let filesystem = Filesystem::new(&root).unwrap();

    let preview = filesystem.preview("logo.svg", PreviewSize::Large).unwrap();
    let cached = filesystem.preview("logo.svg", PreviewSize::Large).unwrap();

    assert_eq!(preview.content_type, "image/svg+xml");
    assert!(String::from_utf8(preview.bytes).unwrap().contains("<svg"));
    assert!(cached.cache_hit);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn gives_an_oversized_svg_the_poster_of_images() {
    let root = test_root();
    let mut drawing = br#"<svg xmlns="http://www.w3.org/2000/svg">"#.to_vec();
    drawing.resize(MAX_SVG_PREVIEW_BYTES as usize + 1, b' ');
    fs::write(root.join("huge.svg"), drawing).unwrap();
    let filesystem = Filesystem::new(&root).unwrap();

    let preview = filesystem.preview("huge.svg", PreviewSize::Large).unwrap();

    assert!(preview.bytes.len() < 64 * 1024);
    assert!(String::from_utf8(preview.bytes)
        .unwrap()
        .contains("huge.svg"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn lists_zip_entries_without_external_archiver() {
    let root = test_root();
    let archive_path = root.join("sample.zip");
    let file = fs::File::create(&archive_path).unwrap();
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    writer.add_directory("docs/", options).unwrap();
    writer.start_file("docs/read me!.txt", options).unwrap();
    writer.write_all(b"archive content").unwrap();
    writer.finish().unwrap();

    let filesystem = Filesystem::new(&root).unwrap();
    let entries = filesystem.list_archive("sample.zip", None).unwrap();

    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].kind, FileKind::Folder);
    assert_eq!(entries[1].path, "docs/read me!.txt");
    assert_eq!(entries[1].size, Some(15));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn rejects_unsafe_archive_paths() {
    assert!(sanitize_archive_path("../outside.txt").is_none());
    assert!(sanitize_archive_path("C:/outside.txt").is_none());
    assert!(sanitize_archive_path("/outside.txt").is_none());
    assert_eq!(
        sanitize_archive_path("docs\\read me!.txt"),
        Some("docs/read me!.txt".to_string())
    );
}

#[test]
fn preserves_special_characters_for_native_passwords() {
    let password = "P@ss word! € & [x]";
    let _password_value = Password::from(password);
}
