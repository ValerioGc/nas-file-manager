//! The trash of the disks, around the one of `fs_core`: its settings (on by default, 30 days),
//! the routes of the page and the daily expiry. The Explorer keeps the time of its own deletions,
//! and of what it first finds on a disk whose ctime cannot say it (exFAT, NTFS); elsewhere the
//! disk says it.

use crate::shares::Shares;
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use fs_core::{FileEntry, Filesystem, TrashDisk, TrashEntry};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::SqlitePool;
use std::{
    collections::HashMap,
    io,
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const DAY: u64 = 24 * 60 * 60;
/// The first expiry waits for the start of the NAS to settle.
const FIRST_EXPIRY: Duration = Duration::from_secs(60);

#[derive(Clone)]
pub struct Trash {
    pool: SqlitePool,
    filesystem: Filesystem,
    /// The shares of the network, handed over again when the trash is turned on or off.
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

/// An error of the filesystem with the status the page reads it by.
fn failed(error: &io::Error) -> Response {
    let status = match error.kind() {
        io::ErrorKind::AlreadyExists => StatusCode::CONFLICT,
        io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
        io::ErrorKind::PermissionDenied => StatusCode::FORBIDDEN,
        io::ErrorKind::InvalidInput => StatusCode::BAD_REQUEST,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    refused(status, &error.to_string())
}

/// The time this version went in; each descendant has its own record.
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

/// Include descendants of a directory deletion without following symbolic links.
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

    /// The shares whose deleted files follow the trash.
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

    /// At start: whether the deletions go to the trash, as the settings say.
    pub async fn apply_saved(&self) {
        self.filesystem.set_trash(self.settings().await.enabled);
        self.mark().await;
        self.upgrade_dates().await;
    }

    // Preserve dates written before per-version signatures, including directory descendants.
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

    /// Says on the disks whether the trash is on, for the sync.
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

    /// A deletion of the Explorer, when it went to the trash: its time is kept.
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

    /// The entries of the trash with the times Explorer kept for those versions.
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

    /// Removes what has been in the trash longer than the days of the settings. Returns how many
    /// files went.
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
                // Found for the first time where the disk cannot say when: from now on.
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

    /// The times of what is no longer in the trash.
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

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> io::Result<T> + Send + 'static,
) -> io::Result<T> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| io::Error::other(error.to_string()))?
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
#[path = "../../tests/unit/axum/trash.rs"]
mod tests;
