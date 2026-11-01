//! Cache endpoints for the launcher on `/internal/cache` (`cache` capability), covering image
//! previews and the search index. Both are rebuilt from the files, previews on demand and the index
//! immediately.

use crate::filesystem::Filesystem;
use crate::search::SearchIndex;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get},
    Json, Router,
};
use serde_json::json;

const PREVIEWS: &str = "previews";
const SEARCH_INDEX: &str = "search-index";

#[derive(Clone)]
pub struct Caches {
    filesystem: Filesystem,
    search: SearchIndex,
}

impl Caches {
    pub fn new(filesystem: Filesystem, search: SearchIndex) -> Self {
        Self { filesystem, search }
    }

    pub fn router<S>(self) -> Router<S> {
        Router::new()
            .route("/internal/cache", get(list))
            .route("/internal/cache/{id}", delete(clear))
            .route("/internal/trash", get(trash_usage).delete(empty_trash))
            .with_state(self)
    }
}

async fn list(State(caches): State<Caches>) -> Response {
    let filesystem = caches.filesystem.clone();
    let previews = tokio::task::spawn_blocking(move || {
        Ok::<_, std::io::Error>((
            filesystem.preview_cache_usage()?,
            filesystem.preview_cache_items()?,
        ))
    })
    .await
    .ok()
    .and_then(Result::ok);
    let index = caches.search.usage().await.ok();
    let mut listed = Vec::new();
    if let Some((bytes, items)) = previews {
        listed.push(json!({
            "id": PREVIEWS,
            "label": "Miniature dell’app File",
            "bytes": bytes,
            "items": items,
        }));
    }
    if let Some((bytes, items)) = index {
        listed.push(json!({
            "id": SEARCH_INDEX,
            "label": "Indice della ricerca dell’app File",
            "bytes": bytes,
            "items": items,
        }));
    }
    Json(json!({ "caches": listed })).into_response()
}

async fn clear(State(caches): State<Caches>, Path(id): Path<String>) -> Response {
    match id.as_str() {
        PREVIEWS => {
            let filesystem = caches.filesystem.clone();
            match tokio::task::spawn_blocking(move || filesystem.clear_preview_cache()).await {
                Ok(Ok(())) => StatusCode::NO_CONTENT.into_response(),
                Ok(Err(error)) => {
                    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response()
                }
                Err(error) => {
                    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response()
                }
            }
        }
        SEARCH_INDEX => {
            caches.search.reset().await;
            StatusCode::NO_CONTENT.into_response()
        }
        _ => (StatusCode::NOT_FOUND, "unknown cache").into_response(),
    }
}

/// Trash of the disks for the Cleanup app (`trash` capability). It is not a cache because its
/// content cannot be rebuilt, but it is emptied the same way.
async fn trash_usage(State(caches): State<Caches>) -> Response {
    let filesystem = caches.filesystem.clone();
    let disks = tokio::task::spawn_blocking(move || filesystem.trash_disks())
        .await
        .unwrap_or_default();
    Json(json!({
        "label": "Cestino dell’app File",
        "bytes": disks.iter().map(|disk| disk.bytes).sum::<u64>(),
        "items": disks.iter().map(|disk| disk.items).sum::<u64>(),
    }))
    .into_response()
}

async fn empty_trash(State(caches): State<Caches>) -> Response {
    let filesystem = caches.filesystem.clone();
    match tokio::task::spawn_blocking(move || filesystem.empty_trash(None)).await {
        Ok(Ok(())) => StatusCode::NO_CONTENT.into_response(),
        Ok(Err(error)) => (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
        Err(error) => (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
}

#[cfg(test)]
#[path = "../tests/caches.rs"]
mod tests;
