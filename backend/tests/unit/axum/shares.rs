use super::*;
use axum::{body::Body, http::Request};
use std::{
    fs,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::UnixListener,
};
use tower::ServiceExt;

static NEXT: AtomicU64 = AtomicU64::new(0);

/// A folder of its own for each test, gone with it.
struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "fs-explorer-shares-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(path.join("root/Foto/2026")).unwrap();
        fs::create_dir_all(path.join("root/Musica")).unwrap();
        fs::write(path.join("root/note.txt"), "note").unwrap();
        Self(path)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// A launcher that answers `status` to a change and writes down what it was sent.
fn launcher(socket: &std::path::Path, status: u16) -> Arc<Mutex<Vec<String>>> {
    let listener = UnixListener::bind(socket).expect("socket");
    let seen = Arc::new(Mutex::new(Vec::new()));
    let kept = Arc::clone(&seen);
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let mut request = Vec::new();
            let mut buffer = [0; 8192];
            loop {
                let read = stream.read(&mut buffer).await.unwrap_or(0);
                request.extend_from_slice(&buffer[..read]);
                let text = String::from_utf8_lossy(&request).into_owned();
                let complete = text.split_once("\r\n\r\n").is_some_and(|(head, body)| {
                    let length = head
                        .lines()
                        .find_map(|line| line.strip_prefix("Content-Length: "))
                        .and_then(|length| length.parse::<usize>().ok())
                        .unwrap_or(0);
                    body.len() >= length
                });
                if read == 0 || complete {
                    break;
                }
            }
            let text = String::from_utf8_lossy(&request).into_owned();
            let answer = if text.starts_with("GET") {
                (200, r#"{"available":true,"user":"valerio","recycle":true}"#)
            } else if status < 300 {
                (status, "")
            } else {
                (status, r#"{"error":"Foto is not a name a share can have"}"#)
            };
            kept.lock().unwrap().push(text);
            let reply = format!(
                "HTTP/1.1 {} X\r\nContent-Length: {}\r\n\r\n{}",
                answer.0,
                answer.1.len(),
                answer.1
            );
            let _ = stream.write_all(reply.as_bytes()).await;
        }
    });
    seen
}

async fn shares(scratch: &Scratch, socket: Option<PathBuf>) -> Shares {
    let pool = crate::documents::open(&scratch.0.join("db.sqlite3"))
        .await
        .unwrap();
    let filesystem = Filesystem::new(scratch.0.join("root")).unwrap();
    Shares::new(pool, filesystem, Launcher::new(socket))
}

async fn call(shares: &Shares, method: &str, uri: &str, body: &str) -> (StatusCode, Value) {
    let response = shares
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
    let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

/// The shares of the last list the launcher was sent.
fn last_sent(seen: &Arc<Mutex<Vec<String>>>) -> Value {
    let requests = seen.lock().unwrap();
    let put = requests
        .iter()
        .rev()
        .find(|request| request.starts_with("PUT"))
        .expect("a list was sent");
    serde_json::from_str::<Value>(put.split_once("\r\n\r\n").unwrap().1).unwrap()["shares"].clone()
}

#[test]
fn a_folder_is_shared_with_a_name_windows_takes_and_no_other_share_has() {
    assert_eq!(share_name("Foto", &[]), "Foto");
    assert_eq!(share_name("Foto [2026]", &[]), "Foto _2026_");
    assert_eq!(share_name("Foto", &["foto".to_owned()]), "Foto 2");
    assert_eq!(
        share_name("Foto", &["Foto".to_owned(), "Foto 2".to_owned()]),
        "Foto 3"
    );
    assert_eq!(share_name("global", &[]), "global share");
    assert_eq!(share_name("   ", &[]), "share");
    assert_eq!(share_name(&"x".repeat(80), &[]).len(), 60);
    assert_eq!(normalized("/Foto/2026/"), "Foto/2026");
}

#[tokio::test]
async fn a_share_is_saved_once_the_launcher_took_the_whole_list() {
    let scratch = Scratch::new();
    let socket = scratch.0.join("launcher.sock");
    let seen = launcher(&socket, 204);
    let shares = shares(&scratch, Some(socket)).await;

    let (status, folder) = call(
        &shares,
        "PUT",
        "/api/shares",
        r#"{"path":"/Foto","writable":false,"protected":true}"#,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{folder}");
    assert_eq!(folder["name"], "Foto");
    assert_eq!(folder["entry"]["kind"], "folder");
    let sent = last_sent(&seen);
    assert_eq!(sent[0]["name"], "Foto");
    assert!(sent[0]["path"].as_str().unwrap().ends_with("/root/Foto"));
    assert_eq!(sent[0]["protected"], true);

    // Changed, it keeps its name; a second folder gets its own.
    call(
        &shares,
        "PUT",
        "/api/shares",
        r#"{"path":"Foto","writable":true,"protected":false}"#,
    )
    .await;
    call(
        &shares,
        "PUT",
        "/api/shares",
        r#"{"path":"Musica","writable":false,"protected":false}"#,
    )
    .await;
    let (status, overview) = call(&shares, "GET", "/api/shares", "").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(overview["available"], true);
    assert_eq!(overview["user"], "valerio");
    assert_eq!(overview["shares"].as_array().unwrap().len(), 2);
    assert_eq!(overview["shares"][0]["writable"], true);
    assert_eq!(last_sent(&seen).as_array().unwrap().len(), 2);

    let (status, _) = call(&shares, "DELETE", "/api/shares?path=Musica", "").await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(last_sent(&seen).as_array().unwrap().len(), 1);
    let (status, _) = call(&shares, "DELETE", "/api/shares?path=Musica", "").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_change_the_launcher_refuses_is_not_saved() {
    let scratch = Scratch::new();
    let socket = scratch.0.join("launcher.sock");
    launcher(&socket, 400);
    let shares = shares(&scratch, Some(socket)).await;

    let (status, refused) = call(
        &shares,
        "PUT",
        "/api/shares",
        r#"{"path":"Foto","writable":false,"protected":true}"#,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(refused["error"], "Foto is not a name a share can have");
    let (_, overview) = call(&shares, "GET", "/api/shares", "").await;
    assert!(overview["shares"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn without_the_launcher_nothing_is_shared() {
    let scratch = Scratch::new();
    let shares = shares(&scratch, None).await;

    let (status, _) = call(
        &shares,
        "PUT",
        "/api/shares",
        r#"{"path":"Foto","writable":false,"protected":true}"#,
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    let (status, overview) = call(&shares, "GET", "/api/shares", "").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(overview["available"], false);
    assert_eq!(overview["user"], Value::Null);

    for (body, expected) in [
        (
            r#"{"path":"note.txt","writable":false,"protected":true}"#,
            StatusCode::BAD_REQUEST,
        ),
        (
            r#"{"path":"","writable":false,"protected":true}"#,
            StatusCode::FORBIDDEN,
        ),
        (
            r#"{"path":"Nothing","writable":false,"protected":true}"#,
            StatusCode::NOT_FOUND,
        ),
    ] {
        assert_eq!(
            call(&shares, "PUT", "/api/shares", body).await.0,
            expected,
            "{body}"
        );
    }
}

#[tokio::test]
async fn shares_follow_their_folder_and_go_with_it() {
    let scratch = Scratch::new();
    let socket = scratch.0.join("launcher.sock");
    let seen = launcher(&socket, 204);
    let shares = shares(&scratch, Some(socket)).await;
    for path in ["Foto", "Foto/2026", "Musica"] {
        let body = format!(r#"{{"path":"{path}","writable":false,"protected":true}}"#);
        assert_eq!(
            call(&shares, "PUT", "/api/shares", &body).await.0,
            StatusCode::OK
        );
    }

    fs::rename(scratch.0.join("root/Foto"), scratch.0.join("root/Immagini")).unwrap();
    shares.relocated("/Foto", "Immagini").await;
    let (_, overview) = call(&shares, "GET", "/api/shares", "").await;
    // In the order of their names: 2026, Foto, Musica.
    let paths: Vec<&str> = overview["shares"]
        .as_array()
        .unwrap()
        .iter()
        .map(|share| share["path"].as_str().unwrap())
        .collect();
    assert_eq!(paths, ["Immagini/2026", "Immagini", "Musica"]);
    assert!(last_sent(&seen).as_array().unwrap()[1]["path"]
        .as_str()
        .unwrap()
        .ends_with("/root/Immagini"));

    // A folder with a similar name is not below it.
    shares.forgotten("Musica").await;
    shares.forgotten("Immag").await;
    let (_, overview) = call(&shares, "GET", "/api/shares", "").await;
    assert_eq!(overview["shares"].as_array().unwrap().len(), 2);
    shares.forgotten("Immagini").await;
    let (_, overview) = call(&shares, "GET", "/api/shares", "").await;
    assert!(overview["shares"].as_array().unwrap().is_empty());
    assert!(last_sent(&seen).as_array().unwrap().is_empty());

    // Nothing to follow, nothing sent.
    let sent = seen.lock().unwrap().len();
    shares.relocated("Altro", "Altrove").await;
    assert_eq!(seen.lock().unwrap().len(), sent);
}

#[tokio::test]
async fn a_saved_list_reaches_the_launcher_at_start_and_a_missing_folder_is_left_out() {
    let scratch = Scratch::new();
    let socket = scratch.0.join("launcher.sock");
    let seen = launcher(&socket, 204);
    let shares = shares(&scratch, Some(socket)).await;
    shares.hand_over_saved().await;
    assert!(seen.lock().unwrap().is_empty());

    for path in ["Foto", "Musica"] {
        let body = format!(r#"{{"path":"{path}","writable":false,"protected":false}}"#);
        call(&shares, "PUT", "/api/shares", &body).await;
    }
    fs::remove_dir_all(scratch.0.join("root/Musica")).unwrap();
    shares.hand_over_saved().await;
    let sent = last_sent(&seen);
    assert_eq!(sent.as_array().unwrap().len(), 1);
    assert_eq!(sent[0]["name"], "Foto");
    let (_, overview) = call(&shares, "GET", "/api/shares", "").await;
    assert_eq!(overview["shares"][1]["entry"], Value::Null);
}

#[tokio::test]
async fn the_routes_of_the_files_take_the_shares_along() {
    let scratch = Scratch::new();
    let socket = scratch.0.join("launcher.sock");
    launcher(&socket, 204);
    let shares = shares(&scratch, Some(socket)).await;
    for path in ["Foto", "Musica"] {
        let body = format!(r#"{{"path":"{path}","writable":false,"protected":true}}"#);
        call(&shares, "PUT", "/api/shares", &body).await;
    }
    let files = crate::router(Filesystem::new(scratch.0.join("root")).unwrap())
        .layer(axum::Extension(shares.clone()));
    for (method, uri, body) in [
        (
            "PATCH",
            "/api/files",
            r#"{"path":"Foto","name":"Immagini"}"#,
        ),
        (
            "POST",
            "/api/move",
            r#"{"source":"Immagini","destination":"Musica/Immagini"}"#,
        ),
        ("DELETE", "/api/files?path=Musica", ""),
    ] {
        let response = files
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(uri)
                    .header("content-type", "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert!(response.status().is_success(), "{method} {uri}");
        if method == "POST" {
            let (_, overview) = call(&shares, "GET", "/api/shares", "").await;
            assert_eq!(overview["shares"][0]["path"], "Musica/Immagini");
        }
    }
    let (_, overview) = call(&shares, "GET", "/api/shares", "").await;
    assert!(overview["shares"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn the_files_deleted_from_a_share_go_to_the_trash_while_it_is_on() {
    let scratch = Scratch::new();
    let socket = scratch.0.join("launcher.sock");
    let seen = launcher(&socket, 204);
    let shares = shares(&scratch, Some(socket)).await;
    shares.filesystem.set_trash(true);
    call(
        &shares,
        "PUT",
        "/api/shares",
        r#"{"path":"Foto","writable":true,"protected":false}"#,
    )
    .await;
    let sent = last_sent(&seen);
    assert!(sent[0]["trash"]
        .as_str()
        .unwrap()
        .ends_with("/root/.nas-trash/Foto"));

    // Turned off from the settings, the shares go again without it.
    let trash = crate::trash::Trash::new(shares.pool.clone(), shares.filesystem.clone())
        .with_shares(shares.clone());
    let response = trash
        .router::<()>()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/api/trash/settings")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"enabled":false,"days":30}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(last_sent(&seen)[0].get("trash").is_none());
}
