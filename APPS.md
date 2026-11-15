# Contract of nas-file-manager with the NAS launcher

The contract every application shares with the launcher (package, manifest, permissions, frame
protocol, launcher socket and providers) is `docs/development/external_apps/APPS.md` in the
nas-launcher repository, and the bridge is the one of `@valeriogc/nas-base-app`. This file keeps
only what is specific to nas-file-manager, which builds and releases on its own.

## Identity

- id `nas-file-manager`, category `storage`, system application
- permissions `paths` ["/srv/storage"], `packages` ["samba"], `shares` true
- provides `search` at `/api/launcher/search`, `file-picker` at `/`, `cache` at `/internal/cache`, `trash` at `/internal/trash`

## Specific to this application

nas-file-manager is a web application only. Its NAS backend reads `NAS_STORAGE_ROOT` and `NAS_STORAGE_REGISTRY` (set on the NAS by the launcher's grant of `/srv/storage`; `FS_EXPLORER_ROOT` and `FS_EXPLORER_REGISTRY` in development), uses `STATE_DIRECTORY` for preview cache when present, and provides `/api/launcher/search`. The registry is published by the privileged storage reconciler and contains only the wizard user's mounted directories; an empty registry exposes no host path. Its manifest requests `/srv/storage`, sets `run.background` (the search index follows the disks with the window closed) and declares `search`, `file-picker` `cache` (`/internal/cache`: `previews` and `search-index`, for the launcher only) and `trash` (`/internal/trash`: `{ label, bytes, items }`, `DELETE` empties every trash) capabilities; no other app declares a file capability.

nas-file-manager also declares `permissions.shares: true` and `permissions.packages: ["samba"]`: the launcher installs Samba with it, keeps it off while nothing is shared, and takes the list of the shared folders on its socket (`GET`/`PUT /api/apps/self/shares`), as described in its own `APPS.md`.

nas-file-manager alone may request a folder shortcut:

```ts
{ nas: 1, type: 'shortcut', requestId: string, path: string, name: string }
{ nas: 1, type: 'shortcut-result', requestId: string, success: boolean, error?: string }
```

The launcher derives the sender from its registered frame and persists the shortcut before returning success. The folder path is logical relative to Explorer's configured root. The external page never writes the launcher's desktop API directly. The launcher stores shortcuts of kind `app` or `folder`, opens folders in `nas-file-manager` with `?path=...`, and keeps shortcuts when Explorer is uninstalled so they work again after reinstalling it.

Explorer keeps `/api/search?query=` for its own UI. Both answer from the search index of the disks (`backend/src/search.rs`) once it is whole, reading each result again from the disk for its size and time; network shares, and a disk still being indexed, are walked as before. The launcher uses the manifest endpoint `/api/launcher/search` with `q`, optional `type`, and optional `ext`. The response is an array of `{ id, name, path, type, extension, size, modified, target }`. Types are `folder`, `document`, `image`, `audio`, `video`, and `archive`. `path` is a logical path such as `/Documents/report.pdf`; `target` is an encoded query such as `?path=%2FDocuments&select=report.pdf`. Explorer maps the query to its filesystem view, while the launcher assigns the provider app ID. The launcher can start a stopped provider through the existing app lifecycle before retrying its query. Missing metadata uses an empty `modified` string and numeric size zero.

The commands that check the repository are in [DEVELOPMENT.md](DEVELOPMENT.md).
