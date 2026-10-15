use super::*;
use axum::{body::Body, http::Request};
use std::{
    fs,
    sync::atomic::{AtomicU64, Ordering},
};
use tower::ServiceExt;

static NEXT: AtomicU64 = AtomicU64::new(0);

fn scratch() -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!(
        "fs-explorer-previews-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(path.join("root")).unwrap();
    path
}

async fn call(previews: &Previews, method: &str, body: &str) -> (StatusCode, serde_json::Value) {
    let response = previews
        .clone()
        .router::<()>()
        .oneshot(
            Request::builder()
                .method(method)
                .uri("/api/previews/cache")
                .header("content-type", "application/json")
                .body(Body::from(body.to_owned()))
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

#[tokio::test]
async fn the_limit_of_the_previews_is_chosen_kept_and_applied() {
    let folder = scratch();
    let pool = crate::documents::open(&folder.join("db.sqlite3"))
        .await
        .unwrap();
    image::RgbImage::from_pixel(400, 400, image::Rgb([1, 2, 3]))
        .save(folder.join("root/photo.png"))
        .unwrap();
    let filesystem = Filesystem::new(folder.join("root")).unwrap();
    filesystem
        .preview("photo.png", fs_core::PreviewSize::Small)
        .unwrap();
    let previews = Previews::new(pool.clone(), filesystem.clone());

    let (status, usage) = call(&previews, "GET", "").await;
    assert_eq!(status, StatusCode::OK);
    assert!(usage["usedBytes"].as_u64().unwrap() > 0);
    assert_eq!(usage["limitBytes"], fs_core::DEFAULT_PREVIEW_CACHE_BYTES);

    for bytes in [MIN_LIMIT - 1, MAX_LIMIT + 1] {
        let body = format!(r#"{{"limitBytes":{bytes}}}"#);
        assert_eq!(
            call(&previews, "PUT", &body).await.0,
            StatusCode::BAD_REQUEST
        );
    }
    let body = format!(r#"{{"limitBytes":{MIN_LIMIT}}}"#);
    let (status, usage) = call(&previews, "PUT", &body).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(usage["limitBytes"], MIN_LIMIT);

    // Kept: a new start applies it again.
    let restarted = Filesystem::new(folder.join("root")).unwrap();
    Previews::new(pool, restarted.clone())
        .apply_saved_limit()
        .await;
    assert_eq!(restarted.preview_cache_limit(), MIN_LIMIT);
    let body = format!(r#"{{"limitBytes":{MAX_LIMIT}}}"#);
    assert_eq!(call(&previews, "PUT", &body).await.0, StatusCode::OK);
    previews.apply_saved_limit().await;
    assert_eq!(previews.filesystem.preview_cache_limit(), MAX_LIMIT);

    let (status, usage) = call(&previews, "DELETE", "").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(usage["usedBytes"], 0);
    fs::remove_dir_all(folder).unwrap();
}

#[tokio::test]
async fn says_so_when_the_limit_cannot_be_saved() {
    let folder = scratch();
    let pool = crate::documents::open(&folder.join("db.sqlite3"))
        .await
        .unwrap();
    let previews = Previews::new(pool.clone(), Filesystem::new(folder.join("root")).unwrap());
    pool.close().await;
    let body = format!(r#"{{"limitBytes":{MIN_LIMIT}}}"#);
    assert_eq!(
        call(&previews, "PUT", &body).await.0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    // Without a saved limit the default stays.
    previews.apply_saved_limit().await;
    fs::remove_dir_all(folder).unwrap();
}
