//! The cache of the previews: how much room it takes, how much it may take, and emptying it. The
//! limit is kept in the database of the application and handed to the filesystem, which removes
//! the previews read least recently when the cache grows over it.

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use fs_core::Filesystem;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::SqlitePool;

/// Configurable limits of the thumbnail cache.
pub const MIN_LIMIT: u64 = 10 * 1024 * 1024;
pub const MAX_LIMIT: u64 = 16 * 1024 * 1024 * 1024;

#[derive(Clone)]
pub struct Previews {
    pool: SqlitePool,
    filesystem: Filesystem,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub used_bytes: u64,
    pub limit_bytes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Limit {
    pub limit_bytes: u64,
}

fn refused(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

impl Previews {
    pub fn new(pool: SqlitePool, filesystem: Filesystem) -> Self {
        Self { pool, filesystem }
    }

    /// At start: the limit saved in the settings, or the default.
    pub async fn apply_saved_limit(&self) {
        let saved =
            sqlx::query_scalar::<_, i64>("SELECT limit_bytes FROM preview_cache WHERE id = 1")
                .fetch_optional(&self.pool)
                .await;
        if let Ok(Some(bytes)) = saved {
            let bytes = u64::try_from(bytes)
                .unwrap_or(fs_core::DEFAULT_PREVIEW_CACHE_BYTES)
                .clamp(MIN_LIMIT, MAX_LIMIT);
            self.filesystem.set_preview_cache_limit(bytes);
        }
    }

    pub fn router<S>(self) -> Router<S>
    where
        S: Clone + Send + Sync + 'static,
    {
        Router::new()
            .route("/api/previews/cache", get(usage).put(limit).delete(clear))
            .with_state(self)
    }

    /// The room the previews take and may take; none when the cache cannot be measured.
    async fn usage(&self) -> Option<Usage> {
        let filesystem = self.filesystem.clone();
        let used_bytes = tokio::task::spawn_blocking(move || filesystem.preview_cache_usage())
            .await
            .ok()?
            .ok()?;
        Some(Usage {
            used_bytes,
            limit_bytes: self.filesystem.preview_cache_limit(),
        })
    }
}

async fn usage(State(previews): State<Previews>) -> Response {
    match previews.usage().await {
        Some(usage) => Json(usage).into_response(),
        None => refused(
            StatusCode::SERVICE_UNAVAILABLE,
            "the previews cannot be measured",
        ),
    }
}

/// Saves the limit and removes the thumbnails over it at once.
async fn limit(State(previews): State<Previews>, Json(request): Json<Limit>) -> Response {
    if !(MIN_LIMIT..=MAX_LIMIT).contains(&request.limit_bytes) {
        return refused(
            StatusCode::BAD_REQUEST,
            "the limit goes from 10 MB to 16 GB",
        );
    }
    let saved = sqlx::query(
        "INSERT INTO preview_cache (id, limit_bytes) VALUES (1, ?) \
         ON CONFLICT(id) DO UPDATE SET limit_bytes = excluded.limit_bytes",
    )
    .bind(i64::try_from(request.limit_bytes).unwrap_or(i64::MAX))
    .execute(&previews.pool)
    .await;
    if saved.is_err() {
        return refused(StatusCode::SERVICE_UNAVAILABLE, "the limit cannot be saved");
    }
    previews
        .filesystem
        .set_preview_cache_limit(request.limit_bytes);
    let filesystem = previews.filesystem.clone();
    let _ = tokio::task::spawn_blocking(move || filesystem.prune_preview_cache_to_limit()).await;
    usage(State(previews)).await
}

async fn clear(State(previews): State<Previews>) -> Response {
    let filesystem = previews.filesystem.clone();
    match tokio::task::spawn_blocking(move || filesystem.clear_preview_cache()).await {
        Ok(Ok(())) => usage(State(previews)).await,
        _ => refused(
            StatusCode::SERVICE_UNAVAILABLE,
            "the previews cannot be removed",
        ),
    }
}

#[cfg(test)]
#[path = "../../tests/unit/axum/previews.rs"]
mod tests;
