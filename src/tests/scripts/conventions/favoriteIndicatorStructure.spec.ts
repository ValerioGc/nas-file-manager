import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('favorite indicators', () => {
  it('renders clickable favorite states in list and preview layouts', () => {
    const fileBrowser = fs.readFileSync('src/components/desktop/explorer/FileBrowser.vue', 'utf8');
    const contextMenu = fs.readFileSync('src/components/common/ContextMenu.vue', 'utf8');
    const filePreview = fs.readFileSync('src/components/common/FilePreview.vue', 'utf8');

    expect(fileBrowser).toContain(
      "import starFilledIcon from '@/assets/icons/star-filled.svg?url';",
    );
    expect(fileBrowser).toContain('function favoriteIcon(file: FileEntry)');
    expect(fileBrowser).toContain('class="favorite_badge"');
    expect(fileBrowser).toContain('class="favorite_badge preview_favorite_badge"');
    expect(fileBrowser).toContain('@click.stop="toggleFileFavorite(file)"');
    expect(filePreview).toContain(
      "import starFilledIcon from '@/assets/icons/star-filled.svg?url';",
    );
    expect(filePreview).toContain('icon: allFavorites ? starFilledIcon : starIcon');
    expect(contextMenu).toContain('color: var(--text);');
  });
});
