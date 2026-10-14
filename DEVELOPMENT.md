# Development of nas-file-manager

The Vue/TypeScript UI is in `src/`; the Rust/Axum backend is in `backend/axum/`. The filesystem logic is in `backend/core/`, used by the Axum backend. The shared scripts are in the library `@valeriogc/nas-base-app`, except `scripts/smoke-nas.mjs`, which tries the package on an empty temporary storage; manifest and version are in `nas-app.json`, `package.json` and the Cargo metadata. `src/assets/logo.svg` is the source of the logo and the UI icons are in `src/assets/icons/`.

## Conventions

Use the Composition API with `<script setup lang="ts">`, imports through the `@/` alias, scoped SFC styles, CSS names with `_` and UI texts in the catalogues `src/i18n/locales/en.ts` and `it.ts`. Code, method names, test descriptions, this document and the README are in English. The NAS theme comes from the context of the iframe; palette, SCSS partials and shared components come from `@valeriogc/nas-base-app`. The bridge is the one of the library: `src/services/nasShell.ts` uses its notifications, shortcuts and picker answers, `src/composables/useNasLauncherContext.ts` binds the context to the catalogue, to the name of the NAS and to `nasContextActive`. The components of the interface stay the app's own; the mobile breakpoint stays the one of `tokens.scss`.

Settings (`preferences`) and favourites (`favorites`) are JSON documents of the backend: `GET`/`PUT api/documents/<name>` in `backend/axum/src/documents.rs`, the same as in nas-system-monitor, with the table created by the migrations of `backend/axum/migrations/`. `storedDocument` of `@valeriogc/nas-base-app`, the same in both apps, starts from the default values, reads the document at start (`main.ts`), saves every change shortly after and, before that, nothing; the pages of the same browser follow each other through a `BroadcastChannel`, the other browsers read again when the page becomes visible. What was in `localStorage` moves to the backend the first time. The E2E tests start every time from an empty database.

Image previews are made by `backend/core` (`preview`, `PreviewSize`): JPEG or PNG, EXIF orientation, two sizes, in `.fs-explorer-cache/previews` in the state folder. The name is a stable FNV-1a hash of path, size, date, type and preview size; the space is counted once and then kept up to date, and beyond the limit (`backend/axum/src/previews.rs`, table `preview_cache`) the least recently read ones go (the modification date of the file is updated at every read). The backend decodes at most two at a time; in the page `FileThumbnail` asks for them only when they come into view, as an address with `v=<date>-<size>` the browser keeps forever.

Folders shared on the network are in `backend/axum/src/shares.rs` (table `shares`, migration `0002_shares.sql`), which talks to the launcher with `backend/axum/src/launcher.rs`, the same client as in the other apps without the functions it does not use. On the page side, `src/services/shares.ts` and `src/composables/useShares.ts` (a single state for menus, icons and the Shared section), with the window `src/components/common/ShareModal.vue`. The password of the shares goes straight to the gateway, never to the backend of the app.

The search index is in `backend/axum/src/search.rs` (migration `0004_search_index.sql`): `search_entries` with the names in lowercase and a trigram FTS5 table (`search_names`), the folders read with their date (`search_folders`) and the disks with a complete index (`search_volumes`). It covers the disks of the registry except the network shares (`Filesystem::search_roots`); for disks not yet complete `search_with` walks the disk as before, for the others it reads again from the disk the paths it found. The first build reads every folder, among the operations of the launcher; every folder is passed after the new ones it contains, so a known folder also has its subfolders known if the work stops. Then every folder has an inotify watch (`notify`, not recursive) and an event reads its folder again; at start the folders with a changed date are read again, and a folder changed in the last two seconds is read again anyway the next time (the clock of the kernel is coarse). The operations of Explorer read the touched folder again at once. Beyond the inotify limit (read from the launcher, `GET /api/system/inotify`) the extra folders are read again every 10 minutes, with a notification at 80% and one when it is exceeded. Explorer declares `run.background` and asks for it at start, so the index keeps up even with the window closed.

The trash is in `backend/core/src/trash.rs` (move, list, restore, delete, empty, expire) and in `backend/axum/src/trash.rs` (settings and dates in the migration `0005_trash.sql`, routes `api/trash`, daily expiry). With the trash on, `Filesystem::delete` renames into the `.nas-trash` of the disk. The directories created in the trash have `2770` permissions; the paths refuse symbolic links in directories and the root of the trash cannot be restored or deleted as an entry. The date is the ctime of the item, without using the one of the parents, which changes with the deletion of siblings, or the one kept in the database. The migration `0006_trash_versions.sql` ties the date to the signature of the version (inode, dates and size): a replacement by sync or SMB does not inherit the previous expiry. A deleted folder also records its descendants; the dates already present before the migration are kept. The shares also pass their place in the trash (`trash`) to the launcher, only if the launcher answers `recycle: true`. The page is `src/components/desktop/trash/TrashView.vue`, with `src/services/trash.ts` and `src/composables/useTrash.ts`.

`backend/axum/src/caches.rs` answers the launcher on `/internal/cache` (capability `cache`): previews (`previews`) and index (`search-index`, space from `dbstat`), each one with its emptying; once emptied, the index is built again at once.

The FE tests are in `src/tests/unit`, `component`, `scripts`, `e2e`, with sub-paths mirroring `src/`. The Rust tests are in `backend/tests/unit` or `integration` when present.

## Dependencies and lockfiles

Locally dependencies are installed with pnpm; the pipelines install with `npm ci` from `package-lock.json`, which therefore has to match `package.json`. `pnpm install` realigns it by itself (`postinstall`, which installs nothing with npm); `pnpm add`, `pnpm update` and `pnpm remove` do not: after them run `pnpm run lock:npm`. `pnpm run lint` checks the alignment and, when it is missing, fails saying so; `release:merge` realigns it anyway before publishing. `pnpm-lock.yaml` stays local.

## Shared library

The launcher bridge, styles, shared components and helpers, and the build, package and release scripts come from `@valeriogc/nas-base-app`, published on GitHub Packages; the commands of `package.json` use its `nas-base-app`. The `.npmrc` of the project points the `@valeriogc` scope to its registry; locally a classic token with `read:packages` is needed in your own `~/.npmrc` (`//npm.pkg.github.com/:_authToken=...`), while the pipelines use the token of the workflow. For a new version of the library, update the number in `package.json` and run `pnpm install`. The local `pnpm-workspace.yaml` has `'@valeriogc/nas-base-app': false` under `allowBuilds`.

## Checks

```bash
pnpm install
pnpm run format:check
pnpm run lint
pnpm run type-check
pnpm test
pnpm run test:e2e
pnpm run test:coverage
cargo fmt --manifest-path backend/Cargo.toml --all --check
cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings
cargo test --locked --manifest-path backend/Cargo.toml
pnpm run nas:package
pnpm run nas:test
```

`pnpm run format` applies Prettier, ESLint and `format-sfc-spacing.mjs`; `pnpm run format:sfc` runs only the last step. The E2E tests start Vite on port 1420; Explorer also starts Axum with a fixture root. `release:merge` creates commit and tag: try it only in an isolated temporary Git repository.

The package must work even when moved out of the checkout; do not reference `external-apps/` or files of the launcher. For the full contract see [APPS.md](APPS.md).
