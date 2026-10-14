import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { smokeNas } from '@valeriogc/nas-base-app/scripts';

// The package runs on an empty storage of its own, with the names the grant of the launcher sets
// on the NAS (apply-app-grants.sh).
const storageRoot = mkdtempSync(join(tmpdir(), 'explorer-storage-'));
const registry = join(storageRoot, 'volumes.tsv');
writeFileSync(registry, '');
try {
  await smokeNas(process.argv.slice(2), process.cwd(), {
    env: { NAS_STORAGE_ROOT: storageRoot, NAS_STORAGE_REGISTRY: registry },
  });
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(storageRoot, { recursive: true, force: true });
}
