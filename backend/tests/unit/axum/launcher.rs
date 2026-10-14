use super::*;
use std::sync::{Arc, Mutex};
use tokio::net::UnixListener;

#[test]
fn reads_plain_and_chunked_answers() {
    let plain = parse(b"HTTP/1.1 204 No Content\r\ncontent-length: 0\r\n\r\n").expect("plain");
    assert_eq!(
        plain,
        Answer {
            status: 204,
            body: String::new()
        }
    );
    let chunked = parse(
        "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\n{\"a\"\r\n6\r\n:\"è\"}\r\n0\r\n\r\n"
            .as_bytes(),
    )
    .expect("chunked");
    assert_eq!(chunked.body, "{\"a\":\"è\"}");
    assert!(parse(b"not http").is_err());
    assert!(parse(b"HTTP/1.1 nope\r\n\r\n").is_err());
}

#[tokio::test]
async fn speaks_plain_http_on_the_socket_and_says_when_there_is_none() {
    let socket =
        std::env::temp_dir().join(format!("fs-explorer-launcher-{}.sock", std::process::id()));
    let _ = std::fs::remove_file(&socket);
    let listener = UnixListener::bind(&socket).expect("socket");
    let seen = Arc::new(Mutex::new(String::new()));
    let kept = Arc::clone(&seen);
    tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("connection");
        let mut buffer = [0; 4096];
        let read = stream.read(&mut buffer).await.expect("request");
        *kept.lock().expect("request") = String::from_utf8_lossy(&buffer[..read]).into_owned();
        let _ = stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}")
            .await;
    });

    let answer = Launcher::new(Some(socket.clone()))
        .request(
            "PUT",
            "/api/apps/self/shares",
            Some(&serde_json::json!({ "shares": [] })),
        )
        .await
        .expect("answer");
    assert_eq!(answer.status, 200);
    let request = seen.lock().expect("request").clone();
    assert!(
        request.starts_with("PUT /api/apps/self/shares HTTP/1.1\r\n"),
        "{request}"
    );
    assert!(request.ends_with("{\"shares\":[]}"), "{request}");
    let _ = std::fs::remove_file(&socket);

    assert!(Launcher::new(None).request("GET", "/", None).await.is_err());
    assert!(Launcher::new(Some(socket))
        .request("GET", "/", None)
        .await
        .is_err());
}

#[tokio::test]
async fn keeps_the_application_on_shows_its_operation_warns_and_reads_the_limit() {
    let socket = std::env::temp_dir().join(format!(
        "fs-explorer-launcher-calls-{}.sock",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&socket);
    let listener = UnixListener::bind(&socket).expect("socket");
    let seen = Arc::new(Mutex::new(Vec::<String>::new()));
    let kept = Arc::clone(&seen);
    tokio::spawn(async move {
        loop {
            let (mut stream, _) = listener.accept().await.expect("connection");
            let mut buffer = [0; 4096];
            let read = stream.read(&mut buffer).await.expect("request");
            let request = String::from_utf8_lossy(&buffer[..read]).into_owned();
            let answer: &[u8] = if request.starts_with("GET /api/system/inotify") {
                b"HTTP/1.1 200 OK\r\nContent-Length: 24\r\n\r\n{\"maxUserWatches\":65536}"
            } else if request.starts_with("POST /api/notifications") {
                b"HTTP/1.1 400 Bad Request\r\nContent-Length: 4\r\n\r\nnope"
            } else {
                b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n"
            };
            kept.lock().expect("requests").push(request);
            let _ = stream.write_all(answer).await;
        }
    });

    let launcher = Launcher::new(Some(socket.clone()));
    launcher.background(true).await;
    launcher.start_task("index", "Indice").await;
    launcher
        .update_task("index", &serde_json::json!({ "state": "done" }))
        .await;
    launcher
        .notify(
            "Titolo",
            "Messaggio",
            "searchWatchesNear",
            &serde_json::json!({}),
        )
        .await;
    assert_eq!(launcher.inotify_limit().await, Some(65536));
    let requests = seen.lock().expect("requests").clone();
    let lines: Vec<&str> = requests
        .iter()
        .map(|request| request.lines().next().unwrap_or_default())
        .collect();
    assert_eq!(
        lines,
        [
            "PUT /api/apps/self/background HTTP/1.1",
            "POST /api/tasks HTTP/1.1",
            "PATCH /api/tasks/index HTTP/1.1",
            "POST /api/notifications HTTP/1.1",
            "GET /api/system/inotify HTTP/1.1",
        ]
    );
    assert!(requests[0].ends_with(r#"{"needed":true}"#));
    assert!(requests[1].contains(r#""source":"nas-file-manager""#));
    assert!(requests[3].contains(r#""key":"searchWatchesNear""#));
    let _ = std::fs::remove_file(&socket);

    // Without the socket nothing is sent, and there is no limit to read.
    let alone = Launcher::new(None);
    alone.background(true).await;
    assert_eq!(alone.inotify_limit().await, None);
}
