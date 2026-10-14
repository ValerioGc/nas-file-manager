import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Every run starts with no saved settings or favorites.
const database = join(tmpdir(), 'nas-file-manager-e2e.sqlite3');

export default defineConfig({
  testDir: 'src/tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:1420', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 1420 --strictPort',
      // Keep release tests independent of the host's native file watcher limit.
      env: { CHOKIDAR_USEPOLLING: 'true' },
      url: 'http://127.0.0.1:1420',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `rm -f ${database}* && npm run build && npm run backend:dev`,
      env: { FS_EXPLORER_ROOT: 'src/tests/e2e/fixtures/root', NAS_DB_PATH: database },
      url: 'http://127.0.0.1:1420/api/health',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
