//! The trash of the Explorer: one for each disk, `.nas-trash` at its root, with the tree of the
//! folders the files came from and one version for each path (a new one replaces the one already
//! there). Moving into it is a rename on the same disk, instant for any size. The Explorer, its
//! search and its index never show it; it is read only through the functions below.
//!
//! A file's change time (ctime) records its rename by Samba or the sync. Explorer records the
//! time separately, including every descendant of a deleted directory. Parent ctime cannot date
//! a file: later deletions into the same directory would reset its age. The disks that keep no reliable ctime (exFAT, NTFS) are told apart, so the caller
//! keeps the date itself.

use super::*;
use std::os::unix::fs::{MetadataExt, PermissionsExt};

pub const TRASH_DIRECTORY: &str = ".nas-trash";
/// The file at the root of a disk that says its trash is off, for the other applications that
/// move what they delete there (the sync): with it they delete for good.
pub const TRASH_OFF: &str = ".nas-trash-off";
/// The filesystems whose ctime says when a rename happened.
const RELIABLE: [&str; 8] = [
    "ext2", "ext3", "ext4", "xfs", "btrfs", "f2fs", "zfs", "tmpfs",
];

/// One entry of the trash, by the path it had: a folder holds more of them.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    pub name: String,
    /// Where it was, as the Explorer shows paths: where it goes back.
    pub path: String,
    pub kind: FileKind,
    pub size: u64,
    /// Seconds since 1970.
    pub deleted_at: u64,
}

/// The trash of one disk.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrashDisk {
    pub id: String,
    pub name: String,
    pub bytes: u64,
    pub items: u64,
}

/// A file or empty directory of the trash, for its expiry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrashFile {
    pub path: PathBuf,
    /// When it went in, as the disk says it; none when the disk cannot say.
    pub deleted_at: Option<u64>,
}

fn changed_at(metadata: &fs::Metadata) -> u64 {
    u64::try_from(metadata.ctime()).unwrap_or_default()
}

fn size_of(path: &Path) -> u64 {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return 0;
    };
    if !metadata.is_dir() {
        return metadata.len();
    }
    fs::read_dir(path)
        .map(|entries| entries.flatten().map(|entry| size_of(&entry.path())).sum())
        .unwrap_or_default()
}

/// The type of the filesystem a path is on, from the mounts of the process.
fn filesystem_type(path: &Path) -> Option<String> {
    let mounts = fs::read_to_string("/proc/self/mounts").ok()?;
    mounts
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let (_, point, kind) = (fields.next()?, fields.next()?, fields.next()?);
            let point = PathBuf::from(point.replace("\\040", " "));
            path.starts_with(&point).then(|| (point, kind.to_owned()))
        })
        .max_by_key(|(point, _)| point.components().count())
        .map(|(_, kind)| kind)
}

/// Refuses symbolic links in directory paths and gives new shared directories group access.
/// The volume root is trusted; components beneath it must be directories within that volume.
fn checked_directories(base: &Path, path: &Path, create: bool) -> io::Result<()> {
    let relative = path
        .strip_prefix(base)
        .map_err(|_| io::Error::new(ErrorKind::PermissionDenied, "not on the selected disk"))?;
    let mut current = base.to_path_buf();
    for component in relative.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err(io::Error::new(
                ErrorKind::PermissionDenied,
                "invalid trash path",
            ));
        }
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if !metadata.is_dir() || metadata.file_type().is_symlink() => {
                return Err(io::Error::new(
                    ErrorKind::PermissionDenied,
                    "a trash directory is a link or file",
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {
                if create {
                    fs::create_dir(&current)?;
                    fs::set_permissions(&current, fs::Permissions::from_mode(0o2770))?;
                }
            }
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

impl Filesystem {
    pub fn set_trash(&self, enabled: bool) {
        self.trash.store(enabled, Ordering::Relaxed);
    }

    pub fn trash_enabled(&self) -> bool {
        self.trash.load(Ordering::Relaxed)
    }

    /// Says on every disk whether its trash is on: `.nas-trash-off` at its root while it is off.
    /// A disk that cannot be written keeps what it had.
    pub fn mark_trash(&self) {
        for (_, _, base) in self.trash_bases() {
            let marker = base.join(TRASH_OFF);
            let _ = if self.trash_enabled() {
                fs::remove_file(&marker)
            } else {
                fs::write(&marker, "")
            };
        }
    }

    /// The disks that have a trash: id, name and the folder at their root.
    fn trash_bases(&self) -> Vec<(String, String, PathBuf)> {
        if self.volumes.is_empty() && !self.nas_mode {
            return vec![(String::new(), String::new(), self.root.clone())];
        }
        self.volumes
            .iter()
            .map(|volume| (volume.id.clone(), volume.name.clone(), volume.path.clone()))
            .collect()
    }

    /// The disk a path is on, by its id and root.
    fn trash_base(&self, real: &Path) -> Option<(String, PathBuf)> {
        self.trash_bases()
            .into_iter()
            .find(|(_, _, base)| real.starts_with(base))
            .map(|(id, _, base)| (id, base))
    }

    /// The path the Explorer shows for a path of a disk.
    fn shown(&self, id: &str, relative: &Path) -> String {
        let relative = relative.to_string_lossy().replace('\\', "/");
        match (id.is_empty(), relative.is_empty()) {
            (true, _) => relative,
            (false, true) => id.to_owned(),
            (false, false) => format!("{id}/{relative}"),
        }
    }

    /// Moves a file or a folder into the trash of its disk, in place of what had its path there.
    pub fn move_to_trash(&self, real: &Path) -> io::Result<PathBuf> {
        let (_, base) = self
            .trash_base(real)
            .ok_or_else(|| io::Error::new(ErrorKind::PermissionDenied, "not on a disk"))?;
        let relative = real
            .strip_prefix(&base)
            .map_err(|_| io::Error::new(ErrorKind::PermissionDenied, "not on a disk"))?;
        let trash = base.join(TRASH_DIRECTORY);
        checked_directories(&base, &trash, true)?;
        let target = trash.join(relative);
        if let Some(parent) = target.parent() {
            checked_directories(&base, parent, true)?;
        }
        match fs::symlink_metadata(&target) {
            Ok(metadata) if metadata.is_dir() => fs::remove_dir_all(&target)?,
            Ok(_) => fs::remove_file(&target)?,
            Err(_) => {}
        }
        match fs::rename(real, &target) {
            Err(error) if error.kind() == ErrorKind::CrossesDevices => {
                move_across_devices(real, &target)?;
            }
            moved => moved?,
        }
        Ok(target)
    }

    /// Where a path of the Explorer sits in the trash, and where it goes back.
    pub fn trash_location(&self, path: impl AsRef<Path>) -> io::Result<(PathBuf, PathBuf)> {
        let original = self.resolve_requested_path(path)?;
        let (_, base) = self
            .trash_base(&original)
            .ok_or_else(|| io::Error::new(ErrorKind::PermissionDenied, "not on a disk"))?;
        let relative = original
            .strip_prefix(&base)
            .map_err(|_| io::Error::new(ErrorKind::PermissionDenied, "not on a disk"))?;
        let inside = base.join(TRASH_DIRECTORY).join(relative);
        checked_directories(&base, &base.join(TRASH_DIRECTORY), false)?;
        if let Some(parent) = inside.parent().filter(|_| !relative.as_os_str().is_empty()) {
            checked_directories(&base, parent, false)?;
        }
        if let Some(parent) = original
            .parent()
            .filter(|_| !relative.as_os_str().is_empty())
        {
            checked_directories(&base, parent, false)?;
        }
        Ok((inside, original))
    }

    /// When this entry changed; sibling deletions must not reset its age.
    fn deleted_at(&self, real: &Path) -> u64 {
        fs::symlink_metadata(real)
            .map(|metadata| changed_at(&metadata))
            .unwrap_or_default()
    }

    /// The disks with their trash, how much it holds and how many things.
    pub fn trash_disks(&self) -> Vec<TrashDisk> {
        self.trash_bases()
            .into_iter()
            .map(|(id, name, base)| {
                let trash = base.join(TRASH_DIRECTORY);
                let safe = checked_directories(&base, &trash, false).is_ok();
                let items = safe
                    .then(|| fs::read_dir(&trash))
                    .transpose()
                    .ok()
                    .flatten()
                    .map(|entries| entries.flatten().count() as u64)
                    .unwrap_or_default();
                TrashDisk {
                    id,
                    name,
                    bytes: if safe { size_of(&trash) } else { 0 },
                    items,
                }
            })
            .collect()
    }

    /// What the trash holds under a folder, by the path it had: a disk is its own top.
    pub fn trash_list(&self, path: impl AsRef<Path>) -> io::Result<Vec<TrashEntry>> {
        let (folder, original) = self.trash_location(path)?;
        let (id, base) = self
            .trash_base(&original)
            .ok_or_else(|| io::Error::new(ErrorKind::PermissionDenied, "not on a disk"))?;
        let trash = base.join(TRASH_DIRECTORY);
        checked_directories(&base, &folder, false)?;
        let entries = match fs::read_dir(&folder) {
            Ok(entries) => entries,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error),
        };
        let mut listed: Vec<TrashEntry> = entries
            .flatten()
            .filter_map(|entry| {
                let real = entry.path();
                let metadata = fs::symlink_metadata(&real).ok()?;
                let relative = real.strip_prefix(&trash).ok()?;
                Some(TrashEntry {
                    name: entry.file_name().to_string_lossy().into_owned(),
                    path: self.shown(&id, relative),
                    kind: file_kind(&real, metadata.is_dir()),
                    size: size_of(&real),
                    deleted_at: self.deleted_at(&real),
                })
            })
            .collect();
        listed.sort_by(|left, right| {
            (left.kind != FileKind::Folder)
                .cmp(&(right.kind != FileKind::Folder))
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        });
        Ok(listed)
    }

    /// Puts an entry back where it was; one already there stays unless `replace`.
    pub fn restore(&self, path: impl AsRef<Path>, replace: bool) -> io::Result<FileEntry> {
        let (inside, original) = self.trash_location(path)?;
        self.require_trash_entry(&inside)?;
        fs::symlink_metadata(&inside)?;
        if let Ok(existing) = fs::symlink_metadata(&original) {
            if !replace {
                return Err(io::Error::new(
                    ErrorKind::AlreadyExists,
                    "destination already exists",
                ));
            }
            if existing.is_dir() {
                fs::remove_dir_all(&original)?;
            } else {
                fs::remove_file(&original)?;
            }
        }
        if let Some(parent) = original.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(&inside, &original)?;
        self.prune_trash(&inside);
        self.entry_from_path(original)
    }

    /// Deletes an entry of the trash for good.
    pub fn purge(&self, path: impl AsRef<Path>) -> io::Result<()> {
        let (inside, _) = self.trash_location(path)?;
        self.require_trash_entry(&inside)?;
        let metadata = fs::symlink_metadata(&inside)?;
        if metadata.is_dir() {
            fs::remove_dir_all(&inside)?;
        } else {
            fs::remove_file(&inside)?;
        }
        self.prune_trash(&inside);
        Ok(())
    }

    /// Empties the trash of a disk, or of every disk.
    pub fn empty_trash(&self, disk: Option<&str>) -> io::Result<()> {
        for (id, _, base) in self.trash_bases() {
            if disk.is_some_and(|disk| disk != id) {
                continue;
            }
            let trash = base.join(TRASH_DIRECTORY);
            checked_directories(&base, &trash, false)?;
            let entries = match fs::read_dir(&trash) {
                Ok(entries) => entries,
                Err(error) if error.kind() == ErrorKind::NotFound => continue,
                Err(error) => return Err(error),
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                    fs::remove_dir_all(path)?;
                } else {
                    fs::remove_file(path)?;
                }
            }
        }
        Ok(())
    }

    /// Every file of every trash, with the time it went in when the disk can say it.
    pub fn trash_files(&self) -> Vec<TrashFile> {
        let mut files = Vec::new();
        for (_, _, base) in self.trash_bases() {
            let trash = base.join(TRASH_DIRECTORY);
            if checked_directories(&base, &trash, false).is_err() {
                continue;
            }
            let reliable =
                filesystem_type(&trash).is_some_and(|kind| RELIABLE.contains(&kind.as_str()));
            let mut folders = vec![trash.clone()];
            while let Some(folder) = folders.pop() {
                let Ok(entries) = fs::read_dir(&folder) else {
                    continue;
                };
                for entry in entries.flatten() {
                    let path = entry.path();
                    if entry.file_type().is_ok_and(|kind| kind.is_dir())
                        && !fs::read_dir(&path).is_ok_and(|mut entries| entries.next().is_none())
                    {
                        folders.push(path);
                        continue;
                    }
                    let deleted_at = reliable.then(|| self.deleted_at(&path));
                    files.push(TrashFile { path, deleted_at });
                }
            }
        }
        files.sort_by(|left, right| left.path.cmp(&right.path));
        files
    }

    /// Removes an expired file of the trash, and the folders it leaves empty.
    pub fn expire(&self, path: &Path) -> io::Result<()> {
        let base = self
            .trash_bases()
            .into_iter()
            .map(|(_, _, base)| base)
            .find(|base| path.starts_with(base.join(TRASH_DIRECTORY)))
            .ok_or_else(|| io::Error::new(ErrorKind::PermissionDenied, "not in a granted trash"))?;
        self.require_trash_entry(path)?;
        checked_directories(
            &base,
            path.parent().ok_or_else(|| io::Error::other("no parent"))?,
            false,
        )?;
        let removed = match fs::symlink_metadata(path) {
            Ok(metadata) if metadata.is_dir() => fs::remove_dir(path),
            Ok(_) => fs::remove_file(path),
            Err(error) => Err(error),
        };
        match removed {
            Err(error) if error.kind() != ErrorKind::NotFound => return Err(error),
            _ => {}
        }
        self.prune_trash(path);
        Ok(())
    }

    fn require_trash_entry(&self, path: &Path) -> io::Result<()> {
        if self
            .trash_bases()
            .iter()
            .any(|(_, _, base)| path == base.join(TRASH_DIRECTORY))
        {
            return Err(io::Error::new(
                ErrorKind::PermissionDenied,
                "the trash root is not an entry",
            ));
        }
        Ok(())
    }

    /// Removes the empty folders above a path of the trash, the trash itself kept.
    fn prune_trash(&self, path: &Path) {
        for folder in path.ancestors().skip(1) {
            if folder.file_name() == Some(OsStr::new(TRASH_DIRECTORY))
                || fs::remove_dir(folder).is_err()
            {
                break;
            }
        }
    }
}

#[cfg(test)]
#[path = "../../tests/unit/core/trash.rs"]
mod tests;
