//! Folders shared by Explorer on the local network through Samba. Windows and Linux open them as
//! `\\nas\name` and `smb://nas/name`.
//!
//! The list lives in the app database, keyed by the UI path. At every change and at start the full
//! list goes to the launcher (`PUT /api/apps/self/shares` on `NAS_LAUNCHER_SOCKET`) with the
//! machine path of each folder. The launcher validates it and updates Samba and the firewall. A
//! change the launcher rejects is not saved. A protected share requires the account user and
//! password, which the gateway hands to Samba, so the app never sees the password.

use crate::filesystem::{FileEntry, Filesystem};
use crate::launcher::Launcher;
use crate::{blocking, status_of};
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::{
    io,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

/// Names reserved by Samba, which no share may use.
const RESERVED: [&str; 5] = ["global", "homes", "printers", "print$", "ipc$"];
const NAME_LENGTH: usize = 60;

#[derive(Clone)]
pub struct Shares {
    pool: SqlitePool,
    filesystem: Filesystem,
    launcher: Launcher,
}

/// One shared folder, as the page shows it.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SharedFolder {
    pub path: String,
    pub name: String,
    pub writable: bool,
    pub protected: bool,
    pub entry: Option<FileEntry>,
}

/// The shares and what the page needs to offer them.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub available: bool,
    pub user: Option<String>,
    pub shares: Vec<SharedFolder>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShareRequest {
    pub path: String,
    pub writable: bool,
    pub protected: bool,
}

#[derive(Debug, Deserialize)]
pub struct PathQuery {
    pub path: String,
}

#[derive(Debug, sqlx::FromRow)]
struct Row {
    path: String,
    name: String,
    writable: bool,
    protected: bool,
}

/// Reason a change was refused, with the status sent to the page.
#[derive(Debug, PartialEq, Eq)]
pub struct Refused(pub StatusCode, pub String);

impl IntoResponse for Refused {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

fn unavailable() -> Refused {
    Refused(
        StatusCode::SERVICE_UNAVAILABLE,
        "the shared folders cannot be read".to_owned(),
    )
}

impl From<io::Error> for Refused {
    fn from(error: io::Error) -> Self {
        Self(
            status_of(&error, StatusCode::SERVICE_UNAVAILABLE),
            error.to_string(),
        )
    }
}

/// UI path from a request, without leading and trailing slashes.
pub fn normalized(path: &str) -> String {
    path.trim_matches('/').to_owned()
}

/// Share name for a folder, its own name with the characters Windows or Samba reject replaced by
/// `_`. It never matches a Samba section or another share.
pub fn share_name(folder: &str, taken: &[String]) -> String {
    let cleaned: String = folder
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || " _-.".contains(c) {
                c
            } else {
                '_'
            }
        })
        .take(NAME_LENGTH)
        .collect();
    let mut base = cleaned.trim().to_owned();
    if base.is_empty() || RESERVED.contains(&base.to_lowercase().as_str()) {
        base = format!("{} share", base.trim()).trim().to_owned();
    }
    let free = |name: &str| !taken.iter().any(|other| other.eq_ignore_ascii_case(name));
    if free(&base) {
        return base;
    }
    let mut number = 2;
    loop {
        let name = format!("{base} {number}");
        if free(&name) {
            return name;
        }
        number += 1;
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
        })
}

impl Shares {
    pub fn new(pool: SqlitePool, filesystem: Filesystem, launcher: Launcher) -> Self {
        Self {
            pool,
            filesystem,
            launcher,
        }
    }

    pub fn router<S>(self) -> Router<S>
    where
        S: Clone + Send + Sync + 'static,
    {
        Router::new()
            .route("/api/shares", get(list).put(share).delete(unshare))
            .with_state(self)
    }

    async fn rows<'e, E: sqlx::SqliteExecutor<'e>>(executor: E) -> Result<Vec<Row>, Refused> {
        sqlx::query_as::<_, Row>(
            "SELECT path, name, writable, protected FROM shares ORDER BY name COLLATE NOCASE",
        )
        .fetch_all(executor)
        .await
        .map_err(|_| unavailable())
    }

    /// Machine path and entry of the folder, when it is available.
    async fn folder(&self, path: &str) -> io::Result<(PathBuf, FileEntry)> {
        let filesystem = self.filesystem.clone();
        let path = path.to_owned();
        blocking(move || filesystem.shared_folder(path)).await
    }

    /// Sends the full list to the launcher, leaving out unavailable folders until they return.
    async fn hand_over(&self, rows: &[Row]) -> Result<(), Refused> {
        let recycle = self.filesystem.trash_enabled()
            && self
                .launcher
                .request("GET", "/api/apps/self/shares", None)
                .await
                .ok()
                .and_then(|answer| serde_json::from_str::<Value>(&answer.body).ok())
                .is_some_and(|sharing| sharing["recycle"] == true);
        let mut shares = Vec::with_capacity(rows.len());
        for row in rows {
            if let Ok((absolute, _)) = self.folder(&row.path).await {
                let mut share = json!({
                    "name": row.name,
                    "path": absolute.to_string_lossy(),
                    "writable": row.writable,
                    "protected": row.protected,
                });
                if recycle {
                    if let Ok((trash, _)) = self.filesystem.trash_location(&row.path) {
                        share["trash"] = json!(trash.to_string_lossy());
                    }
                }
                shares.push(share);
            }
        }
        let body = json!({ "shares": shares });
        let answer = self
            .launcher
            .request("PUT", "/api/apps/self/shares", Some(&body))
            .await
            .map_err(|reason| Refused(StatusCode::SERVICE_UNAVAILABLE, reason))?;
        if answer.status < 300 {
            return Ok(());
        }
        let reason = serde_json::from_str::<Value>(&answer.body)
            .ok()
            .and_then(|value| value["error"].as_str().map(str::to_owned))
            .unwrap_or(answer.body);
        Err(Refused(
            if answer.status < 500 {
                StatusCode::BAD_REQUEST
            } else {
                StatusCode::SERVICE_UNAVAILABLE
            },
            reason,
        ))
    }

    /// Commits a change once the launcher accepted the resulting list, otherwise leaves it unsaved.
    async fn settle(&self, mut transaction: Transaction<'_, Sqlite>) -> Result<(), Refused> {
        let rows = Self::rows(&mut *transaction).await?;
        self.hand_over(&rows).await?;
        transaction.commit().await.map_err(|_| unavailable())
    }

    /// Syncs the launcher with the database at start, after an update or a restore of either.
    pub async fn hand_over_saved(&self) {
        let rows = match Self::rows(&self.pool).await {
            Ok(rows) => rows,
            Err(refused) => return eprintln!("<4>{}", refused.1),
        };
        if rows.is_empty() {
            return;
        }
        if let Err(refused) = self.hand_over(&rows).await {
            eprintln!("<4>the shared folders were not handed over: {}", refused.1);
        }
    }

    /// Moves the shares of a renamed or moved folder and of its subfolders.
    pub async fn relocated(&self, from: &str, to: &str) {
        let (from, to) = (normalized(from), normalized(to));
        let changed = async {
            let mut transaction = self.pool.begin().await.map_err(|_| unavailable())?;
            let moved = sqlx::query(
                "UPDATE shares SET path = ? || substr(path, length(?) + 1) \
                 WHERE path = ? OR substr(path, 1, length(?) + 1) = ? || '/'",
            )
            .bind(&to)
            .bind(&from)
            .bind(&from)
            .bind(&from)
            .bind(&from)
            .execute(&mut *transaction)
            .await
            .map_err(|_| unavailable())?;
            if moved.rows_affected() == 0 {
                return Ok(());
            }
            self.settle(transaction).await
        };
        if let Err(refused) = changed.await {
            eprintln!("<4>the shares did not follow the folder: {}", refused.1);
        }
    }

    /// Removes the shares of a deleted folder and of its subfolders.
    pub async fn forgotten(&self, path: &str) {
        let path = normalized(path);
        let changed = async {
            let mut transaction = self.pool.begin().await.map_err(|_| unavailable())?;
            let removed = sqlx::query(
                "DELETE FROM shares WHERE path = ? OR substr(path, 1, length(?) + 1) = ? || '/'",
            )
            .bind(&path)
            .bind(&path)
            .bind(&path)
            .execute(&mut *transaction)
            .await
            .map_err(|_| unavailable())?;
            if removed.rows_affected() == 0 {
                return Ok(());
            }
            self.settle(transaction).await
        };
        if let Err(refused) = changed.await {
            eprintln!("<4>the shares of a deleted folder stay: {}", refused.1);
        }
    }
}

async fn list(State(shares): State<Shares>) -> Result<Json<Overview>, Refused> {
    let rows = Shares::rows(&shares.pool).await?;
    let mut folders = Vec::with_capacity(rows.len());
    for row in rows {
        let entry = shares.folder(&row.path).await.ok().map(|(_, entry)| entry);
        folders.push(SharedFolder {
            path: row.path,
            name: row.name,
            writable: row.writable,
            protected: row.protected,
            entry,
        });
    }
    let sharing = match shares
        .launcher
        .request("GET", "/api/apps/self/shares", None)
        .await
    {
        Ok(answer) if answer.status < 300 => serde_json::from_str::<Value>(&answer.body).ok(),
        _ => None,
    };
    Ok(Json(Overview {
        available: sharing
            .as_ref()
            .is_some_and(|value| value["available"] == true),
        user: sharing.and_then(|value| value["user"].as_str().map(str::to_owned)),
        shares: folders,
    }))
}

/// Shares a folder, or changes how it is shared.
async fn share(
    State(shares): State<Shares>,
    Json(request): Json<ShareRequest>,
) -> Result<Json<SharedFolder>, Refused> {
    let path = normalized(&request.path);
    let (_, entry) = shares.folder(&path).await?;
    let mut transaction = shares.pool.begin().await.map_err(|_| unavailable())?;
    let rows = Shares::rows(&mut *transaction).await?;
    let name = match rows.iter().find(|row| row.path == path) {
        Some(row) => row.name.clone(),
        None => share_name(
            &entry.name,
            &rows.iter().map(|row| row.name.clone()).collect::<Vec<_>>(),
        ),
    };
    sqlx::query(
        "INSERT INTO shares (path, name, writable, protected, created_at) VALUES (?, ?, ?, ?, ?) \
         ON CONFLICT(path) DO UPDATE SET writable = excluded.writable, \
         protected = excluded.protected",
    )
    .bind(&path)
    .bind(&name)
    .bind(request.writable)
    .bind(request.protected)
    .bind(now_ms())
    .execute(&mut *transaction)
    .await
    .map_err(|_| unavailable())?;
    shares.settle(transaction).await?;
    Ok(Json(SharedFolder {
        path,
        name,
        writable: request.writable,
        protected: request.protected,
        entry: Some(entry),
    }))
}

/// Stops sharing a folder.
async fn unshare(
    State(shares): State<Shares>,
    Query(query): Query<PathQuery>,
) -> Result<StatusCode, Refused> {
    let path = normalized(&query.path);
    let mut transaction = shares.pool.begin().await.map_err(|_| unavailable())?;
    let removed = sqlx::query("DELETE FROM shares WHERE path = ?")
        .bind(&path)
        .execute(&mut *transaction)
        .await
        .map_err(|_| unavailable())?;
    if removed.rows_affected() == 0 {
        return Err(Refused(
            StatusCode::NOT_FOUND,
            "the folder is not shared".to_owned(),
        ));
    }
    shares.settle(transaction).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
#[path = "../tests/shares.rs"]
mod tests;
