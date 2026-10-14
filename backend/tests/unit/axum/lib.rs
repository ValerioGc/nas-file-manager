use std::{
    env, fs,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

use super::*;

static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

fn test_filesystem() -> (Filesystem, std::path::PathBuf) {
    let root = env::temp_dir().join(format!(
        "fs-explorer-axum-{}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&root).unwrap();
    fs::write(root.join("readme.md"), "hello").unwrap();
    (Filesystem::new(&root).unwrap(), root)
}

fn json_request(method: &str, uri: &str, body: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json")
        .body(Body::from(body.to_owned()))
        .unwrap()
}

#[tokio::test]
async fn launcher_search_maps_files_and_filters_types() {
    let (filesystem, root) = test_filesystem();
    fs::create_dir(root.join("Documents")).unwrap();
    fs::write(root.join("Documents/report.mp3"), b"audio").unwrap();
    let app = router(filesystem);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/launcher/search?q=report&type=audio&ext=mp3")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let text = String::from_utf8(body.to_vec()).unwrap();
    assert!(text.contains("\"type\":\"audio\""));
    assert!(
        text.contains("\"target\":\"?path=%2FDocuments&select=report.mp3\""),
        "{text}"
    );
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn searches_use_volume_labels_and_preserve_navigation_ids() {
    let (_, root) = test_filesystem();
    let user = root.join("uuid-volume/.nas-users/alice");
    fs::create_dir_all(user.join("Documents")).unwrap();
    fs::write(user.join("Documents/report.txt"), b"report").unwrap();
    let filesystem = Filesystem::new_nas(
        &root,
        vec![fs_core::NasVolume {
            id: "uuid-volume".to_owned(),
            name: "Archivio".to_owned(),
            path: user,
            kind: fs_core::StorageKind::Device,
        }],
    )
    .unwrap();
    let app = router(filesystem);
    for (uri, name, path, target) in [
        (
            "/api/search?query=archivio",
            "Archivio",
            "uuid-volume",
            None,
        ),
        (
            "/api/launcher/search?q=archivio",
            "Archivio",
            "/Archivio",
            Some("?path=%2Fuuid-volume"),
        ),
        (
            "/api/launcher/search?q=report",
            "report.txt",
            "/Archivio/Documents/report.txt",
            Some("?path=%2Fuuid-volume%2FDocuments&select=report.txt"),
        ),
    ] {
        let response = app
            .clone()
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let text = String::from_utf8(body.to_vec()).unwrap();
        assert!(text.contains(&format!("\"name\":\"{name}\"")), "{text}");
        assert!(text.contains(&format!("\"path\":\"{path}\"")), "{text}");
        if let Some(target) = target {
            assert!(text.contains(&format!("\"target\":\"{target}\"")), "{text}");
            assert!(text.contains("\"id\":\"/uuid-volume"), "{text}");
        }
    }
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn health_and_listing_are_available() {
    let (filesystem, root) = test_filesystem();
    let app = router(filesystem);
    let health = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let files = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/files")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(health.status(), StatusCode::OK);
    assert_eq!(files.status(), StatusCode::OK);
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn an_empty_nas_registry_exposes_no_host_files_through_any_file_api() {
    let (_, root) = test_filesystem();
    let filesystem = Filesystem::new_nas(&root, vec![]).unwrap();
    let app = router(filesystem);
    for uri in [
        "/api/files",
        "/api/search?query=readme",
        "/api/launcher/search?q=readme",
    ] {
        let response = app
            .clone()
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{uri}");
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(&body[..], b"[]", "{uri}");
    }
    let write = app
        .oneshot(json_request(
            "POST",
            "/api/directories",
            r#"{"path":"private"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(write.status(), StatusCode::FORBIDDEN);
    assert!(!root.join("private").exists());
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn traversal_is_forbidden() {
    let (filesystem, root) = test_filesystem();
    let response = router(filesystem)
        .oneshot(
            Request::builder()
                .uri("/api/files?path=..%2F")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn mutating_routes_create_rename_copy_move_and_delete() {
    let (filesystem, root) = test_filesystem();
    fs::write(root.join("source.txt"), "source").unwrap();
    let app = router(filesystem);

    let create = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/directories",
            r#"{"path":"drafts"}"#,
        ))
        .await
        .unwrap();
    let create_file = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/files",
            r#"{"path":"drafts/empty.txt"}"#,
        ))
        .await
        .unwrap();
    let duplicate_file = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/files",
            r#"{"path":"drafts/empty.txt"}"#,
        ))
        .await
        .unwrap();
    let rename = app
        .clone()
        .oneshot(json_request(
            "PATCH",
            "/api/files",
            r#"{"path":"drafts","name":"notes"}"#,
        ))
        .await
        .unwrap();
    let copy = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/copy",
            r#"{"source":"source.txt","destination":"copy.txt"}"#,
        ))
        .await
        .unwrap();
    let move_entry = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/move",
            r#"{"source":"copy.txt","destination":"notes/copy.txt"}"#,
        ))
        .await
        .unwrap();
    let delete = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/api/files?path=notes%2Fcopy.txt")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let search = app
        .oneshot(
            Request::builder()
                .uri("/api/search?query=source")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(create.status(), StatusCode::CREATED);
    assert_eq!(create_file.status(), StatusCode::CREATED);
    assert_eq!(duplicate_file.status(), StatusCode::CONFLICT);
    assert_eq!(rename.status(), StatusCode::OK);
    assert_eq!(copy.status(), StatusCode::CREATED);
    assert_eq!(move_entry.status(), StatusCode::OK);
    assert_eq!(delete.status(), StatusCode::NO_CONTENT);
    assert_eq!(search.status(), StatusCode::OK);
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn api_maps_common_filesystem_errors_to_http_statuses() {
    let (filesystem, root) = test_filesystem();
    let app = router(filesystem);

    let conflict = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/directories",
            r#"{"path":"readme.md"}"#,
        ))
        .await
        .unwrap();
    let forbidden = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/api/files?path=")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(conflict.status(), StatusCode::CONFLICT);
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn serves_cached_preview_content() {
    let (filesystem, root) = test_filesystem();
    fs::write(root.join("clip.mp4"), "video").unwrap();

    let response = router(filesystem)
        .oneshot(
            Request::builder()
                .uri("/api/previews?path=clip.mp4")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get(CONTENT_TYPE).unwrap(),
        "image/svg+xml"
    );
    assert_eq!(response.headers().get(CACHE_CONTROL).unwrap(), "no-cache");
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn a_preview_named_with_its_version_is_kept_by_the_browser() {
    let (filesystem, root) = test_filesystem();
    image::RgbImage::from_pixel(900, 300, image::Rgb([9, 99, 199]))
        .save(root.join("wide.jpg"))
        .unwrap();
    let app = router(filesystem);
    for _ in 0..2 {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/previews?path=wide.jpg&size=small&v=1-2")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers().get(CONTENT_TYPE).unwrap(), "image/jpeg");
        assert_eq!(
            response.headers().get(CACHE_CONTROL).unwrap(),
            "private, max-age=31536000, immutable"
        );
        let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
            .await
            .unwrap();
        assert_eq!(image::load_from_memory(&bytes).unwrap().width(), 256);
    }
    let refused = app
        .oneshot(
            Request::builder()
                .uri("/api/previews?path=wide.jpg&size=huge")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(refused.status(), StatusCode::BAD_REQUEST);
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn uploads_and_downloads_file_content() {
    let (filesystem, root) = test_filesystem();
    let app = router(filesystem);
    let upload = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/uploads?path=upload.txt")
                .body(Body::from("uploaded"))
                .unwrap(),
        )
        .await
        .unwrap();
    let download = app
        .oneshot(
            Request::builder()
                .uri("/api/downloads?path=upload.txt")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(upload.status(), StatusCode::CREATED);
    assert_eq!(download.status(), StatusCode::OK);
    assert_eq!(
        download.headers().get(CONTENT_TYPE).unwrap(),
        "application/octet-stream"
    );
    let body = axum::body::to_bytes(download.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(&body[..], b"uploaded");
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn refuses_to_download_a_folder_or_a_missing_file() {
    let (filesystem, root) = test_filesystem();
    let app = router(filesystem);
    fs::create_dir(root.join("folder")).unwrap();

    for (path, status) in [
        ("folder", StatusCode::BAD_REQUEST),
        ("missing.txt", StatusCode::NOT_FOUND),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/downloads?path={path}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), status, "{path}");
    }
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn answers_health_storage_and_volumes_and_refuses_a_request_without_a_path() {
    let (filesystem, root) = test_filesystem();
    let app = router(filesystem);
    let call = |method: &str, uri: &str| {
        let request = Request::builder()
            .method(method)
            .uri(uri)
            .body(Body::empty())
            .unwrap();
        app.clone().oneshot(request)
    };

    assert_eq!(
        call("GET", "/health").await.unwrap().status(),
        StatusCode::OK
    );
    assert_eq!(
        call("GET", "/api/health").await.unwrap().status(),
        StatusCode::OK
    );
    assert_eq!(
        call("GET", "/api/storage").await.unwrap().status(),
        StatusCode::OK
    );
    assert_eq!(
        call("GET", "/api/volumes").await.unwrap().status(),
        StatusCode::OK
    );
    for (method, uri) in [
        ("GET", "/api/previews?path="),
        ("POST", "/api/uploads"),
        ("GET", "/api/downloads"),
    ] {
        let response = call(method, uri).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{uri}");
    }
    let archive = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/api/archives/list",
            r#"{"path":"readme.md"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(archive.status(), StatusCode::BAD_REQUEST);
    fs::remove_dir_all(root).unwrap();
}
