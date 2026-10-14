import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('desktop header structure', () => {
  it('exposes settings and does not expose account or theme actions', () => {
    const mainView = fs.readFileSync('src/components/desktop/layout/MainView.vue', 'utf8');
    const header = fs.readFileSync('src/components/desktop/header/DesktopHeader.vue', 'utf8');
    const actionMenu = fs.readFileSync('src/components/desktop/header/ActionMenu.vue', 'utf8');
    const desktopApp = fs.readFileSync('src/apps/desktop/DesktopApp.vue', 'utf8');
    const explorerView = fs.readFileSync(
      'src/components/desktop/explorer/ExplorerView.vue',
      'utf8',
    );

    expect(mainView).toContain('<DesktopHeader');
    // The toolbar heads the files, beside the details panel, not the whole page.
    expect(header).not.toContain('<ActionMenu');
    expect(explorerView).toContain('<ActionMenu />');
    expect(header).toContain("import settingsIcon from '@/assets/icons/settings.svg?url';");
    expect(header).toContain('@click="openSettings"');
    expect(actionMenu).toContain('useDesktopExplorerContext');
    expect(actionMenu.match(/toolbar_divider/g)?.length).toBeGreaterThanOrEqual(3);
    expect(actionMenu).toContain('class="toolbar_search"');
    expect(actionMenu).toContain('toolbar_sort');
    expect(header).not.toContain('function openUploadPicker');
    expect(header).not.toContain('const searchModel = computed');
    expect(desktopApp).toContain('provideDesktopExplorerContext');
    expect(mainView).not.toContain('toggle-theme');
    expect(desktopApp).not.toContain('toggle-theme');
    expect(mainView).not.toContain('userMenu');
    expect(mainView).not.toContain('defineProps');
  });
});
