use super::*;
use axum::body::Body;
use axum::http::Request;
use std::collections::HashMap;
use std::{
    fs,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};
use tower::ServiceExt;

static NEXT: AtomicU64 = AtomicU64::new(0);

async fn call(router: &Router, method: &str, uri: &str) -> (StatusCode, serde_json::Value) {
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(uri)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1 << 16)
        .await
        .unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or_default())
}

/// The cache of that id, as the launcher reads it.
fn cache<'a>(listed: &'a serde_json::Value, id: &str) -> &'a serde_json::Value {
    listed["caches"]
        .as_array()
        .unwrap()
        .iter()
        .find(|cache| cache["id"] == id)
        .unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn the_launcher_reads_and_empties_the_previews_and_the_index() {
    let folder = std::env::temp_dir().join(format!(
        "fs-explorer-caches-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = fs::remove_dir_all(&folder);
    fs::create_dir_all(folder.join("root")).unwrap();
    image::RgbImage::from_pixel(400, 400, image::Rgb([1, 2, 3]))
        .save(folder.join("root/photo.png"))
        .unwrap();
    let pool = crate::documents::open(&folder.join("db.sqlite3"))
        .await
        .unwrap();
    let filesystem = Filesystem::new(folder.join("root")).unwrap();
    filesystem
        .preview("photo.png", fs_core::PreviewSize::Small)
        .unwrap();
    let (search, changes) = SearchIndex::new(pool, filesystem.clone());
    tokio::spawn(
        search
            .clone()
            .run(changes, crate::launcher::Launcher::new(None)),
    );
    let router: Router = Caches::new(filesystem, search.clone()).router();

    let mut listed = serde_json::Value::Null;
    for _ in 0..100 {
        (_, listed) = call(&router, "GET", "/internal/cache").await;
        if cache(&listed, "search-index")["items"].as_u64() > Some(0) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert_eq!(cache(&listed, "previews")["items"], 1);
    assert!(cache(&listed, "previews")["bytes"].as_u64().unwrap() > 0);
    assert_eq!(cache(&listed, "search-index")["items"], 1);
    assert!(cache(&listed, "search-index")["bytes"].as_u64().unwrap() > 0);

    assert_eq!(
        call(&router, "DELETE", "/internal/cache/previews").await.0,
        StatusCode::NO_CONTENT
    );
    let (_, listed) = call(&router, "GET", "/internal/cache").await;
    assert_eq!(cache(&listed, "previews")["items"], 0);

    // Emptied, the index is built again at once.
    assert_eq!(
        call(&router, "DELETE", "/internal/cache/search-index")
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    let mut found = HashMap::new();
    for _ in 0..100 {
        found = search.found("photo").await;
        if !found.is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert_eq!(found.values().next().map(Vec::len), Some(1));

    assert_eq!(
        call(&router, "DELETE", "/internal/cache/settings").await.0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn the_launcher_reads_and_empties_the_trash_of_the_disks() {
    let folder = std::env::temp_dir().join(format!(
        "fs-explorer-caches-trash-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = fs::remove_dir_all(&folder);
    fs::create_dir_all(folder.join("root")).unwrap();
    fs::write(folder.join("root/old.txt"), "12345").unwrap();
    let pool = crate::documents::open(&folder.join("db.sqlite3"))
        .await
        .unwrap();
    let filesystem = Filesystem::new(folder.join("root")).unwrap();
    filesystem.set_trash(true);
    filesystem.delete("old.txt").unwrap();
    let (search, _changes) = SearchIndex::new(pool, filesystem.clone());
    let router: Router = Caches::new(filesystem, search).router();
    let (status, trash) = call(&router, "GET", "/internal/trash").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(trash["label"], "Cestino di Explorer");
    assert_eq!(
        (trash["bytes"].as_u64(), trash["items"].as_u64()),
        (Some(5), Some(1))
    );
    let (status, _) = call(&router, "DELETE", "/internal/trash").await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, trash) = call(&router, "GET", "/internal/trash").await;
    assert_eq!(trash["items"], 0);
}
