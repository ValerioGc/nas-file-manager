import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('SVG interface assets', () => {
  it('provides the spacer, close, and file thumbnail icons', () => {
    const thumbnail = readFileSync('src/components/common/FileThumbnail.vue', 'utf8');
    const assets = [
      'src/assets/icons/spacer.svg',
      'src/assets/icons/close.svg',
      'src/assets/icons/chevron-down.svg',
      'src/assets/icons/chevron-right.svg',
      'src/assets/icons/thumbnail-folder.svg',
      'src/assets/icons/thumbnail-archive.svg',
      'src/assets/icons/thumbnail-document.svg',
      'src/assets/icons/thumbnail-file.svg',
      'src/assets/icons/thumbnail-image.svg',
      'src/assets/icons/thumbnail-video.svg',
    ];

    assets.forEach((asset) => {
      expect(existsSync(asset)).toBe(true);
      expect(readFileSync(asset, 'utf8')).toContain('<svg');
    });
    expect(thumbnail).toContain('thumbnailIcons');
    expect(thumbnail).not.toContain('const symbols');
  });

  it('uses SVG chevrons for folder tree expansion states', () => {
    const folderTreeItem = readFileSync('src/components/FolderTreeItem.vue', 'utf8');

    expect(folderTreeItem).toContain("from '@/assets/icons/chevron-down.svg?url'");
    expect(folderTreeItem).toContain("from '@/assets/icons/chevron-right.svg?url'");
    expect(folderTreeItem).toContain('class="tree_toggle_icon"');
    expect(folderTreeItem).not.toContain("? '⌄' : '›'");
  });

  it('draws the chevrons of the details panel in a colour of their own', () => {
    // Loaded through <img>, an SVG does not see the colour of the page: currentColor is black
    // there, and the chevron of the closed panel vanished on the dark theme.
    for (const chevron of ['chevron-left', 'chevron-right']) {
      expect(readFileSync(`src/assets/icons/${chevron}.svg`, 'utf8')).not.toContain('currentColor');
    }
  });

  it('uses SVG icons in the desktop header and explorer rows', () => {
    const aside = readFileSync('src/components/desktop/navigation/AsideMenu.vue', 'utf8');
    const actionMenu = readFileSync('src/components/desktop/header/ActionMenu.vue', 'utf8');
    const fileBrowser = readFileSync('src/components/desktop/explorer/FileBrowser.vue', 'utf8');
    const assets = [
      'src/assets/icons/add.svg',
      'src/assets/icons/star.svg',
      'src/assets/icons/star-filled.svg',
      'src/assets/icons/grid.svg',
      'src/assets/icons/list.svg',
      'src/assets/icons/flag-it.svg',
      'src/assets/icons/flag-en.svg',
      'src/assets/icons/more.svg',
      'src/assets/icons/new-folder.svg',
      'src/assets/icons/search.svg',
      'src/assets/icons/settings.svg',
    ];

    assets.forEach((asset) => {
      expect(existsSync(asset)).toBe(true);
      expect(readFileSync(asset, 'utf8')).toContain('<svg');
    });
    expect(aside).toContain('class="sidebar_toggle_icon"');
    expect(aside).toContain('stroke="currentColor"');
    expect(actionMenu).toContain('class="icon_asset" :src="searchIcon"');
    expect(actionMenu).toContain("from '@/assets/icons/add.svg?url'");
    expect(fileBrowser).toContain("from '@/assets/icons/more.svg?url'");
    expect(fileBrowser).toContain("import ContextMenu from '@/components/common/ContextMenu.vue';");
  });

  it('uses the shared close SVG instead of a text close glyph', () => {
    const sources = [
      'src/components/common/MoveDialog.vue',
      'src/components/common/FilePreview.vue',
      'src/components/desktop/settings/SettingsModal.vue',
    ];

    sources.forEach((source) => {
      const content = readFileSync(source, 'utf8');
      expect(content).toContain("from '@/assets/icons/close.svg?url'");
      expect(content).not.toContain('×');
    });
  });
});
