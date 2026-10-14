use super::*;
use axum::{body::Body, http::Request};
use std::{
    fs,
    sync::atomic::{AtomicU64, Ordering},
};
use tower::ServiceExt;

static NEXT: AtomicU64 = AtomicU64::new(0);

async fn trash() -> (std::path::PathBuf, Trash) {
    let folder = std::env::temp_dir().join(format!(
        "fs-explorer-trash-api-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = fs::remove_dir_all(&folder);
    fs::create_dir_all(folder.join("root/docs")).unwrap();
    fs::write(folder.join("root/docs/a.txt"), "x").unwrap();
    let pool = crate::documents::open(&folder.join("db.sqlite3"))
        .await
        .unwrap();
    let filesystem = Filesystem::new(folder.join("root")).unwrap();
    let trash = Trash::new(pool, filesystem);
    trash.apply_saved().await;
    (folder.join("root").canonicalize().unwrap(), trash)
}

async fn call(
    trash: &Trash,
    method: &str,
    uri: &str,
    body: &str,
) -> (StatusCode, serde_json::Value) {
    let response = trash
        .clone()
        .router::<()>()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(uri)
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
async fn the_trash_is_on_for_thirty_days_until_the_settings_say_otherwise() {
    let (_, trash) = trash().await;
    let (status, settings) = call(&trash, "GET", "/api/trash/settings", "").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(settings, json!({ "enabled": true, "days": 30 }));
    assert!(trash.filesystem.trash_enabled());
    let (status, _) = call(
        &trash,
        "PUT",
        "/api/trash/settings",
        r#"{"enabled":false,"days":7}"#,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(!trash.filesystem.trash_enabled());
    assert_eq!(
        trash.settings().await,
        Settings {
            enabled: false,
            days: 7
        }
    );
    let (status, _) = call(
        &trash,
        "PUT",
        "/api/trash/settings",
        r#"{"enabled":true,"days":0}"#,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn the_page_lists_restores_deletes_and_empties_the_trash() {
    let (root, trash) = trash().await;
    trash.filesystem.delete("docs/a.txt").unwrap();
    trash.deleted("docs/a.txt").await;
    let (_, disks) = call(&trash, "GET", "/api/trash/disks", "").await;
    assert_eq!(disks[0]["items"], 1);
    let (status, listed) = call(&trash, "GET", "/api/trash?path=docs", "").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(listed[0]["path"], "docs/a.txt");
    assert!(listed[0]["deletedAt"].as_u64().unwrap() >= now() - 5);

    fs::write(root.join("docs/a.txt"), "new").unwrap();
    let (status, _) = call(
        &trash,
        "POST",
        "/api/trash/restore",
        r#"{"path":"docs/a.txt"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, restored) = call(
        &trash,
        "POST",
        "/api/trash/restore",
        r#"{"path":"docs/a.txt","replace":true}"#,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(restored["path"], "docs/a.txt");

    trash.filesystem.delete("docs/a.txt").unwrap();
    let (status, _) = call(&trash, "DELETE", "/api/trash?path=docs/a.txt", "").await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = call(&trash, "DELETE", "/api/trash", "").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = call(&trash, "DELETE", "/api/trash?path=docs/a.txt", "").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = call(&trash, "GET", "/api/trash?path=../x", "").await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    trash.filesystem.delete("docs").unwrap();
    let (status, _) = call(&trash, "POST", "/api/trash/empty", "{}").await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(fs::read_dir(root.join(".nas-trash"))
        .unwrap()
        .next()
        .is_none());
}

#[tokio::test]
async fn what_stayed_longer_than_its_days_leaves_the_trash() {
    let (root, trash) = trash().await;
    trash.filesystem.delete("docs/a.txt").unwrap();
    trash.deleted("docs/a.txt").await;
    let today = now();
    assert_eq!(trash.expire(today).await, 0);
    assert!(root.join(".nas-trash/docs/a.txt").exists());
    assert_eq!(trash.expire(today + 31 * DAY).await, 1);
    assert!(!root.join(".nas-trash/docs").exists());
    assert!(trash.records().await.is_empty());
    // Off, a deletion keeps no time.
    trash.filesystem.set_trash(false);
    trash.deleted("docs").await;
    assert!(trash.records().await.is_empty());
}

#[test]
fn a_time_kept_for_an_entry_never_dates_future_descendants() {
    let records = HashMap::from([("/t/.nas-trash/docs".to_owned(), 7)]);
    assert_eq!(
        recorded(&records, Path::new("/t/.nas-trash/docs/a/b.txt")),
        None
    );
    assert_eq!(
        recorded(&records, Path::new("/t/.nas-trash/other.txt")),
        None
    );
}

#[tokio::test]
async fn external_replacements_do_not_inherit_the_previous_versions_expiry() {
    let (root, trash) = trash().await;
    trash.filesystem.delete("docs/a.txt").unwrap();
    let inside = root.join(".nas-trash/docs/a.txt");
    // The former version has been in the trash for over a month.
    trash.record(&inside, now() - 31 * DAY).await;
    assert!(trash.records().await.contains_key(inside.to_str().unwrap()));
    // A different application replaces that version without calling Explorer's deleted hook.
    fs::write(root.join("docs/a.txt"), "new version").unwrap();
    trash.filesystem.delete("docs/a.txt").unwrap();
    assert!(!trash.records().await.contains_key(inside.to_str().unwrap()));
    assert_eq!(trash.expire(now()).await, 0);
    assert_eq!(fs::read_to_string(&inside).unwrap(), "new version");
}

#[tokio::test]
async fn directory_deletions_date_each_descendant_and_keep_older_siblings_dates() {
    let (root, trash) = trash().await;
    fs::create_dir(root.join("docs/deep")).unwrap();
    fs::write(root.join("docs/deep/b.txt"), "old").unwrap();
    trash.filesystem.delete("docs").unwrap();
    trash.deleted("docs").await;
    let inside = root.join(".nas-trash/docs/deep/b.txt");
    assert!(trash.records().await.contains_key(inside.to_str().unwrap()));
    trash.record(&inside, now() - 31 * DAY).await;
    fs::create_dir_all(root.join("docs/deep")).unwrap();
    fs::write(root.join("docs/deep/new.txt"), "new").unwrap();
    trash.filesystem.delete("docs/deep/new.txt").unwrap();
    trash.deleted("docs/deep/new.txt").await;
    assert_eq!(trash.expire(now()).await, 1);
    assert!(!inside.exists());
    assert!(root.join(".nas-trash/docs/deep/new.txt").exists());
}

#[tokio::test]
async fn saved_dates_from_before_the_signature_migration_are_preserved() {
    let (root, trash) = trash().await;
    trash.filesystem.delete("docs").unwrap();
    let inside = root.join(".nas-trash/docs");
    sqlx::query("INSERT INTO trash_dates (path, deleted_at) VALUES (?, ?)")
        .bind(inside.to_string_lossy())
        .bind((now() - 31 * DAY) as i64)
        .execute(&trash.pool)
        .await
        .unwrap();
    trash.apply_saved().await;
    assert_eq!(trash.expire(now()).await, 1);
    assert!(!inside.exists());
}

#[tokio::test]
async fn empty_deleted_directories_expire_after_the_retention_period() {
    let (root, trash) = trash().await;
    fs::create_dir_all(root.join("empty/deep")).unwrap();
    trash.filesystem.delete("empty").unwrap();
    trash.deleted("empty").await;
    assert_eq!(trash.expire(now()).await, 0);
    assert!(root.join(".nas-trash/empty/deep").exists());
    assert_eq!(trash.expire(now() + 31 * DAY).await, 1);
    assert!(!root.join(".nas-trash/empty").exists());
    assert!(root.join(".nas-trash").exists());
}
