mod launcher_only;
use std::error::Error;
#[cfg(unix)]
use std::os::unix::fs::FileTypeExt;
use std::{env, fs, path::PathBuf};

use nas_file_manager::filesystem::{Filesystem, NasVolume, StorageKind};
use tower_http::services::ServeDir;

async fn prevent_stale_page(
    request: axum::http::Request<axum::body::Body>,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let path = request.uri().path();
    let cache = if matches!(path, "/" | "/index.html") {
        Some("no-store")
    } else if path.starts_with("/assets/") {
        Some("public, max-age=31536000, immutable")
    } else {
        None
    };
    let mut response = next.run(request).await;
    if let Some(cache) = cache.filter(|_| response.status().is_success()) {
        response.headers_mut().insert(
            axum::http::header::CACHE_CONTROL,
            axum::http::HeaderValue::from_static(cache),
        );
    }
    response
}

/// An environment variable, as read by `main` or passed by a test.
type Setting<'a> = &'a dyn Fn(&str) -> Option<String>;

/// A storage setting, the name set by the launcher grant on the NAS first, then the development and
/// test one. Empty counts as missing.
fn storage_setting(setting: Setting, granted: &str, local: &str) -> Option<String> {
    [granted, local]
        .into_iter()
        .find_map(|name| setting(name).filter(|value| !value.is_empty()))
}

fn configured_filesystem(
    setting: Setting,
    socket_mode: bool,
) -> Result<Filesystem, Box<dyn Error>> {
    let root = match storage_setting(setting, "NAS_STORAGE_ROOT", "FS_EXPLORER_ROOT") {
        Some(root) => root,
        None if !socket_mode => ".".to_owned(),
        None => return Err("NAS_STORAGE_ROOT is required in socket mode".into()),
    };
    let registry = match storage_setting(setting, "NAS_STORAGE_REGISTRY", "FS_EXPLORER_REGISTRY") {
        Some(path) => path,
        _ if !socket_mode || setting("NAS_APP_ID").as_deref() != Some("nas-file-manager") => {
            return Ok(Filesystem::new(root)?);
        }
        None => return Err("NAS_STORAGE_REGISTRY is required on the NAS".into()),
    };
    let content = fs::read_to_string(registry)?;
    Ok(Filesystem::new_nas(root, volumes(&content)?)?.require_nas_mounts()?)
}

/// Volumes from the launcher registry, as tab separated id, name, path and kind.
fn volumes(content: &str) -> Result<Vec<NasVolume>, Box<dyn Error>> {
    let mut volumes = Vec::new();
    for line in content.lines() {
        let fields = line.split('\t').collect::<Vec<_>>();
        if !matches!(fields.len(), 3 | 4) || fields.iter().any(|field| field.is_empty()) {
            return Err("invalid Explorer volume registry".into());
        }
        let kind = match fields.get(3).copied().unwrap_or("device") {
            "device" => StorageKind::Device,
            "external" => StorageKind::External,
            "network" => StorageKind::Network,
            _ => return Err("invalid Explorer volume kind".into()),
        };
        volumes.push(NasVolume {
            id: fields[0].to_owned(),
            name: fields[1].to_owned(),
            path: PathBuf::from(fields[2]),
            kind,
        });
    }
    Ok(volumes)
}

#[cfg(unix)]
async fn prepare_socket(path: &str) -> Result<(), Box<dyn Error>> {
    if let Ok(metadata) = tokio::fs::symlink_metadata(path).await {
        if !metadata.file_type().is_socket() {
            return Err(format!("Socket path is occupied: {path}").into());
        }
        match tokio::net::UnixStream::connect(path).await {
            Ok(_) => return Err(format!("Socket is already listening: {path}").into()),
            Err(error) if error.kind() == std::io::ErrorKind::ConnectionRefused => {}
            Err(error) => return Err(format!("Unable to check socket: {error}").into()),
        }
        tokio::fs::remove_file(path).await?;
    }
    Ok(())
}

/// Socket to serve on, from `--listen` or the launcher configuration, or `None` with `--tcp` for
/// standalone development.
fn listen_socket(
    arguments: &[String],
    configured: Option<String>,
) -> Result<Option<String>, Box<dyn Error>> {
    let socket = match arguments {
        [] => configured,
        [flag, path] if flag == "--listen" && !path.is_empty() => Some(path.clone()),
        [flag, ..] if flag == "--listen" => return Err("invalid --listen arguments".into()),
        [flag] if flag == "--tcp" => return Ok(None),
        _ => return Err("unrecognized argument".into()),
    };
    if socket.is_none() {
        return Err("provide --listen, NAS_APP_SOCKET, or --tcp for standalone development".into());
    }
    Ok(socket)
}

/// `NAS_UI_DIR` when set, otherwise the `dist` of the package the binary sits in (`bin/`).
fn package_dist(
    configured: Option<std::ffi::OsString>,
    executable: &std::path::Path,
) -> Result<PathBuf, Box<dyn Error>> {
    if let Some(dist) = configured {
        return Ok(PathBuf::from(dist));
    }
    let package_root = executable
        .parent()
        .and_then(|bin| bin.parent())
        .ok_or("unable to locate package root")?;
    Ok(package_root.join("dist"))
}

/// Serves the API and the interface in `dist` on the socket, until `shutdown` completes.
#[cfg(unix)]
async fn serve_socket(
    socket_path: &str,
    app: axum::Router,
    dist: PathBuf,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> Result<(), Box<dyn Error>> {
    if !dist.join("index.html").is_file() {
        return Err("packaged frontend is missing".into());
    }
    prepare_socket(socket_path).await?;
    let listener = tokio::net::UnixListener::bind(socket_path)?;
    println!("FS Explorer listening on {socket_path}");
    axum::serve(
        launcher_only::LauncherOnly::new(listener),
        app.fallback_service(ServeDir::new(dist))
            .layer(axum::middleware::from_fn(prevent_stale_page)),
    )
    .with_graceful_shutdown(shutdown)
    .await?;
    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let arguments = env::args().skip(1).collect::<Vec<_>>();
    let listen_socket = listen_socket(&arguments, env::var("NAS_APP_SOCKET").ok())?;
    let setting = |name: &str| env::var(name).ok();
    let mut filesystem = configured_filesystem(&setting, listen_socket.is_some())?;
    if let Ok(state) = env::var("STATE_DIRECTORY") {
        if !state.is_empty() {
            filesystem = filesystem.with_cache_root(state);
        }
    }
    // Settings and favorites live in the app database, outside the mount checks.
    let database = nas_file_manager::documents::database_path(
        env::var_os("NAS_DB_PATH"),
        env::var_os("STATE_DIRECTORY"),
        "file-manager.sqlite3",
    )?;
    let documents = nas_file_manager::documents::open(&database)
        .await
        .map_err(|error| error.to_string())?;
    let shares = nas_file_manager::shares::Shares::new(
        documents.clone(),
        filesystem.clone(),
        nas_file_manager::launcher::Launcher::from_env(),
    );
    let previews = nas_file_manager::previews::Previews::new(documents.clone(), filesystem.clone());
    previews.apply_saved_limit().await;
    // Refuses requests at once when a volume is disconnected, without reading the mounts each time.
    tokio::spawn(filesystem.clone().watch_mounts());
    let (search, changes) =
        nas_file_manager::search::SearchIndex::new(documents.clone(), filesystem.clone());
    tokio::spawn(
        search
            .clone()
            .run(changes, nas_file_manager::launcher::Launcher::from_env()),
    );

    let trash = nas_file_manager::trash::Trash::new(documents.clone(), filesystem.clone())
        .with_shares(shares.clone());
    trash.apply_saved().await;
    tokio::spawn({
        let shares = shares.clone();
        async move { shares.hand_over_saved().await }
    });
    tokio::spawn(trash.clone().run());
    // Previews and index, which the launcher may empty.
    let caches = nas_file_manager::caches::Caches::new(filesystem.clone(), search.clone());
    let app = nas_file_manager::router(filesystem)
        .layer(axum::Extension(shares.clone()))
        .layer(axum::Extension(search))
        .layer(axum::Extension(trash.clone()))
        .merge(previews.router())
        .merge(caches.router())
        .merge(trash.router())
        .merge(nas_file_manager::documents::router(
            documents,
            &["preferences", "favorites"],
        ))
        .merge(shares.router());

    if let Some(socket_path) = listen_socket {
        #[cfg(unix)]
        {
            let executable = env::current_exe()?;
            let dist = package_dist(env::var_os("NAS_UI_DIR"), &executable)?;
            serve_socket(&socket_path, app, dist, std::future::pending()).await?;
        }
        #[cfg(not(unix))]
        return Err(format!("Unix sockets are unavailable: {socket_path}").into());
    } else {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:3000").await?;
        println!(
            "FS Explorer API listening on http://{}",
            listener.local_addr()?
        );
        axum::serve(listener, app).await?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "../tests/main.rs"]
mod tests;
