use std::{
    collections::HashMap,
    os::unix::net::UnixListener as StdUnixListener,
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    body::Body,
    http::{header::CACHE_CONTROL, Request},
    routing::get,
    Router,
};
use tower::ServiceExt;

use std::path::Path;

use super::*;

fn temp_dir() -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = env::temp_dir().join(format!(
        "nas-file-manager-main-{}-{nonce}",
        std::process::id()
    ));
    fs::create_dir_all(&path).unwrap();
    path
}

/// The environment of a test: the variables it names, and nothing else.
fn settings(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
    let values = pairs
        .iter()
        .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
        .collect::<HashMap<_, _>>();
    move |name| values.get(name).cloned()
}

#[test]
fn reads_the_socket_from_the_arguments_or_the_launcher() {
    let args = |list: &[&str]| list.iter().map(|arg| (*arg).to_owned()).collect::<Vec<_>>();
    assert_eq!(
        listen_socket(&args(&["--listen", "/run/fm.sock"]), None).unwrap(),
        Some("/run/fm.sock".to_owned())
    );
    assert_eq!(
        listen_socket(&[], Some("/run/env.sock".to_owned())).unwrap(),
        Some("/run/env.sock".to_owned())
    );
    assert_eq!(listen_socket(&args(&["--tcp"]), None).unwrap(), None);
    for wrong in [
        args(&["--listen"]),
        args(&["--listen", ""]),
        args(&["--listen", "/a", "/b"]),
        args(&["--tcp", "extra"]),
        args(&["--other"]),
        args(&[]),
    ] {
        assert!(listen_socket(&wrong, None).is_err(), "{wrong:?}");
    }
}

#[test]
fn reads_the_volumes_of_the_registry() {
    let listed =
        volumes("a\tPhotos\t/srv/a\nb\tUSB\t/media/b\texternal\nc\tShare\t/mnt/c\tnetwork")
            .unwrap();
    assert_eq!(listed.len(), 3);
    assert_eq!(listed[0].kind, StorageKind::Device);
    assert_eq!(listed[1].kind, StorageKind::External);
    assert_eq!(listed[2].path, PathBuf::from("/mnt/c"));

    assert!(volumes("a\tPhotos").is_err());
    assert!(volumes("a\t\t/srv/a").is_err());
    assert!(volumes("a\tPhotos\t/srv/a\tfloppy").is_err());
}

#[test]
fn takes_the_storage_from_the_grant_then_from_development() {
    let both = settings(&[
        ("NAS_STORAGE_ROOT", "/srv/storage"),
        ("FS_EXPLORER_ROOT", "/tmp"),
    ]);
    assert_eq!(
        storage_setting(&both, "NAS_STORAGE_ROOT", "FS_EXPLORER_ROOT").as_deref(),
        Some("/srv/storage")
    );
    let local = settings(&[("NAS_STORAGE_ROOT", ""), ("FS_EXPLORER_ROOT", "/tmp")]);
    assert_eq!(
        storage_setting(&local, "NAS_STORAGE_ROOT", "FS_EXPLORER_ROOT").as_deref(),
        Some("/tmp")
    );
}

#[test]
fn asks_for_the_storage_and_its_registry_on_the_nas() {
    assert!(configured_filesystem(&settings(&[]), true)
        .unwrap_err()
        .to_string()
        .contains("NAS_STORAGE_ROOT"));

    let dir = temp_dir();
    let root = dir.to_string_lossy().into_owned();
    let on_nas = settings(&[
        ("NAS_STORAGE_ROOT", &root),
        ("NAS_APP_ID", "nas-file-manager"),
    ]);
    assert!(configured_filesystem(&on_nas, true)
        .unwrap_err()
        .to_string()
        .contains("NAS_STORAGE_REGISTRY"));

    let development = settings(&[("FS_EXPLORER_ROOT", &root)]);
    assert!(configured_filesystem(&development, false).is_ok());
    assert!(configured_filesystem(&settings(&[]), false).is_ok());

    let registry = dir.join("volumes.tsv");
    fs::write(&registry, "broken").unwrap();
    let registry = registry.to_string_lossy().into_owned();
    let listed = settings(&[
        ("NAS_STORAGE_ROOT", &root),
        ("NAS_STORAGE_REGISTRY", &registry),
    ]);
    assert!(configured_filesystem(&listed, true).is_err());
    fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn keeps_the_page_out_of_the_cache_and_the_hashed_files_in_it() {
    let app = Router::new()
        .route("/", get(|| async { "page" }))
        .route("/app.js", get(|| async { "script" }))
        .route("/assets/index-abc.js", get(|| async { "bundle" }))
        .layer(axum::middleware::from_fn(prevent_stale_page));
    let header = |uri: &'static str| {
        let app = app.clone();
        async move {
            let response = app
                .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
                .await
                .unwrap();
            response.headers().get(CACHE_CONTROL).cloned()
        }
    };

    assert_eq!(header("/").await.unwrap(), "no-store");
    assert!(header("/app.js").await.is_none());
    assert_eq!(
        header("/assets/index-abc.js").await.unwrap(),
        "public, max-age=31536000, immutable"
    );
    assert!(header("/assets/missing.js").await.is_none());
}

#[tokio::test]
async fn prepares_the_socket_only_over_a_stale_one() {
    let dir = temp_dir();
    let file = dir.join("occupied");
    fs::write(&file, "file").unwrap();
    assert!(prepare_socket(file.to_str().unwrap()).await.is_err());

    let live = dir.join("live.sock");
    let listener = tokio::net::UnixListener::bind(&live).unwrap();
    assert!(prepare_socket(live.to_str().unwrap()).await.is_err());
    drop(listener);

    let stale = dir.join("stale.sock");
    drop(StdUnixListener::bind(&stale).unwrap());
    assert!(prepare_socket(stale.to_str().unwrap()).await.is_ok());
    assert!(!stale.exists());
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn finds_the_interface_configured_or_beside_the_binary() {
    assert_eq!(
        package_dist(Some("/custom/ui".into()), Path::new("/x/bin/app")).unwrap(),
        PathBuf::from("/custom/ui")
    );
    assert_eq!(
        package_dist(None, Path::new("/opt/fm/bin/app")).unwrap(),
        PathBuf::from("/opt/fm/dist")
    );
    assert!(package_dist(None, Path::new("app")).is_err());
}

#[tokio::test]
async fn serves_the_interface_on_its_socket_until_stopped() {
    let dir = temp_dir();
    let socket = dir.join("fm.sock");
    let socket_path = socket.to_string_lossy().into_owned();
    let router = || fs_explorer_axum::router(Filesystem::new(&dir).unwrap());
    assert!(
        serve_socket(&socket_path, router(), dir.join("missing"), async {})
            .await
            .unwrap_err()
            .to_string()
            .contains("frontend is missing")
    );

    let dist = dir.join("dist");
    fs::create_dir_all(&dist).unwrap();
    fs::write(dist.join("index.html"), "page").unwrap();
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let check = async {
        for _ in 0..200 {
            if socket.exists() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        let listening = socket.exists();
        stop.send(()).unwrap();
        listening
    };
    let (served, listening) = tokio::join!(
        serve_socket(&socket_path, router(), dist, async {
            let _ = stopped.await;
        }),
        check
    );
    assert!(served.is_ok());
    assert!(listening);
    fs::remove_dir_all(dir).unwrap();
}
