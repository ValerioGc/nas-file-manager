import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('BaseModal usage', () => {
  it('passes the required aria-label prop with the declared component name', () => {
    const settingsModal = fs.readFileSync(
      'src/components/desktop/settings/SettingsModal.vue',
      'utf8',
    );
    const explorerView = fs.readFileSync(
      'src/components/desktop/explorer/ExplorerView.vue',
      'utf8',
    );
    const baseModal = fs.readFileSync('src/components/common/BaseModal.vue', 'utf8');

    expect(settingsModal).toContain(':aria-label="t.settings"');
    expect(explorerView).toContain(':aria-label="t.details"');
    expect(baseModal).toContain("'aria-label': string;");
    expect(baseModal).toContain(':aria-label="props[\'aria-label\']"');
  });
});
