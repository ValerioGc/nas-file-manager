pub mod caches;
pub mod documents;
pub mod launcher;
pub mod previews;
pub mod search;
pub mod shares;
pub mod trash;

use std::{collections::HashMap, io, path::Path};

use axum::{
    body::{Body, Bytes},
    extract::{Query, State},
    http::Request,
    http::{
        header::{CACHE_CONTROL, CONTENT_TYPE},
        HeaderValue, StatusCode,
    },
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Extension, Json, Router,
};
use fs_core::{
    ArchiveRequest, CopyMoveRequest, CreateDirectoryRequest, CreateFileRequest, FileEntry,
    FileKind, Filesystem, PreviewSize, RenameRequest, StorageInfo, VolumeInfo,
};
use search::SearchIndex;
use serde::{Deserialize, Serialize};
use shares::Shares;
use tower_http::services::ServeFile;
use trash::Trash;

#[derive(Serialize)]
struct HealthStatus {
    status: &'static str,
    version: &'static str,
}

#[derive(Debug, Deserialize)]
struct PathQuery {
    path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PreviewQuery {
    path: Option<String>,
    #[serde(default)]
    size: PreviewSize,
    /// Changes with the file (its time and size): with it, the answer never changes and the
    /// browser keeps it.
    v: Option<String>,
}

/// Images decoded at once for their previews: a folder of photos does not take every core and
/// hundreds of megabytes together. Previews already made never wait for it.
static DECODES: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);

#[derive(Debug, Deserialize)]
struct SearchQuery {
    query: String,
}

#[derive(Debug, Deserialize)]
struct LauncherSearchQuery {
    q: String,
    #[serde(rename = "type")]
    file_type: Option<String>,
    ext: Option<String>,
}

#[derive(Serialize)]
struct LauncherSearchResult {
    id: String,
    name: String,
    path: String,
    #[serde(rename = "type")]
    file_type: &'static str,
    extension: String,
    size: u64,
    modified: String,
    target: String,
}

#[derive(Debug)]
struct ApiError(io::Error);

impl From<io::Error> for ApiError {
    fn from(value: io::Error) -> Self {
        Self(value)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self.0.kind() {
            io::ErrorKind::AlreadyExists => StatusCode::CONFLICT,
            io::ErrorKind::InvalidInput => StatusCode::BAD_REQUEST,
            io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
            io::ErrorKind::PermissionDenied => StatusCode::FORBIDDEN,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, self.0.to_string()).into_response()
    }
}

pub fn router(filesystem: Filesystem) -> Router {
    let guard = filesystem.clone();
    Router::new()
        .route("/health", get(health_json))
        .route("/api/health", get(health))
        .route("/api/search", get(search_files))
        .route("/api/launcher/search", get(search_launcher))
        .route("/api/storage", get(storage_info))
        .route("/api/volumes", get(volumes))
        .route("/api/previews", get(get_preview))
        .route("/api/archives/list", post(list_archive))
        .route("/api/uploads", post(upload_file))
        .route("/api/downloads", get(download_file))
        .route(
            "/api/files",
            get(list_files)
                .delete(delete_entry)
                .patch(rename_entry)
                .post(create_file),
        )
        .route("/api/directories", post(create_directory))
        .route("/api/copy", post(copy_entry))
        .route("/api/move", post(move_entry))
        .with_state(filesystem)
        .layer(middleware::from_fn(
            move |request: Request<axum::body::Body>, next: Next| {
                let guard = guard.clone();
                async move {
                    if let Err(error) = guard.verify_nas_mounts() {
                        return (StatusCode::SERVICE_UNAVAILABLE, error.to_string())
                            .into_response();
                    }
                    next.run(request).await
                }
            },
        ))
}

pub fn filesystem_from_root(root: impl AsRef<Path>) -> Result<Filesystem, io::Error> {
    Filesystem::new(root)
}

async fn health() -> &'static str {
    "ok"
}

async fn health_json() -> Json<HealthStatus> {
    Json(HealthStatus {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    })
}

async fn list_files(
    State(filesystem): State<Filesystem>,
    Query(query): Query<PathQuery>,
) -> Result<Json<Vec<FileEntry>>, ApiError> {
    let path = query.path.unwrap_or_default();
    execute(move || filesystem.list_directory(path))
        .await
        .map(Json)
}

/// What the index holds whole for a search, when the Explorer has one (`search`).
async fn indexed(
    search: Option<Extension<SearchIndex>>,
    query: &str,
) -> HashMap<std::path::PathBuf, Vec<std::path::PathBuf>> {
    match search {
        Some(Extension(index)) => index.found(query).await,
        None => HashMap::new(),
    }
}

/// A change made here: the index reads the folders again now (`search`).
fn touched(search: Option<&Extension<SearchIndex>>, paths: &[&str]) {
    if let Some(Extension(index)) = search {
        for path in paths {
            index.touched(path);
        }
    }
}

async fn search_files(
    State(filesystem): State<Filesystem>,
    search: Option<Extension<SearchIndex>>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<Vec<FileEntry>>, ApiError> {
    let found = indexed(search, &query.query).await;
    execute(move || filesystem.search_with(&query.query, &found))
        .await
        .map(Json)
}

async fn search_launcher(
    State(filesystem): State<Filesystem>,
    search: Option<Extension<SearchIndex>>,
    Query(query): Query<LauncherSearchQuery>,
) -> Result<Json<Vec<LauncherSearchResult>>, ApiError> {
    if query.q.trim().is_empty() || query.q.len() > 200 {
        return Err(invalid_input("q must contain 1 to 200 characters"));
    }
    if query.file_type.as_deref().is_some_and(|value| {
        !matches!(
            value,
            "folder" | "document" | "image" | "audio" | "video" | "archive"
        )
    }) {
        return Err(invalid_input("invalid file type"));
    }
    let extension_filter = query
        .ext
        .as_ref()
        .map(|value| value.trim_start_matches('.').to_ascii_lowercase());
    if extension_filter.as_ref().is_some_and(|value| {
        value.len() > 32
            || !value
                .chars()
                .all(|character| character.is_ascii_alphanumeric())
    }) {
        return Err(invalid_input("invalid extension"));
    }
    let volumes = filesystem.volumes();
    let found = indexed(search, &query.q).await;
    let entries = execute(move || filesystem.search_with(&query.q, &found)).await?;
    let results = entries
        .into_iter()
        .filter_map(|entry| launcher_result(entry, &volumes))
        .filter(|result| {
            query
                .file_type
                .as_ref()
                .is_none_or(|value| value == result.file_type)
                && extension_filter
                    .as_ref()
                    .is_none_or(|value| value == &result.extension)
        })
        .collect();
    Ok(Json(results))
}

fn launcher_result(entry: FileEntry, volumes: &[VolumeInfo]) -> Option<LauncherSearchResult> {
    let path = format!("/{}", entry.path.trim_start_matches('/'));
    let extension = if entry.kind == FileKind::Folder {
        String::new()
    } else {
        std::path::Path::new(&entry.name)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
    };
    let file_type = match entry.kind {
        FileKind::Folder => "folder",
        FileKind::Image => "image",
        FileKind::Video => "video",
        FileKind::Archive => "archive",
        _ if matches!(
            extension.as_str(),
            "mp3" | "wav" | "flac" | "ogg" | "m4a" | "aac"
        ) =>
        {
            "audio"
        }
        _ => "document",
    };
    let (directory, selected) = if entry.kind == FileKind::Folder {
        (path.as_str(), None)
    } else {
        (
            path.rsplit_once('/').map_or(
                "/",
                |(parent, _)| if parent.is_empty() { "/" } else { parent },
            ),
            Some(entry.name.as_str()),
        )
    };
    let mut target = url::form_urlencoded::Serializer::new(String::new());
    target.append_pair("path", directory);
    if let Some(name) = selected {
        target.append_pair("select", name);
    }
    let target = format!("?{}", target.finish());
    if target.len() > 2048 {
        return None;
    }
    let modified = entry
        .modified
        .and_then(|seconds| chrono::DateTime::from_timestamp(i64::try_from(seconds).ok()?, 0))
        .map_or_else(String::new, |value| value.to_rfc3339());
    let display_path = volumes
        .iter()
        .find(|volume| {
            entry.path == volume.id || entry.path.starts_with(&format!("{}/", volume.id))
        })
        .map_or_else(
            || path.clone(),
            |volume| format!("/{}{}", volume.name, &entry.path[volume.id.len()..]),
        );
    Some(LauncherSearchResult {
        id: path.clone(),
        name: entry.name,
        path: display_path,
        file_type,
        extension,
        size: entry.size.unwrap_or(0),
        modified,
        target,
    })
}

fn invalid_input(message: &str) -> ApiError {
    ApiError(io::Error::new(
        io::ErrorKind::InvalidInput,
        message.to_owned(),
    ))
}

async fn storage_info(State(filesystem): State<Filesystem>) -> Result<Json<StorageInfo>, ApiError> {
    execute(move || filesystem.storage_info()).await.map(Json)
}

async fn volumes(State(filesystem): State<Filesystem>) -> Json<Vec<VolumeInfo>> {
    Json(filesystem.volumes())
}

async fn get_preview(
    State(filesystem): State<Filesystem>,
    Query(query): Query<PreviewQuery>,
) -> Result<Response, ApiError> {
    let path = query
        .path
        .filter(|path| !path.is_empty())
        .ok_or_else(|| invalid_input("path is required"))?;
    let size = query.size;
    let cached = {
        let (filesystem, path) = (filesystem.clone(), path.clone());
        execute(move || filesystem.cached_preview(path, size)).await?
    };
    let preview = match cached {
        Some(preview) => preview,
        None => {
            // A browser that went away drops its request here, before the decoding starts.
            let _permit = DECODES
                .acquire()
                .await
                .map_err(|error| ApiError(io::Error::other(error.to_string())))?;
            execute(move || filesystem.preview(path, size)).await?
        }
    };
    let cache = if query.v.is_some() {
        "private, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    Ok((
        [
            (CONTENT_TYPE, preview.content_type.as_str()),
            (CACHE_CONTROL, cache),
        ],
        preview.bytes,
    )
        .into_response())
}

async fn list_archive(
    State(filesystem): State<Filesystem>,
    Json(request): Json<ArchiveRequest>,
) -> Result<Json<Vec<FileEntry>>, ApiError> {
    execute(move || filesystem.list_archive(request.path, request.password.as_deref()))
        .await
        .map(Json)
}

async fn upload_file(
    State(filesystem): State<Filesystem>,
    search: Option<Extension<SearchIndex>>,
    Query(query): Query<PathQuery>,
    bytes: Bytes,
) -> Result<(StatusCode, Json<FileEntry>), ApiError> {
    let path = query
        .path
        .filter(|path| !path.is_empty())
        .ok_or_else(|| invalid_input("path is required"))?;
    let entry = execute(move || filesystem.write_file(path, &bytes)).await?;
    touched(search.as_ref(), &[&entry.path]);
    Ok((StatusCode::CREATED, Json(entry)))
}

async fn download_file(
    State(filesystem): State<Filesystem>,
    Query(query): Query<PathQuery>,
) -> Result<Response, ApiError> {
    let path = query
        .path
        .filter(|path| !path.is_empty())
        .ok_or_else(|| invalid_input("path is required"))?;
    // Streamed from the disk: a large file never sits whole in memory.
    let path = execute(move || filesystem.file_path(path)).await?;
    let mut response = ServeFile::new(path)
        .try_call(Request::new(Body::empty()))
        .await
        .map_err(ApiError)?
        .map(Body::new);
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    Ok(response)
}

async fn create_directory(
    State(filesystem): State<Filesystem>,
    search: Option<Extension<SearchIndex>>,
    Json(request): Json<CreateDirectoryRequest>,
) -> Result<(StatusCode, Json<FileEntry>), ApiError> {
    let entry = execute(move || filesystem.create_directory(request.path)).await?;
    touched(search.as_ref(), &[&entry.path]);
    Ok((StatusCode::CREATED, Json(entry)))
}

async fn create_file(
    State(filesystem): State<Filesystem>,
    search: Option<Extension<SearchIndex>>,
    Json(request): Json<CreateFileRequest>,
) -> Result<(StatusCode, Json<FileEntry>), ApiError> {
    let entry = execute(move || filesystem.create_file(request.path)).await?;
    touched(search.as_ref(), &[&entry.path]);
    Ok((StatusCode::CREATED, Json(entry)))
}

/// A renamed, moved or deleted folder takes its shares of the local network along, when the
/// Explorer shares any (`shares`).
async fn rename_entry(
    State(filesystem): State<Filesystem>,
    shares: Option<Extension<Shares>>,
    search: Option<Extension<SearchIndex>>,
    Json(request): Json<RenameRequest>,
) -> Result<Json<FileEntry>, ApiError> {
    let from = request.path.clone();
    let entry = execute(move || filesystem.rename(request.path, &request.name)).await?;
    touched(search.as_ref(), &[&entry.path]);
    if let Some(Extension(shares)) = shares {
        shares.relocated(&from, &entry.path).await;
    }
    Ok(Json(entry))
}

async fn copy_entry(
    State(filesystem): State<Filesystem>,
    search: Option<Extension<SearchIndex>>,
    Json(request): Json<CopyMoveRequest>,
) -> Result<(StatusCode, Json<FileEntry>), ApiError> {
    let entry = execute(move || filesystem.copy(request.source, request.destination)).await?;
    touched(search.as_ref(), &[&entry.path]);
    Ok((StatusCode::CREATED, Json(entry)))
}

async fn move_entry(
    State(filesystem): State<Filesystem>,
    shares: Option<Extension<Shares>>,
    search: Option<Extension<SearchIndex>>,
    Json(request): Json<CopyMoveRequest>,
) -> Result<Json<FileEntry>, ApiError> {
    let from = request.source.clone();
    let entry = execute(move || filesystem.move_entry(request.source, request.destination)).await?;
    touched(search.as_ref(), &[&from, &entry.path]);
    if let Some(Extension(shares)) = shares {
        shares.relocated(&from, &entry.path).await;
    }
    Ok(Json(entry))
}

async fn delete_entry(
    State(filesystem): State<Filesystem>,
    shares: Option<Extension<Shares>>,
    search: Option<Extension<SearchIndex>>,
    trash: Option<Extension<Trash>>,
    Query(query): Query<PathQuery>,
) -> Result<StatusCode, ApiError> {
    let path = query.path.unwrap_or_default();
    let deleted = path.clone();
    execute(move || filesystem.delete(path)).await?;
    if let Some(Extension(trash)) = trash {
        trash.deleted(&deleted).await;
    }
    touched(search.as_ref(), &[&deleted]);
    if let Some(Extension(shares)) = shares {
        shares.forgotten(&deleted).await;
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn execute<T: Send + 'static>(
    operation: impl FnOnce() -> io::Result<T> + Send + 'static,
) -> Result<T, ApiError> {
    tokio::task::spawn_blocking(operation)
        .await
        .map_err(|error| ApiError(io::Error::other(error.to_string())))?
        .map_err(ApiError)
}

#[cfg(test)]
#[path = "../../tests/unit/axum/lib.rs"]
mod tests;
