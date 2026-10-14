import { beforeEach, describe, expect, it } from 'vitest';
import { useFavorites } from '@/composables/useFavorites';
import type { FileEntry } from '@/types/files';

const file: FileEntry = {
  name: 'report.txt',
  path: '/docs/report.txt',
  kind: 'file',
  size: 12,
  modified: 10,
};
const folder: FileEntry = {
  name: 'docs',
  path: '/docs',
  kind: 'folder',
  size: null,
  modified: 9,
};

describe('useFavorites', () => {
  beforeEach(() => {
    useFavorites().favorites.value = [];
  });

  it('adds, updates, and removes a favorite entry', () => {
    const { favorites, addFavorite, isFavorite, removeFavorite } = useFavorites();

    addFavorite(file);
    expect(isFavorite(file.path)).toBe(true);
    expect(favorites.value).toHaveLength(1);

    addFavorite({ ...file, modified: 20 });
    expect(favorites.value[0].modified).toBe(20);

    removeFavorite(file.path);
    expect(isFavorite(file.path)).toBe(false);
  });

  it('toggles multiple files and folders together', () => {
    const { favorites, toggleFavorites } = useFavorites();

    toggleFavorites([file, folder]);
    expect(favorites.value.map((entry) => entry.path)).toEqual([file.path, folder.path]);

    toggleFavorites([file, folder]);
    expect(favorites.value).toEqual([]);
  });
});
