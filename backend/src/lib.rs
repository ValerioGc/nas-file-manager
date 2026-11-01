pub mod caches;
pub mod documents;
pub mod filesystem;
pub mod launcher;
pub mod previews;
pub mod search;
pub mod shares;
pub mod trash;

use std::{collections::HashMap, io, path::Path};

use crate::filesystem::{
    ArchiveRequest, CopyMoveRequest, CreateDirectoryRequest, CreateFileRequest, FileEntry,
    FileKind, Filesystem, PreviewSize, RenameRequest, StorageInfo, VolumeInfo,
};
use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Query, State},
    http::Request,
    http::{
        header::{CACHE_CONTROL, CONTENT_TYPE, IF_RANGE, RANGE},
        HeaderMap, HeaderValue, StatusCode,
    },
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Extension, Json, Router,
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
    v: Option<String>,
}

/// Images decoded concurrently for previews, so a photo folder does not take every core and
/// hundreds of megabytes at once. Cached previews never wait for it.
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
        let status = status_of(&self.0, StatusCode::INTERNAL_SERVER_ERROR);
        (status, self.0.to_string()).into_response()
    }
}

/// HTTP status of a filesystem error, `other` for the kinds the page does not tell apart.
pub(crate) fn status_of(error: &io::Error, other: StatusCode) -> StatusCode {
    match error.kind() {
        io::ErrorKind::AlreadyExists => StatusCode::CONFLICT,
        io::ErrorKind::InvalidInput => StatusCode::BAD_REQUEST,
        io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
        io::ErrorKind::PermissionDenied => StatusCode::FORBIDDEN,
        _ => other,
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
        // No body limit since `upload_file` streams to disk.
        .route(
            "/api/uploads",
            post(upload_file).layer(DefaultBodyLimit::disable()),
        )
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
                    // Read again only when the watch is not running or saw a volume go, so the
                    // refusal carries the reason of the moment.
                    if guard.mounts_connected() != Some(true) {
                        if let Err(error) = blocking(move || guard.verify_nas_mounts()).await {
                            return (StatusCode::SERVICE_UNAVAILABLE, error.to_string())
                                .into_response();
                        }
                    }
                    next.run(request).await
                }
            },
        ))
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

/// Complete index results for a search, when Explorer has an index (`search`).
async fn indexed(
    search: Option<Extension<SearchIndex>>,
    query: &str,
) -> HashMap<std::path::PathBuf, Vec<std::path::PathBuf>> {
    match search {
        Some(Extension(index)) => index.found(query).await,
        None => HashMap::new(),
    }
}

/// Notifies the index of a local change so it rereads the folders now (`search`).
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
        filesystem::extension_of(Path::new(&entry.name))
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

fn required(path: Option<String>) -> Result<String, ApiError> {
    path.filter(|path| !path.is_empty())
        .ok_or_else(|| invalid_input("path is required"))
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
    let path = required(query.path)?;
    let size = query.size;
    let cached = {
        let (filesystem, path) = (filesystem.clone(), path.clone());
        execute(move || filesystem.cached_preview(path, size)).await?
    };
    let preview = match cached {
        Some(preview) => preview,
        None => {
            // A disconnected browser drops its request here, before decoding starts.
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

/// Partial upload removed unless finished, also when the client disconnects and the request is
/// dropped halfway.
struct Partial(Option<std::path::PathBuf>);

impl Drop for Partial {
    fn drop(&mut self) {
        if let Some(path) = self.0.take() {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// Streams the body to `partial`, so a file of any size never sits in memory.
async fn receive(body: Body, partial: &Path) -> io::Result<()> {
    use axum::body::HttpBody;
    use tokio::io::AsyncWriteExt;

    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(partial)
        .await?;
    let mut body = std::pin::pin!(body);
    while let Some(frame) = std::future::poll_fn(|context| body.as_mut().poll_frame(context)).await
    {
        let frame =
            frame.map_err(|error| io::Error::new(io::ErrorKind::Interrupted, error.to_string()))?;
        if let Ok(data) = frame.into_data() {
            file.write_all(&data).await?;
        }
    }
    file.sync_all().await
}

/// Uploads have no size limit because the body is streamed to disk.
async fn upload_file(
    State(filesystem): State<Filesystem>,
    search: Option<Extension<SearchIndex>>,
    Query(query): Query<PathQuery>,
    body: Body,
) -> Result<(StatusCode, Json<FileEntry>), ApiError> {
    let path = required(query.path)?;
    let (destination, partial) = {
        let filesystem = filesystem.clone();
        execute(move || filesystem.upload_paths(path)).await?
    };
    // Removed with the request however it ends. Nothing is left to remove once finished.
    let _partial = Partial(Some(partial.clone()));
    receive(body, &partial).await?;
    let entry = execute(move || filesystem.finish_upload(&partial, &destination)).await?;
    touched(search.as_ref(), &[&entry.path]);
    Ok((StatusCode::CREATED, Json(entry)))
}

async fn download_file(
    State(filesystem): State<Filesystem>,
    Query(query): Query<PathQuery>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let path = required(query.path)?;
    // Streamed from disk, so a large file never sits in memory.
    let path = execute(move || filesystem.file_path(path)).await?;
    let content_type = served_type(&path);
    // The range lets a video preview read only the part it shows.
    let mut request = Request::new(Body::empty());
    for name in [RANGE, IF_RANGE] {
        if let Some(value) = headers.get(&name) {
            request.headers_mut().insert(name, value.clone());
        }
    }
    let mut response = ServeFile::new(path)
        .try_call(request)
        .await
        .map_err(ApiError)?
        .map(Body::new);
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static(content_type));
    Ok(response)
}

/// Type a download is served as. Videos keep theirs, so the browser can play a preview, since no
/// video runs scripts. Every other file is a plain download and never opens in the page.
fn served_type(path: &Path) -> &'static str {
    match filesystem::extension_of(path).as_str() {
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        _ => "application/octet-stream",
    }
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

/// Moves the network shares of a renamed, moved or deleted folder along with it, when Explorer has
/// shares (`shares`).
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
    blocking(operation).await.map_err(ApiError)
}

/// Runs filesystem work off the async threads.
pub(crate) async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> io::Result<T> + Send + 'static,
) -> io::Result<T> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| io::Error::other(error.to_string()))?
}

#[cfg(test)]
#[path = "../tests/lib.rs"]
mod tests;
