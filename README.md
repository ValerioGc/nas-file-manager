# nas-file-manager

External application for the NAS launcher: it browses files and folders, searches, manages files and creates shortcuts to folders on the NAS desktop. Every repository stands on its own and produces an archive the launcher can install.

## Local start

Requires Node.js 24, npm and Rust/Cargo.

```bash
pnpm install
pnpm run build
pnpm run backend:dev
```

In a second terminal:

```bash
pnpm run dev
```

Vite serves the UI on `http://127.0.0.1:1420/` and forwards `api/...` to the backend over a Unix socket. `NAS_APP_SOCKET` changes the path of the socket. The main APIs are GET `api/files`, GET `api/search`, GET `api/launcher/search` and the file operations of the Explorer backend.

Explorer is a web application only, with one interface for every screen: on a phone the side menu comes in from the left with the button of the header, a tap opens folders and archives, and the details of a file, in a window, carry its actions. Settings and favourites are kept by the backend, in a SQLite database of the app (never the launcher's): they apply to every browser that opens the NAS. The database uses `NAS_DB_PATH` when set, otherwise `$STATE_DIRECTORY/file-manager.sqlite3`; in development it is created in `backend/data/`. Only the language and the open or closed side panels stay in the browser. In development, `FS_EXPLORER_ROOT` points to the test directory. On the NAS the manifest asks for `/srv/storage` and the launcher, granting it, sets `NAS_STORAGE_ROOT` and `NAS_STORAGE_REGISTRY`, which take precedence: the backend shows only the authorized volumes, with stable logical paths based on UUIDs. An empty registry produces an empty root, never the directory of the system.

**Network sharing.** From the menu of a folder, _Share on the network_ makes it visible to the computers of the local network with Samba (SMB): from Windows `\\nas-address\name`, from Linux `smb://nas-address/name`. The window chooses the permissions (read only, or read and write) and whether to protect it with the password of the account: the password goes to the gateway (`PUT /auth/account/share-password`), which checks it and passes it to Samba, and the app never sees it. The list is in the database of the app (`GET`/`PUT`/`DELETE api/shares`) and goes to the launcher at every change and at start (`PUT /api/apps/self/shares` on `NAS_LAUNCHER_SOCKET`), which configures Samba and opens port 445 to the local network only while a share exists. Renaming, moving or deleting a shared folder carries the share with it. The manifest asks for `permissions.shares` and the Debian package `samba`. In development, without the launcher, the entry does not show.

For structure, tests and checks see [DEVELOPMENT.md](DEVELOPMENT.md). The contract for installation, search and communication with the launcher is in [APPS.md](APPS.md); packaging and release are in [NAS.md](NAS.md).

Explorer also exposes the NAS `file-picker`: the launcher opens it with `nasPicker`, `multiple`,
optional comma-separated `extensions` and an initial `directory`. The simplified view offers
browsing, search and confirmation without operations that change files. The result holds logical
paths and relative download URLs `api/...`.
