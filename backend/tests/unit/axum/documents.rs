use super::*;

fn scratch(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("nas-documents-{}-{name}", std::process::id()))
}

async fn body(response: Response) -> (StatusCode, String) {
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body");
    (status, String::from_utf8_lossy(&bytes).into_owned())
}

async fn get_document(documents: &Documents, name: &str) -> (StatusCode, String) {
    body(read(State(documents.clone()), Path(name.to_owned())).await).await
}

async fn put_document(documents: &Documents, name: &str, value: &str) -> StatusCode {
    write(
        State(documents.clone()),
        Path(name.to_owned()),
        Bytes::from(value.to_owned()),
    )
    .await
    .status()
}

#[test]
fn finds_its_database_in_the_state_directory_of_the_unit() {
    assert_eq!(
        database_path(Some("/tmp/a.sqlite3".into()), None, "x.sqlite3"),
        Ok(PathBuf::from("/tmp/a.sqlite3"))
    );
    assert_eq!(
        database_path(
            Some("".into()),
            Some("/var/lib/nas-app/x:/other".into()),
            "x.sqlite3"
        ),
        Ok(PathBuf::from("/var/lib/nas-app/x/x.sqlite3"))
    );
    assert!(database_path(None, None, "x.sqlite3")
        .expect("a development path")
        .ends_with("data/x.sqlite3"));
}

#[tokio::test]
async fn keeps_the_documents_it_accepts_and_refuses_the_others() {
    let directory = scratch("keeps");
    let pool = open(&directory.join("nested/documents.sqlite3"))
        .await
        .expect("database");
    let _routes: Router = router(pool.clone(), &["preferences", "favorites"]);
    let documents = Documents {
        pool,
        names: &["preferences", "favorites"],
    };

    assert_eq!(
        get_document(&documents, "preferences").await,
        (StatusCode::OK, "null".to_owned())
    );
    assert_eq!(
        put_document(&documents, "preferences", r#"{"compact":true}"#).await,
        StatusCode::NO_CONTENT
    );
    put_document(&documents, "preferences", r#"{"compact":false}"#).await;
    assert_eq!(
        get_document(&documents, "preferences").await,
        (StatusCode::OK, r#"{"compact":false}"#.to_owned())
    );
    put_document(&documents, "favorites", r#"[{"path":"/a"}]"#).await;
    assert_eq!(
        get_document(&documents, "favorites").await.1,
        r#"[{"path":"/a"}]"#
    );

    for (name, value, status) in [
        ("secrets", "{}", StatusCode::NOT_FOUND),
        ("preferences", "not json", StatusCode::BAD_REQUEST),
        ("preferences", "42", StatusCode::BAD_REQUEST),
    ] {
        assert_eq!(
            put_document(&documents, name, value).await,
            status,
            "{name} {value}"
        );
    }
    assert_eq!(
        get_document(&documents, "secrets").await.0,
        StatusCode::NOT_FOUND
    );
    let large = format!("[\"{}\"]", "x".repeat(MAX_BYTES));
    assert_eq!(
        put_document(&documents, "favorites", &large).await,
        StatusCode::PAYLOAD_TOO_LARGE
    );
    std::fs::remove_dir_all(directory).expect("clean up");
}

#[tokio::test]
async fn says_so_when_its_database_is_gone() {
    let directory = scratch("gone");
    let pool = open(&directory.join("documents.sqlite3"))
        .await
        .expect("database");
    let documents = Documents {
        pool: pool.clone(),
        names: &["preferences"],
    };
    pool.close().await;
    assert_eq!(
        get_document(&documents, "preferences").await.0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert_eq!(
        put_document(&documents, "preferences", "{}").await,
        StatusCode::SERVICE_UNAVAILABLE
    );
    std::fs::remove_dir_all(directory).expect("clean up");
}
