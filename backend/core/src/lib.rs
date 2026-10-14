use std::{
    collections::HashMap,
    ffi::OsStr,
    fs,
    io::{self, Cursor, ErrorKind},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use image::{
    codecs::jpeg::JpegEncoder, metadata::Orientation, DynamicImage, ImageDecoder, ImageFormat,
    ImageReader,
};
use rars::{ArchiveReadOptions, ArchiveReader};
use serde::{Deserialize, Serialize};
use sevenz_rust2::{Archive, Password};
use zip::ZipArchive;

mod trash;
pub use trash::{TrashDisk, TrashEntry, TrashFile, TRASH_DIRECTORY, TRASH_OFF};

/// The folder of the previews where they sit beside the files (in development): never listed,
/// searched or indexed.
pub const CACHE_DIRECTORY: &str = ".fs-explorer-cache";
const MAX_SEARCH_RESULTS_PER_VOLUME: usize = 2_000;
const MAX_SEARCH_VISITED_ENTRIES_PER_VOLUME: usize = 10_000;
const MAX_SEARCH_SCAN_DEPTH: usize = 12;
const PREVIEW_DIRECTORY: &str = "previews";
/// The space the previews may take on the disk unless the settings say otherwise.
pub const DEFAULT_PREVIEW_CACHE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// Changed when the previews are made differently: the old ones are no longer found, and go.
const PREVIEW_FORMAT: &str = "v2";
const PREVIEW_JPEG_QUALITY: u8 = 80;
const MAX_SVG_PREVIEW_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub kind: FileKind,
    pub hidden: bool,
    pub size: Option<u64>,
    pub modified: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub available_bytes: u64,
    pub total_bytes: u64,
    pub used_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    Archive,
    Document,
    File,
    Folder,
    Image,
    Video,
}

#[derive(Debug, Clone)]
pub struct Preview {
    pub bytes: Vec<u8>,
    pub content_type: String,
    pub cache_hit: bool,
}

/// How big a preview is made: small for the lists and the grid, large for the details.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PreviewSize {
    Small,
    #[default]
    Large,
}

impl PreviewSize {
    fn bounds(self) -> (u32, u32) {
        match self {
            Self::Small => (256, 256),
            Self::Large => (640, 400),
        }
    }

    fn id(self) -> &'static str {
        match self {
            Self::Small => "small",
            Self::Large => "large",
        }
    }
}

/// The previews on the disk, shared by every copy of the filesystem: how much room they may take,
/// and how much they take, counted once and then kept up to date.
#[derive(Debug)]
struct PreviewCache {
    limit: AtomicU64,
    used: Mutex<Option<u64>>,
}

impl Default for PreviewCache {
    fn default() -> Self {
        Self {
            limit: AtomicU64::new(DEFAULT_PREVIEW_CACHE_BYTES),
            used: Mutex::new(None),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDirectoryRequest {
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFileRequest {
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyMoveRequest {
    pub source: String,
    pub destination: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameRequest {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveRequest {
    pub path: String,
    pub password: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Filesystem {
    root: PathBuf,
    cache_root: PathBuf,
    volumes: Vec<Volume>,
    nas_mode: bool,
    mount_ids: Option<Vec<(PathBuf, String)>>,
    previews: Arc<PreviewCache>,
    /// Whether a deletion goes to the trash of its disk (`trash`), shared by every clone.
    trash: Arc<AtomicBool>,
}

#[derive(Debug, Clone)]
struct Volume {
    id: String,
    name: String,
    path: PathBuf,
    kind: StorageKind,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NasVolume {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    pub kind: StorageKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StorageKind {
    Device,
    External,
    Network,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VolumeInfo {
    pub id: String,
    pub name: String,
    pub kind: StorageKind,
}

impl Filesystem {
    pub fn new(root: impl AsRef<Path>) -> io::Result<Self> {
        let root = root.as_ref().canonicalize()?;
        if !root.is_dir() {
            return Err(io::Error::new(
                ErrorKind::InvalidInput,
                "the filesystem root must be a directory",
            ));
        }
        Ok(Self {
            cache_root: root.join(CACHE_DIRECTORY),
            root,
            volumes: Vec::new(),
            nas_mode: false,
            mount_ids: None,
            previews: Arc::default(),
            trash: Arc::default(),
        })
    }

    pub fn new_nas(root: impl AsRef<Path>, configured: Vec<NasVolume>) -> io::Result<Self> {
        let root = root.as_ref().canonicalize()?;
        if !root.is_dir() {
            return Err(io::Error::new(
                ErrorKind::InvalidInput,
                "the NAS storage root must be a directory",
            ));
        }
        let mut volumes = Vec::with_capacity(configured.len());
        for volume in configured {
            if volume.id.is_empty()
                || !volume
                    .id
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
                || volumes
                    .iter()
                    .any(|existing: &Volume| existing.id == volume.id)
            {
                return Err(io::Error::new(ErrorKind::InvalidInput, "invalid volume id"));
            }
            let path = volume.path.canonicalize()?;
            if !path.is_dir() || path == root || !path.starts_with(&root) {
                return Err(io::Error::new(
                    ErrorKind::PermissionDenied,
                    "volume is outside the storage root",
                ));
            }
            volumes.push(Volume {
                id: volume.id,
                name: volume.name,
                path,
                kind: volume.kind,
            });
        }
        Ok(Self {
            cache_root: root.join(CACHE_DIRECTORY),
            root,
            volumes,
            nas_mode: true,
            mount_ids: None,
            previews: Arc::default(),
            trash: Arc::default(),
        })
    }

    pub fn with_cache_root(mut self, path: impl AsRef<Path>) -> Self {
        self.cache_root = path.as_ref().join(CACHE_DIRECTORY);
        self
    }

    pub fn require_nas_mounts(mut self) -> io::Result<Self> {
        let mounts = active_mounts()?;
        let mut ids = Vec::new();
        for volume in &self.volumes {
            let id = mounts
                .iter()
                .find(|(path, _)| path == &volume.path)
                .ok_or_else(|| {
                    io::Error::new(ErrorKind::NotFound, "storage volume is not mounted")
                })?;
            ids.push(id.clone());
        }
        self.mount_ids = Some(ids);
        Ok(self)
    }

    pub fn verify_nas_mounts(&self) -> io::Result<()> {
        if let Some(expected) = &self.mount_ids {
            let active = active_mounts()?;
            if expected.iter().any(|mount| !active.contains(mount)) {
                return Err(io::Error::new(
                    ErrorKind::NotFound,
                    "a storage volume was disconnected",
                ));
            }
        }
        Ok(())
    }

    pub fn storage_info(&self) -> io::Result<StorageInfo> {
        if self.nas_mode && self.volumes.is_empty() {
            return Ok(StorageInfo {
                available_bytes: 0,
                total_bytes: 0,
                used_bytes: 0,
            });
        }
        if !self.volumes.is_empty() {
            return self.storage_info_for_volumes();
        }
        storage_info_for_path(&self.root)
    }

    pub fn volumes(&self) -> Vec<VolumeInfo> {
        self.volumes
            .iter()
            .map(|volume| VolumeInfo {
                id: volume.id.clone(),
                name: volume.name.clone(),
                kind: volume.kind.clone(),
            })
            .collect()
    }

    fn storage_info_for_volumes(&self) -> io::Result<StorageInfo> {
        let mut storage = StorageInfo {
            available_bytes: 0,
            total_bytes: 0,
            used_bytes: 0,
        };
        let mut successful_reads = 0;
        for volume in &self.volumes {
            if let Ok(info) = storage_info_for_path(&volume.path) {
                storage.available_bytes =
                    storage.available_bytes.saturating_add(info.available_bytes);
                storage.total_bytes = storage.total_bytes.saturating_add(info.total_bytes);
                storage.used_bytes = storage.used_bytes.saturating_add(info.used_bytes);
                successful_reads += 1;
            }
        }
        if successful_reads == 0 {
            return Err(io::Error::other(
                "unable to read connected volume storage information",
            ));
        }
        Ok(storage)
    }

    pub fn list_directory(&self, path: impl AsRef<Path>) -> io::Result<Vec<FileEntry>> {
        if (self.nas_mode || !self.volumes.is_empty()) && is_empty_request_path(path.as_ref()) {
            return Ok(self.volume_entries());
        }
        let directory = self.resolve_existing(path)?;
        if !directory.is_dir() {
            return Err(io::Error::new(
                ErrorKind::InvalidInput,
                "path is not a directory",
            ));
        }

        let mut entries = fs::read_dir(directory)?
            .filter_map(Result::ok)
            .filter_map(|entry| self.entry_from_dir_entry(entry).ok())
            .collect::<Vec<_>>();

        entries.sort_by(|left, right| {
            let left_is_file = !matches!(left.kind, FileKind::Folder);
            let right_is_file = !matches!(right.kind, FileKind::Folder);
            left_is_file
                .cmp(&right_is_file)
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        });
        Ok(entries)
    }

    pub fn search(&self, query: &str) -> io::Result<Vec<FileEntry>> {
        self.search_with(query, &HashMap::new())
    }

    /// The folders the search index covers, by an id and the path the machine knows them by: the
    /// disks of the NAS but the network shares, which tell nothing of their changes; the root in
    /// development.
    pub fn search_roots(&self) -> Vec<(String, PathBuf)> {
        if self.volumes.is_empty() && !self.nas_mode {
            return vec![(String::new(), self.root.clone())];
        }
        self.volumes
            .iter()
            .filter(|volume| volume.kind != StorageKind::Network)
            .map(|volume| (volume.id.clone(), volume.path.clone()))
            .collect()
    }

    /// The folder holding a path of the Explorer, on the machine: where a change made here shows.
    pub fn folder_of(&self, path: impl AsRef<Path>) -> Option<PathBuf> {
        self.resolve_requested_path(path)
            .ok()?
            .parent()
            .map(Path::to_path_buf)
    }

    /// The search, with what the index found for the roots it holds whole (by their path): those
    /// are read again from the disk, for their size and time of today, and the others are walked.
    pub fn search_with(
        &self,
        query: &str,
        indexed: &HashMap<PathBuf, Vec<PathBuf>>,
    ) -> io::Result<Vec<FileEntry>> {
        let query = query.trim().to_lowercase();
        if query.is_empty() {
            return self.list_directory("");
        }

        let mut entries = self
            .volume_entries()
            .into_iter()
            .filter(|entry| {
                entry.name.to_lowercase().contains(&query)
                    || entry.path.to_lowercase().contains(&query)
            })
            .collect::<Vec<_>>();
        let found = |root: &Path| {
            indexed.get(root).map(|paths| {
                paths
                    .iter()
                    .filter_map(|path| self.entry_from_path(path.clone()).ok())
                    .collect::<Vec<_>>()
            })
        };
        if self.volumes.is_empty() && !self.nas_mode {
            if let Some(found) = found(&self.root) {
                entries.extend(found);
            } else {
                let mut visited = 0;
                self.search_directory_limited(
                    &self.root,
                    &query,
                    &mut entries,
                    0,
                    &mut visited,
                    MAX_SEARCH_RESULTS_PER_VOLUME,
                )?;
            }
        } else {
            for volume in &self.volumes {
                if let Some(found) = found(&volume.path) {
                    entries.extend(found);
                    continue;
                }
                let mut volume_entries = Vec::new();
                let mut visited = 0;
                let _ = self.search_directory_limited(
                    &volume.path,
                    &query,
                    &mut volume_entries,
                    0,
                    &mut visited,
                    MAX_SEARCH_RESULTS_PER_VOLUME,
                );
                entries.extend(volume_entries);
            }
        }
        entries.sort_by_key(|entry| entry.name.to_lowercase());
        Ok(entries)
    }

    pub fn create_directory(&self, path: impl AsRef<Path>) -> io::Result<FileEntry> {
        let path = self.resolve_new(path)?;
        fs::create_dir(&path)?;
        self.entry_from_path(path)
    }

    pub fn create_file(&self, path: impl AsRef<Path>) -> io::Result<FileEntry> {
        let path = self.resolve_new(path)?;
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)?;
        self.entry_from_path(path)
    }

    pub fn rename(&self, path: impl AsRef<Path>, name: &str) -> io::Result<FileEntry> {
        validate_name(name)?;
        let source = self.resolve_existing(path)?;
        self.ensure_not_root(&source)?;
        let destination = source
            .parent()
            .ok_or_else(|| io::Error::new(ErrorKind::InvalidInput, "entry has no parent"))?
            .join(name);
        if destination.exists() {
            return Err(io::Error::new(
                ErrorKind::AlreadyExists,
                "destination already exists",
            ));
        }
        fs::rename(source, &destination)?;
        self.entry_from_path(destination)
    }

    pub fn copy(
        &self,
        source: impl AsRef<Path>,
        destination: impl AsRef<Path>,
    ) -> io::Result<FileEntry> {
        let source = self.resolve_existing(source)?;
        let destination = self.resolve_new(destination)?;
        if source.is_dir() && destination.starts_with(&source) {
            return Err(io::Error::new(
                ErrorKind::InvalidInput,
                "cannot copy a directory into itself",
            ));
        }

        if source.is_dir() {
            copy_directory(&source, &destination)?;
        } else {
            fs::copy(&source, &destination)?;
        }
        self.entry_from_path(destination)
    }

    pub fn move_entry(
        &self,
        source: impl AsRef<Path>,
        destination: impl AsRef<Path>,
    ) -> io::Result<FileEntry> {
        let source = self.resolve_existing(source)?;
        self.ensure_not_root(&source)?;
        let destination = self.resolve_new(destination)?;
        if source.is_dir() && destination.starts_with(&source) {
            return Err(io::Error::new(
                ErrorKind::InvalidInput,
                "cannot move a directory into itself",
            ));
        }
        match fs::rename(&source, &destination) {
            // Each disk of the NAS is a file system of its own, which a rename cannot leave.
            Err(error) if error.kind() == ErrorKind::CrossesDevices => {
                move_across_devices(&source, &destination)?;
            }
            moved => moved?,
        }
        self.entry_from_path(destination)
    }

    /// A folder to share on the local network: the path the machine knows it by, which the
    /// configuration of Samba names, and its entry. The root of everything is no folder of its own.
    pub fn shared_folder(&self, path: impl AsRef<Path>) -> io::Result<(PathBuf, FileEntry)> {
        let path = self.resolve_existing(path)?;
        if !path.is_dir() {
            return Err(io::Error::new(
                ErrorKind::InvalidInput,
                "only a folder can be shared",
            ));
        }
        if path == self.root {
            return Err(io::Error::new(
                ErrorKind::PermissionDenied,
                "the root cannot be shared",
            ));
        }
        let entry = self.entry_from_path(path.clone())?;
        Ok((path, entry))
    }

    pub fn delete(&self, path: impl AsRef<Path>) -> io::Result<()> {
        let path = self.resolve_existing(path)?;
        self.ensure_not_root(&path)?;
        if self.trash_enabled() {
            return self.move_to_trash(&path).map(drop);
        }
        if path.is_dir() {
            fs::remove_dir_all(path)
        } else {
            fs::remove_file(path)
        }
    }

    pub fn write_file(&self, path: impl AsRef<Path>, bytes: &[u8]) -> io::Result<FileEntry> {
        let path = self.resolve_new(path)?;
        fs::write(&path, bytes)?;
        self.entry_from_path(path)
    }

    pub fn read_file(&self, path: impl AsRef<Path>) -> io::Result<(FileEntry, Vec<u8>)> {
        let path = self.file_path(path)?;
        let entry = self.entry_from_path(path.clone())?;
        Ok((entry, fs::read(path)?))
    }

    /// The path on disk of a file inside the roots, checked as `read_file` checks it, for whoever
    /// reads it in pieces rather than whole.
    pub fn file_path(&self, path: impl AsRef<Path>) -> io::Result<PathBuf> {
        let path = self.resolve_existing(path)?;
        if path.is_dir() {
            return Err(io::Error::new(
                ErrorKind::InvalidInput,
                "path is a directory",
            ));
        }
        Ok(path)
    }

    pub fn list_archive(
        &self,
        path: impl AsRef<Path>,
        password: Option<&str>,
    ) -> io::Result<Vec<FileEntry>> {
        let archive = self.resolve_existing(path)?;
        if archive.is_dir() {
            return Err(io::Error::new(
                ErrorKind::InvalidInput,
                "archive path is a directory",
            ));
        }
        if !is_supported_archive(&archive) {
            return Err(io::Error::new(
                ErrorKind::InvalidInput,
                "archive format is not supported",
            ));
        }

        match archive
            .extension()
            .and_then(OsStr::to_str)
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str()
        {
            "zip" => list_zip_archive(&archive, password),
            "7z" => list_seven_zip_archive(&archive, password),
            "rar" => list_rar_archive(&archive, password),
            _ => Err(io::Error::new(
                ErrorKind::InvalidInput,
                "archive format is not supported",
            )),
        }
    }

    /// The preview of a file at the size asked for, made once and then read from the cache.
    pub fn preview(&self, path: impl AsRef<Path>, size: PreviewSize) -> io::Result<Preview> {
        let source = self.resolve_existing(path)?;
        if let Some(preview) = self.find_preview(&source, size)? {
            return Ok(preview);
        }
        let kind = file_kind(&source, source.is_dir());
        if matches!(kind, FileKind::Image) {
            let base = self.preview_base(&source, &kind, size)?;
            if is_svg(&source) {
                if let Ok(bytes) = svg_preview(&source) {
                    return self.store_preview(base.with_extension("svg"), bytes, "svg");
                }
            }
            if let Ok((bytes, extension)) = image_thumbnail(&source, size) {
                return self.store_preview(base.with_extension(extension), bytes, extension);
            }
        }
        self.cached_poster(&source, kind, size)
    }

    /// The preview when it is in the cache already, without making it: cheap, and never waits for
    /// the decoding of an image.
    pub fn cached_preview(
        &self,
        path: impl AsRef<Path>,
        size: PreviewSize,
    ) -> io::Result<Option<Preview>> {
        let source = self.resolve_existing(path)?;
        self.find_preview(&source, size)
    }

    fn find_preview(&self, source: &Path, size: PreviewSize) -> io::Result<Option<Preview>> {
        let kind = file_kind(source, source.is_dir());
        let base = self.preview_base(source, &kind, size)?;
        for extension in ["jpg", "png", "svg"] {
            let path = base.with_extension(extension);
            if let Ok(bytes) = fs::read(&path) {
                // Read now: the last to go when the cache is full.
                let _ = fs::File::options()
                    .write(true)
                    .open(&path)
                    .and_then(|file| file.set_modified(SystemTime::now()));
                return Ok(Some(Preview {
                    bytes,
                    content_type: content_type(extension).to_string(),
                    cache_hit: true,
                }));
            }
        }
        Ok(None)
    }

    /// How much room the previews may take; over it, those read least recently go.
    pub fn set_preview_cache_limit(&self, bytes: u64) {
        self.previews.limit.store(bytes, Ordering::Relaxed);
    }

    pub fn preview_cache_limit(&self) -> u64 {
        self.previews.limit.load(Ordering::Relaxed)
    }

    /// The room the previews take on the disk.
    pub fn preview_cache_usage(&self) -> io::Result<u64> {
        let mut used = self.lock_previews();
        if let Some(bytes) = *used {
            return Ok(bytes);
        }
        let bytes = self.preview_files()?.iter().map(|(_, size, _)| size).sum();
        *used = Some(bytes);
        Ok(bytes)
    }

    /// How many previews are on the disk.
    pub fn preview_cache_items(&self) -> io::Result<usize> {
        Ok(self.preview_files()?.len())
    }

    /// Prunes the previews to the limit, when they take more: after the limit was lowered.
    pub fn prune_preview_cache_to_limit(&self) -> io::Result<()> {
        if self.preview_cache_usage()? > self.preview_cache_limit() {
            self.prune_preview_cache()?;
        }
        Ok(())
    }

    /// Removes every preview: they are made again when asked for.
    pub fn clear_preview_cache(&self) -> io::Result<()> {
        let mut used = self.lock_previews();
        match fs::remove_dir_all(self.preview_cache_directory()) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        *used = Some(0);
        Ok(())
    }

    fn lock_previews(&self) -> std::sync::MutexGuard<'_, Option<u64>> {
        self.previews
            .used
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// The previews on the disk: when each was last read, its size and its path.
    fn preview_files(&self) -> io::Result<Vec<(SystemTime, u64, PathBuf)>> {
        let directory = match fs::read_dir(self.preview_cache_directory()) {
            Ok(directory) => directory,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error),
        };
        Ok(directory
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let metadata = entry.metadata().ok()?;
                if !metadata.is_file() {
                    return None;
                }
                Some((metadata.modified().ok()?, metadata.len(), entry.path()))
            })
            .collect())
    }

    fn entry_from_dir_entry(&self, entry: fs::DirEntry) -> io::Result<FileEntry> {
        if entry.file_name() == OsStr::new(CACHE_DIRECTORY)
            || entry.file_name() == OsStr::new(TRASH_DIRECTORY)
            || entry.file_name() == OsStr::new(TRASH_OFF)
        {
            return Err(io::Error::new(ErrorKind::NotFound, "internal cache entry"));
        }
        self.entry_from_path(entry.path())
    }

    fn search_directory_limited(
        &self,
        directory: &Path,
        query: &str,
        entries: &mut Vec<FileEntry>,
        depth: usize,
        visited: &mut usize,
        result_limit: usize,
    ) -> io::Result<()> {
        if depth > MAX_SEARCH_SCAN_DEPTH || *visited >= MAX_SEARCH_VISITED_ENTRIES_PER_VOLUME {
            return Ok(());
        }
        for entry in fs::read_dir(directory)?.flatten() {
            if *visited >= MAX_SEARCH_VISITED_ENTRIES_PER_VOLUME || entries.len() >= result_limit {
                break;
            }
            *visited += 1;
            self.search_entry(&entry, query, entries, depth, visited, result_limit);
        }
        Ok(())
    }

    /// Adds one entry to the results when its name matches, then descends into it when it is a
    /// folder. The internal cache is never searched.
    fn search_entry(
        &self,
        entry: &fs::DirEntry,
        query: &str,
        entries: &mut Vec<FileEntry>,
        depth: usize,
        visited: &mut usize,
        result_limit: usize,
    ) {
        if entry.file_name() == OsStr::new(CACHE_DIRECTORY)
            || entry.file_name() == OsStr::new(TRASH_DIRECTORY)
            || entry.file_name() == OsStr::new(TRASH_OFF)
        {
            return;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if name.contains(query) {
            if let Ok(file_entry) = self.entry_from_path(path.clone()) {
                entries.push(file_entry);
            }
        }
        if entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            let _ = self.search_directory_limited(
                &path,
                query,
                entries,
                depth + 1,
                visited,
                result_limit,
            );
        }
    }

    fn entry_from_path(&self, path: PathBuf) -> io::Result<FileEntry> {
        self.ensure_allowed_path(&path.canonicalize()?)?;
        let metadata = fs::metadata(&path)?;
        Ok(FileEntry {
            name: path
                .file_name()
                .unwrap_or_else(|| OsStr::new("/"))
                .to_string_lossy()
                .into_owned(),
            path: self.display_path(&path)?,
            kind: file_kind(&path, metadata.is_dir()),
            hidden: is_hidden(&path, &metadata),
            size: metadata.is_file().then_some(metadata.len()),
            modified: metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                .map(|value| value.as_secs()),
        })
    }

    fn resolve_existing(&self, path: impl AsRef<Path>) -> io::Result<PathBuf> {
        let candidate = self.resolve_requested_path(path)?;
        let canonical = candidate.canonicalize()?;
        self.ensure_allowed_path(&canonical)?;
        Ok(canonical)
    }

    fn resolve_new(&self, path: impl AsRef<Path>) -> io::Result<PathBuf> {
        let candidate = self.resolve_requested_path(path)?;
        if candidate.exists() {
            return Err(io::Error::new(
                ErrorKind::AlreadyExists,
                "destination already exists",
            ));
        }
        let parent = candidate
            .parent()
            .ok_or_else(|| io::Error::new(ErrorKind::InvalidInput, "path has no parent"))?
            .canonicalize()?;
        self.ensure_allowed_path(&parent)?;
        Ok(candidate)
    }

    fn resolve_requested_path(&self, path: impl AsRef<Path>) -> io::Result<PathBuf> {
        let path = path.as_ref();
        let normalized = normalize_request_path(path);
        if let Some(volume) = self.volume_for_request(&normalized) {
            let suffix = normalized[volume.id.len()..].trim_matches('/');
            let mut candidate = volume.path.clone();
            for segment in suffix.split('/').filter(|segment| !segment.is_empty()) {
                if segment == TRASH_DIRECTORY {
                    return Err(io::Error::new(
                        ErrorKind::PermissionDenied,
                        "the trash is reached only through its own functions",
                    ));
                }
                if segment == "." || segment == ".." {
                    return Err(io::Error::new(
                        ErrorKind::PermissionDenied,
                        "path must stay inside the selected volume",
                    ));
                }
                candidate.push(segment);
            }
            return Ok(candidate);
        }
        if self.nas_mode || !self.volumes.is_empty() {
            return Err(io::Error::new(
                ErrorKind::PermissionDenied,
                "a connected volume must be selected",
            ));
        }
        self.join_relative(path)
    }

    fn join_relative(&self, path: impl AsRef<Path>) -> io::Result<PathBuf> {
        let path = path.as_ref();
        if path.is_absolute()
            || path.components().any(|component| {
                matches!(
                    component,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
        {
            return Err(io::Error::new(
                ErrorKind::PermissionDenied,
                "path must stay inside the configured root",
            ));
        }
        if path
            .components()
            .next()
            .is_some_and(|component| component.as_os_str() == OsStr::new(CACHE_DIRECTORY))
        {
            return Err(io::Error::new(
                ErrorKind::PermissionDenied,
                "the internal preview cache cannot be accessed",
            ));
        }
        if path
            .components()
            .any(|component| component.as_os_str() == OsStr::new(TRASH_DIRECTORY))
        {
            return Err(io::Error::new(
                ErrorKind::PermissionDenied,
                "the trash is reached only through its own functions",
            ));
        }
        Ok(self.root.join(path))
    }

    fn volume_for_request(&self, path: &str) -> Option<&Volume> {
        self.volumes
            .iter()
            .find(|volume| path == volume.id || path.starts_with(&format!("{}/", volume.id)))
    }

    fn display_path(&self, path: &Path) -> io::Result<String> {
        if let Some(volume) = self.volume_for_path(path) {
            let relative = path
                .strip_prefix(&volume.path)
                .map_err(|_| io::Error::new(ErrorKind::PermissionDenied, "invalid volume path"))?;
            let suffix = relative.to_string_lossy().replace('\\', "/");
            if suffix.is_empty() {
                return Ok(volume.id.clone());
            }
            return Ok(format!("{}/{}", volume.id, suffix));
        }
        let relative = path.strip_prefix(&self.root).map_err(|_| {
            io::Error::new(
                ErrorKind::PermissionDenied,
                "path is outside the configured root",
            )
        })?;
        Ok(relative.to_string_lossy().replace('\\', "/"))
    }

    fn volume_for_path(&self, path: &Path) -> Option<&Volume> {
        self.volumes
            .iter()
            .find(|volume| path.starts_with(&volume.path))
    }

    fn volume_entries(&self) -> Vec<FileEntry> {
        self.volumes
            .iter()
            .map(|volume| FileEntry {
                name: volume.name.clone(),
                path: volume.id.clone(),
                kind: FileKind::Folder,
                hidden: false,
                size: None,
                modified: None,
            })
            .collect()
    }

    fn cached_poster(
        &self,
        source: &Path,
        kind: FileKind,
        size: PreviewSize,
    ) -> io::Result<Preview> {
        let base = self.preview_base(source, &kind, size)?;
        let label = source.file_name().and_then(OsStr::to_str).unwrap_or("File");
        self.store_preview(
            base.with_extension("svg"),
            poster_svg(label, &kind).into_bytes(),
            "svg",
        )
    }

    /// Where the preview of a file is kept, without its extension. The name is a hash of what makes
    /// the preview: the format of the cache, the path inside the roots, the size and time of the
    /// file, its kind and the size asked for. A file that changes gets a new name, and the old
    /// preview goes when the cache is full.
    fn preview_base(&self, path: &Path, kind: &FileKind, size: PreviewSize) -> io::Result<PathBuf> {
        let metadata = fs::metadata(path)?;
        let modified = metadata
            .modified()?
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let relative = path.strip_prefix(&self.root).unwrap_or(path);
        let key = fnv1a(&[
            PREVIEW_FORMAT.as_bytes(),
            relative.to_string_lossy().as_bytes(),
            &metadata.len().to_le_bytes(),
            &modified.to_le_bytes(),
            format!("{kind:?}").as_bytes(),
            size.id().as_bytes(),
        ]);
        Ok(self
            .preview_cache_directory()
            .join(format!("{key:016x}-{}", size.id())))
    }

    fn preview_cache_directory(&self) -> PathBuf {
        self.cache_root.join(PREVIEW_DIRECTORY)
    }

    fn store_preview(&self, path: PathBuf, bytes: Vec<u8>, extension: &str) -> io::Result<Preview> {
        fs::create_dir_all(self.preview_cache_directory())?;
        // Written aside and renamed: a preview read at the same time is never half written.
        let partial = path.with_extension("partial");
        fs::write(&partial, &bytes)?;
        fs::rename(&partial, &path)?;
        self.preview_cache_usage()?;
        let over = {
            let mut used = self.lock_previews();
            let total = used.unwrap_or(0) + bytes.len() as u64;
            *used = Some(total);
            total > self.preview_cache_limit()
        };
        if over {
            self.prune_preview_cache()?;
        }
        Ok(Preview {
            bytes,
            content_type: content_type(extension).to_string(),
            cache_hit: false,
        })
    }

    /// Over the limit, the previews read least recently go until nine tenths of it are left:
    /// the next ones fit without pruning again at once.
    fn prune_preview_cache(&self) -> io::Result<()> {
        let mut used = self.lock_previews();
        let mut files = self.preview_files()?;
        files.sort_by_key(|(read, _, _)| *read);
        let mut total: u64 = files.iter().map(|(_, size, _)| size).sum();
        let target = self.preview_cache_limit() / 10 * 9;
        for (_, size, path) in files {
            if total <= target {
                break;
            }
            if fs::remove_file(path).is_ok() {
                total = total.saturating_sub(size);
            }
        }
        *used = Some(total);
        Ok(())
    }

    fn ensure_allowed_path(&self, path: &Path) -> io::Result<()> {
        if self.volume_for_path(path).is_some() || (!self.nas_mode && path.starts_with(&self.root))
        {
            return Ok(());
        }
        Err(io::Error::new(
            ErrorKind::PermissionDenied,
            "path is outside the configured filesystem roots",
        ))
    }

    fn ensure_not_root(&self, path: &Path) -> io::Result<()> {
        if path == self.root || self.volumes.iter().any(|volume| path == volume.path) {
            Err(io::Error::new(
                ErrorKind::PermissionDenied,
                "the configured root cannot be modified",
            ))
        } else {
            Ok(())
        }
    }
}

fn normalize_request_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .trim_matches('/')
        .to_string()
}

#[cfg(target_os = "linux")]
fn active_mounts() -> io::Result<Vec<(PathBuf, String)>> {
    let content = fs::read_to_string("/proc/self/mountinfo")?;
    Ok(content
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let id = fields.next()?;
            let path = fields.nth(3)?;
            Some((PathBuf::from(path), id.to_owned()))
        })
        .collect())
}

#[cfg(not(target_os = "linux"))]
fn active_mounts() -> io::Result<Vec<(PathBuf, String)>> {
    Err(io::Error::new(
        ErrorKind::Unsupported,
        "NAS mounts require Linux",
    ))
}

fn is_empty_request_path(path: &Path) -> bool {
    normalize_request_path(path).is_empty()
}

fn is_hidden(path: &Path, metadata: &fs::Metadata) -> bool {
    if path
        .file_name()
        .map(|name| name.to_string_lossy().starts_with('.'))
        .unwrap_or(false)
    {
        return true;
    }

    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;

        return metadata.file_attributes() & 0x2 != 0;
    }

    #[cfg(not(windows))]
    {
        let _ = metadata;
        false
    }
}

/// A hash of the parts, FNV-1a on 64 bits: the same on every build, unlike the hasher of the
/// standard library, so an update of the compiler does not throw the previews away.
fn fnv1a(parts: &[&[u8]]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for part in parts {
        for byte in part.iter().chain(&[0xff]) {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    hash
}

fn is_svg(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("svg"))
}

/// The image reduced to fit the size, turned as the camera said (EXIF orientation): a JPEG, or a
/// PNG when some of it is transparent.
fn image_thumbnail(path: &Path, size: PreviewSize) -> io::Result<(Vec<u8>, &'static str)> {
    let failed = |error: image::ImageError| io::Error::other(error.to_string());
    let mut decoder = ImageReader::open(path)?
        .with_guessed_format()?
        .into_decoder()
        .map_err(failed)?;
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let mut image = DynamicImage::from_decoder(decoder).map_err(failed)?;
    image.apply_orientation(orientation);
    let (width, height) = size.bounds();
    // Only made smaller: an image that fits already is not enlarged.
    let thumbnail = if image.width() <= width && image.height() <= height {
        image
    } else {
        image.thumbnail(width, height)
    };
    let mut bytes = Cursor::new(Vec::new());
    let transparent = thumbnail.color().has_alpha()
        && thumbnail
            .to_rgba8()
            .pixels()
            .any(|pixel| pixel[3] < u8::MAX);
    if transparent {
        thumbnail
            .write_to(&mut bytes, ImageFormat::Png)
            .map_err(failed)?;
        return Ok((bytes.into_inner(), "png"));
    }
    JpegEncoder::new_with_quality(&mut bytes, PREVIEW_JPEG_QUALITY)
        .encode_image(&thumbnail.to_rgb8())
        .map_err(failed)?;
    Ok((bytes.into_inner(), "jpg"))
}

fn is_supported_archive(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(OsStr::to_str)
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "zip" | "7z" | "rar"
    )
}

fn list_zip_archive(path: &Path, password: Option<&str>) -> io::Result<Vec<FileEntry>> {
    let file = fs::File::open(path)?;
    let mut archive = ZipArchive::new(file).map_err(archive_error)?;
    let mut entries = Vec::with_capacity(archive.len());

    for index in 0..archive.len() {
        let entry = match password {
            Some(password) => archive
                .by_index_decrypt(index, password.as_bytes())
                .map_err(archive_error)?,
            None => archive.by_index(index).map_err(archive_error)?,
        };
        append_archive_entry(
            &mut entries,
            entry.name(),
            entry.is_dir(),
            Some(entry.size()),
        );
    }

    Ok(entries)
}

fn list_seven_zip_archive(path: &Path, password: Option<&str>) -> io::Result<Vec<FileEntry>> {
    let archive = match password {
        Some(password) => {
            let password = Password::from(password);
            Archive::open_with_password(path, &password)
        }
        None => Archive::open(path),
    }
    .map_err(archive_error)?;
    let mut entries = Vec::with_capacity(archive.files.len());

    for entry in archive.files {
        append_archive_entry(
            &mut entries,
            entry.name(),
            entry.is_directory,
            Some(entry.size),
        );
    }

    Ok(entries)
}

fn list_rar_archive(path: &Path, password: Option<&str>) -> io::Result<Vec<FileEntry>> {
    let password = password.map(str::as_bytes);
    let options = ArchiveReadOptions::with_optional_password(password);
    let archive = ArchiveReader::read_path_with_options(path, options).map_err(archive_error)?;
    let mut entries = Vec::new();

    for entry in archive.members() {
        append_archive_entry(
            &mut entries,
            &entry.meta.name_lossy(),
            entry.meta.is_directory,
            Some(entry.meta.unpacked_size),
        );
    }

    Ok(entries)
}

fn append_archive_entry(
    entries: &mut Vec<FileEntry>,
    raw_path: &str,
    is_directory: bool,
    size: Option<u64>,
) {
    let Some(path) = sanitize_archive_path(raw_path) else {
        return;
    };
    let name = path.rsplit('/').next().unwrap_or(&path).to_string();
    entries.push(FileEntry {
        name,
        path: path.clone(),
        kind: file_kind(Path::new(&path), is_directory),
        hidden: path
            .split('/')
            .next_back()
            .is_some_and(|value| value.starts_with('.')),
        size: if is_directory { None } else { size },
        modified: None,
    });
}

fn archive_error(error: impl ToString) -> io::Error {
    io::Error::new(ErrorKind::InvalidData, error.to_string())
}

fn sanitize_archive_path(path: &str) -> Option<String> {
    let normalized = path.replace('\\', "/");
    if normalized.starts_with('/') || normalized.starts_with("//") {
        return None;
    }
    let components = normalized
        .split('/')
        .filter(|component| !component.is_empty());
    let mut safe_components = Vec::new();
    for component in components {
        if component == "." || component == ".." || component.contains(':') {
            return None;
        }
        safe_components.push(component);
    }
    if safe_components.is_empty() {
        return None;
    }
    Some(safe_components.join("/"))
}

fn svg_preview(path: &Path) -> io::Result<Vec<u8>> {
    // A drawing larger than this is no preview: it gets the poster of its kind.
    if fs::metadata(path)?.len() > MAX_SVG_PREVIEW_BYTES {
        return Err(io::Error::new(
            ErrorKind::InvalidData,
            "SVG document too large for a preview",
        ));
    }
    let bytes = fs::read(path)?;
    let source = std::str::from_utf8(&bytes)
        .map_err(|error| io::Error::new(ErrorKind::InvalidData, error.to_string()))?;
    if !source.contains("<svg") {
        return Err(io::Error::new(
            ErrorKind::InvalidData,
            "file does not contain an SVG document",
        ));
    }
    Ok(bytes)
}

fn content_type(extension: &str) -> &'static str {
    match extension {
        "png" => "image/png",
        "jpg" => "image/jpeg",
        _ => "image/svg+xml",
    }
}

fn poster_svg(label: &str, kind: &FileKind) -> String {
    let (symbol, color) = match kind {
        FileKind::Archive => ("ARCHIVE", "#a67c52"),
        FileKind::Document => ("DOCUMENT", "#22a7f0"),
        FileKind::Folder => ("FOLDER", "#4da3ff"),
        FileKind::Video => ("VIDEO", "#7357e8"),
        _ => ("FILE", "#718096"),
    };
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"640\" height=\"400\" viewBox=\"0 0 640 400\"><rect width=\"640\" height=\"400\" rx=\"28\" fill=\"#111827\"/><rect x=\"72\" y=\"76\" width=\"496\" height=\"248\" rx=\"20\" fill=\"{color}\" opacity=\".2\"/><text x=\"320\" y=\"190\" text-anchor=\"middle\" fill=\"{color}\" font-family=\"Arial, sans-serif\" font-size=\"34\" font-weight=\"700\">{symbol}</text><text x=\"320\" y=\"246\" text-anchor=\"middle\" fill=\"#f8fafc\" font-family=\"Arial, sans-serif\" font-size=\"24\">{}</text></svg>",
        escape_xml(label)
    )
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('\"', "&quot;")
        .replace('\'', "&apos;")
}

fn validate_name(name: &str) -> io::Result<()> {
    let path = Path::new(name);
    if name.is_empty()
        || path.components().count() != 1
        || !matches!(path.components().next(), Some(Component::Normal(_)))
    {
        return Err(io::Error::new(
            ErrorKind::InvalidInput,
            "name must be a single path segment",
        ));
    }
    Ok(())
}

fn file_kind(path: &Path, is_directory: bool) -> FileKind {
    if is_directory {
        return FileKind::Folder;
    }
    let extension = path
        .extension()
        .and_then(OsStr::to_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" => FileKind::Image,
        "mp4" | "webm" | "mkv" | "mov" | "avi" => FileKind::Video,
        "pdf" | "md" | "txt" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" => {
            FileKind::Document
        }
        "zip" | "rar" | "7z" | "tar" | "gz" => FileKind::Archive,
        _ => FileKind::File,
    }
}

/// Moves to another file system: a copy, then the original goes. A copy that fails leaves the
/// original where it was and takes back what it had written.
fn move_across_devices(source: &Path, destination: &Path) -> io::Result<()> {
    let copied = if source.is_dir() {
        copy_directory(source, destination)
    } else {
        fs::copy(source, destination).map(|_| ())
    };
    if let Err(error) = copied {
        let _ = if destination.is_dir() {
            fs::remove_dir_all(destination)
        } else {
            fs::remove_file(destination)
        };
        return Err(error);
    }
    if source.is_dir() {
        fs::remove_dir_all(source)
    } else {
        fs::remove_file(source)
    }
}

fn copy_directory(source: &Path, destination: &Path) -> io::Result<()> {
    fs::create_dir(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let target = destination.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_directory(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

#[cfg(windows)]
fn storage_info_for_path(path: &Path) -> io::Result<StorageInfo> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetDiskFreeSpaceExW(
            directory_name: *const u16,
            available_bytes: *mut u64,
            total_bytes: *mut u64,
            total_free_bytes: *mut u64,
        ) -> i32;
    }

    let mut directory_name = path.as_os_str().encode_wide().collect::<Vec<_>>();
    directory_name.push(0);
    let mut available_bytes = 0;
    let mut total_bytes = 0;
    let result = unsafe {
        GetDiskFreeSpaceExW(
            directory_name.as_ptr(),
            &mut available_bytes,
            &mut total_bytes,
            std::ptr::null_mut(),
        )
    };
    if result == 0 {
        return Err(io::Error::last_os_error());
    }

    Ok(StorageInfo {
        available_bytes,
        total_bytes,
        used_bytes: total_bytes.saturating_sub(available_bytes),
    })
}

#[cfg(unix)]
fn storage_info_for_path(path: &Path) -> io::Result<StorageInfo> {
    let output = std::process::Command::new("df")
        .args(["-Pk"])
        .arg(path)
        .output()?;
    if !output.status.success() {
        return Err(io::Error::other(
            "unable to read filesystem storage information",
        ));
    }

    let storage_output = String::from_utf8_lossy(&output.stdout);
    let line = storage_output
        .lines()
        .nth(1)
        .ok_or_else(|| io::Error::other("invalid filesystem storage information"))?;
    let columns = line.split_whitespace().collect::<Vec<_>>();
    let total_blocks = columns
        .get(1)
        .ok_or_else(|| io::Error::other("invalid filesystem storage total"))?
        .parse::<u64>()
        .map_err(|_| io::Error::other("invalid filesystem storage total"))?;
    let available_blocks = columns
        .get(3)
        .ok_or_else(|| io::Error::other("invalid filesystem storage available"))?
        .parse::<u64>()
        .map_err(|_| io::Error::other("invalid filesystem storage available"))?;
    let total_bytes = total_blocks
        .checked_mul(1024)
        .ok_or_else(|| io::Error::other("filesystem storage total is too large"))?;
    let available_bytes = available_blocks
        .checked_mul(1024)
        .ok_or_else(|| io::Error::other("filesystem storage available is too large"))?;

    Ok(StorageInfo {
        available_bytes,
        total_bytes,
        used_bytes: total_bytes.saturating_sub(available_bytes),
    })
}

#[cfg(not(any(windows, unix)))]
fn storage_info_for_path(_path: &Path) -> io::Result<StorageInfo> {
    Err(io::Error::other(
        "filesystem storage information is not supported on this platform",
    ))
}

#[cfg(test)]
#[path = "../../tests/unit/core/lib.rs"]
mod tests;
