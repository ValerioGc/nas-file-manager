import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('global Sass placeholders', () => {
  it('loads placeholders from the application entry point and injects them into SFC styles', () => {
    const entry = readFileSync('src/main.ts', 'utf8');
    const viteConfig = readFileSync('vite.config.common.ts', 'utf8');
    const placeholders = readFileSync(
      'node_modules/@valeriogc/nas-base-app/dist/styles/partials/_placeholders.scss',
      'utf8',
    );
    const mixins = readFileSync(
      'node_modules/@valeriogc/nas-base-app/dist/styles/partials/_mixins.scss',
      'utf8',
    );
    const folderTree = readFileSync('src/components/FolderTree.vue', 'utf8');
    const folderTreeItem = readFileSync('src/components/FolderTreeItem.vue', 'utf8');

    expect(entry).toContain("import '@/styles/main.scss';");
    expect(viteConfig).toContain('additionalData: (source, filename) =>');
    expect(viteConfig).toContain('@use "@/styles/global.scss" as *;');
    expect(readFileSync('src/styles/global.scss', 'utf8')).toContain(
      "@forward '@valeriogc/nas-base-app/styles/global.scss'",
    );
    expect(placeholders).toContain('%reset_list');
    expect(placeholders).toContain('%text_ellipsis');
    expect(placeholders).toContain('%fx_center');
    expect(placeholders).toContain('%fx_between');
    expect(mixins).toContain('@mixin flex_layout');
    expect(mixins).toContain('@mixin flex_center');
    expect(placeholders).toContain('text-overflow: ellipsis;');
    expect(folderTree).toContain('@extend %reset_list;');
    expect(folderTreeItem).toContain('@extend %reset_list;');
    expect(folderTree).not.toContain("@use '@/styles/partials/placeholders");
    expect(folderTreeItem).not.toContain("@use '@/styles/partials/placeholders");
  });
});
