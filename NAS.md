# NAS package of nas-file-manager

Stable identity: `nas-file-manager`. The launcher installs the archive produced by `pnpm run nas:package`, serves it under `/apps/nas-file-manager/` and starts the backend over a Unix socket. The manifest `nas-app.json` declares executable, socket, logo, protocol, capabilities and permissions. The source logo `src/assets/logo.svg` becomes `icon.svg` in the archive. `pnpm run nas:test` extracts the archive into an isolated directory and checks UI, API, `/health`, version and the absence of TCP listeners.

The shared workflows are `.github/workflows/ci.yml`, `build.yml`, `audit.yml` and `.github/dependabot.yml`. A release requires consistent versions in `package.json`, the npm lock, manifest, Cargo, Sonar and changelog. If the branch has no reachable release tag, the initial candidate is the version of the package; the dry run creates no commit or tag. The shared details and the iframe protocol are in [APPS.md](APPS.md).
