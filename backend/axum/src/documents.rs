//! The documents of the application (its settings, its favorites), in a database of its own: the
//! state directory systemd gives it on the NAS, never the launcher's. Every browser that opens the
//! application reads and writes the same ones. Keep this file the same in every application that
//! stores documents; each one names the documents it accepts.

use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde_json::{json, Value};
use sqlx::{
    migrate::Migrator,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions},
};
use std::{
    ffi::OsString,
    path::{Path as FsPath, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

static MIGRATOR: Migrator = sqlx::migrate!("./migrations");
/// A document is a few settings or a list of favorites: anything larger is refused.
pub const MAX_BYTES: usize = 256 * 1024;

pub type Failure = Box<dyn std::error::Error + Send + Sync>;

#[derive(Clone)]
struct Documents {
    pool: SqlitePool,
    names: &'static [&'static str],
}

/// `NAS_DB_PATH` when set, otherwise `file` in the first state directory of the unit, or beside
/// the sources in a development build.
pub fn database_path(
    configured: Option<OsString>,
    state_directory: Option<OsString>,
    file: &str,
) -> Result<PathBuf, String> {
    if let Some(path) = configured.filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(path));
    }
    if let Some(directory) = state_directory
        .and_then(|value| value.into_string().ok())
        .and_then(|value| value.split(':').next().map(str::to_owned))
        .filter(|value| !value.is_empty())
    {
        return Ok(PathBuf::from(directory).join(file));
    }
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../data")
            .join(file));
    }
    Err("Set NAS_DB_PATH or run under systemd with STATE_DIRECTORY.".to_owned())
}

/// Opens the database, creating it and its table when missing.
pub async fn open(path: &FsPath) -> Result<SqlitePool, Failure> {
    if let Some(directory) = path
        .parent()
        .filter(|directory| !directory.as_os_str().is_empty())
    {
        tokio::fs::create_dir_all(directory).await?;
    }
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(2)
        .connect_with(options)
        .await?;
    MIGRATOR.run(&pool).await?;
    Ok(pool)
}

/// `GET` and `PUT /api/documents/{name}`, for the documents named in `names` only.
pub fn router<S>(pool: SqlitePool, names: &'static [&'static str]) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route("/api/documents/{name}", get(read).put(write))
        .with_state(Documents { pool, names })
}

fn refused(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

/// The document as it was saved, or `null` when it never was.
async fn read(State(documents): State<Documents>, Path(name): Path<String>) -> Response {
    if !documents.names.contains(&name.as_str()) {
        return refused(StatusCode::NOT_FOUND, "no such document");
    }
    let stored = sqlx::query_scalar::<_, String>("SELECT value FROM documents WHERE name = ?")
        .bind(&name)
        .fetch_optional(&documents.pool)
        .await;
    match stored {
        Ok(Some(text)) => ([(header::CONTENT_TYPE, "application/json")], text).into_response(),
        Ok(None) => Json(Value::Null).into_response(),
        Err(_) => refused(
            StatusCode::SERVICE_UNAVAILABLE,
            "the documents cannot be read",
        ),
    }
}

/// Replaces the document with the JSON object or array sent.
async fn write(
    State(documents): State<Documents>,
    Path(name): Path<String>,
    body: Bytes,
) -> Response {
    if !documents.names.contains(&name.as_str()) {
        return refused(StatusCode::NOT_FOUND, "no such document");
    }
    if body.len() > MAX_BYTES {
        return refused(StatusCode::PAYLOAD_TOO_LARGE, "the document is too large");
    }
    let Ok(value) = serde_json::from_slice::<Value>(&body) else {
        return refused(StatusCode::BAD_REQUEST, "the document is not JSON");
    };
    if !(value.is_object() || value.is_array()) {
        return refused(
            StatusCode::BAD_REQUEST,
            "a document is a JSON object or array",
        );
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
        });
    let saved = sqlx::query(
        "INSERT INTO documents (name, value, updated_at) VALUES (?, ?, ?) \
         ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(&name)
    .bind(value.to_string())
    .bind(now)
    .execute(&documents.pool)
    .await;
    match saved {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(_) => refused(
            StatusCode::SERVICE_UNAVAILABLE,
            "the document cannot be saved",
        ),
    }
}

#[cfg(test)]
#[path = "../../tests/unit/axum/documents.rs"]
mod tests;
