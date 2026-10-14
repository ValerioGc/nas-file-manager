import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('desktop component structure', () => {
  it('groups components by responsibility instead of using a partials folder', () => {
    const componentPaths = [
      'src/components/desktop/layout/MainView.vue',
      'src/components/desktop/header/DesktopHeader.vue',
      'src/components/desktop/navigation/AsideMenu.vue',
      'src/components/desktop/navigation/StorageUsage.vue',
      'src/components/desktop/explorer/ExplorerView.vue',
      'src/components/desktop/explorer/FileBrowser.vue',
      'src/components/desktop/settings/SettingsModal.vue',
    ];

    componentPaths.forEach((path) => {
      expect(existsSync(path)).toBe(true);
    });
    expect(existsSync('src/components/desktop/partials/MainView.vue')).toBe(false);
    expect(existsSync('src/components/desktop/partials/ExplorerView.vue')).toBe(false);
  });

  it('uses a dedicated drive layout for the NAS root', async () => {
    const fileBrowser = await import('node:fs/promises').then((fs) =>
      fs.readFile('src/components/desktop/explorer/FileBrowser.vue', 'utf8'),
    );
    const desktopApp = await import('node:fs/promises').then((fs) =>
      fs.readFile('src/apps/desktop/DesktopApp.vue', 'utf8'),
    );

    expect(fileBrowser).toContain('v-else-if="isComputerRoot"');
    expect(fileBrowser).toContain('class="computer_drive_card"');
    expect(fileBrowser).toContain('storageIcon');
    expect(desktopApp).toContain('const isComputerRoot = computed(');
    expect(desktopApp).toContain('isComputerRoot,');
  });
});
