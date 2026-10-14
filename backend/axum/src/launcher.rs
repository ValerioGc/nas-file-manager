//! The door to the launcher, `NAS_LAUNCHER_SOCKET`: the launcher knows this application by its
//! cgroup and lets it write only as itself. Through it the Explorer hands over the folders it
//! shares on the local network, which the launcher gives to Samba (`crate::shares`), and the index
//! of the search (`crate::search`) keeps it running, shows its first build among the operations of
//! the NAS, reads the limit of inotify and warns when it is near.
//!
//! Plain HTTP/1.1 over the unix socket, one request per connection. Without the socket (in
//! development) nothing can be shared and nothing is sent.

use serde_json::{json, Value};
use std::{path::PathBuf, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::UnixStream,
};

const ID: &str = "nas-file-manager";
const TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Default)]
pub struct Launcher {
    socket: Option<PathBuf>,
}

/// An answer of the launcher: its status and its body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Answer {
    pub status: u16,
    pub body: String,
}

impl Launcher {
    pub fn new(socket: Option<PathBuf>) -> Self {
        Self { socket }
    }

    pub fn from_env() -> Self {
        Self::new(
            std::env::var_os("NAS_LAUNCHER_SOCKET")
                .filter(|value| !value.is_empty())
                .map(PathBuf::from),
        )
    }

    pub async fn request(
        &self,
        method: &str,
        path: &str,
        body: Option<&Value>,
    ) -> Result<Answer, String> {
        let socket = self.socket.as_ref().ok_or("no launcher socket")?;
        let body = body.map(Value::to_string).unwrap_or_default();
        let exchange = async {
            let mut stream = UnixStream::connect(socket)
                .await
                .map_err(|error| format!("the launcher is not reachable: {error}"))?;
            let request = format!(
                "{method} {path} HTTP/1.1\r\nHost: nas\r\nConnection: close\r\n\
                 Content-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            );
            stream
                .write_all(request.as_bytes())
                .await
                .map_err(|error| format!("the launcher did not take the request: {error}"))?;
            let mut raw = Vec::new();
            stream
                .read_to_end(&mut raw)
                .await
                .map_err(|error| format!("the launcher did not answer: {error}"))?;
            parse(&raw)
        };
        tokio::time::timeout(TIMEOUT, exchange)
            .await
            .map_err(|_| "the launcher did not answer in time".to_owned())?
    }

    /// A request whose answer does not matter beyond the journal: nothing without the socket.
    async fn send(&self, method: &str, path: &str, body: &Value) {
        if self.socket.is_none() {
            return;
        }
        match self.request(method, path, Some(body)).await {
            Ok(answer) if answer.status < 300 => {}
            Ok(answer) => eprintln!("<4>the launcher refused {method} {path}: {}", answer.body),
            Err(reason) => eprintln!("<4>{method} {path} was not sent: {reason}"),
        }
    }

    /// Says whether this application has work to do without its window.
    pub async fn background(&self, needed: bool) {
        self.send(
            "PUT",
            "/api/apps/self/background",
            &json!({ "needed": needed }),
        )
        .await;
    }

    /// Shows an operation among those of the NAS, which cannot be paused or stopped.
    pub async fn start_task(&self, id: &str, name: &str) {
        let task = json!({
            "id": id,
            "source": ID,
            "name": name,
            "pausable": false,
            "cancellable": false,
        });
        self.send("POST", "/api/tasks", &task).await;
    }

    /// Reports where an operation is, or closes it with `state`.
    pub async fn update_task(&self, id: &str, update: &Value) {
        self.send("PATCH", &format!("/api/tasks/{id}"), update)
            .await;
    }

    /// A notification of the launcher, under the name of this application: `key` and `params`
    /// let the launcher say it in the language of its interface.
    pub async fn notify(&self, title: &str, message: &str, key: &str, params: &Value) {
        let notification = json!({
            "title": title,
            "message": message,
            "source": ID,
            "tone": "warning",
            "key": key,
            "params": params,
        });
        self.send("POST", "/api/notifications", &notification).await;
    }

    /// The kernel's limit of inotify watches for each user, which this application cannot read.
    pub async fn inotify_limit(&self) -> Option<u64> {
        let answer = self
            .request("GET", "/api/system/inotify", None)
            .await
            .ok()
            .filter(|answer| answer.status == 200)?;
        serde_json::from_str::<Value>(&answer.body).ok()?["maxUserWatches"].as_u64()
    }
}

/// The status and the body of a response, chunked or not.
pub fn parse(raw: &[u8]) -> Result<Answer, String> {
    let end = raw
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or("the launcher answered something that is not HTTP")?;
    let head = String::from_utf8_lossy(&raw[..end]);
    let body = &raw[end + 4..];
    let status = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse().ok())
        .ok_or("the launcher answered without a status")?;
    let chunked = head.lines().any(|line| {
        line.to_ascii_lowercase()
            .starts_with("transfer-encoding: chunked")
    });
    let body = if chunked {
        dechunk(body)
    } else {
        body.to_vec()
    };
    Ok(Answer {
        status,
        body: String::from_utf8_lossy(&body).into_owned(),
    })
}

fn dechunk(mut body: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    while let Some(line) = body.windows(2).position(|window| window == b"\r\n") {
        let size = std::str::from_utf8(&body[..line])
            .ok()
            .and_then(|size| usize::from_str_radix(size.trim(), 16).ok());
        let rest = &body[line + 2..];
        match size {
            Some(size) if size > 0 && rest.len() >= size => {
                out.extend_from_slice(&rest[..size]);
                body = rest[size..].strip_prefix(b"\r\n").unwrap_or(&rest[size..]);
            }
            _ => break,
        }
    }
    out
}

#[cfg(test)]
#[path = "../../tests/unit/axum/launcher.rs"]
mod tests;
