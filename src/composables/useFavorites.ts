import { computed } from 'vue';
import type { FileEntry } from '@/types/files';
import { appApiUrl } from '@/services/apiUrl';
import { storedDocument } from '@valeriogc/nas-base-app';

const stored = storedDocument('favorites', {
  parse: parseFavorites,
  url: appApiUrl,
  legacyKey: 'fs-explorer-favorites',
});
const favorites = stored.value;
// Looked up for every row, so the paths are indexed once per change.
const favoritePaths = computed(() => new Set(favorites.value.map((entry) => entry.path)));

export const loadFavorites = stored.load;

export function useFavorites() {
  function isFavorite(path: string) {
    return favoritePaths.value.has(path);
  }

  function addFavorite(entry: FileEntry) {
    const existing = favorites.value.findIndex((favorite) => favorite.path === entry.path);
    if (existing >= 0) {
      favorites.value[existing] = entry;
      return;
    }
    favorites.value.push(entry);
  }

  function removeFavorite(path: string) {
    favorites.value = favorites.value.filter((entry) => entry.path !== path);
  }

  function toggleFavorites(entries: FileEntry[]) {
    if (entries.length === 0) {
      return;
    }
    const shouldRemove = entries.every((entry) => isFavorite(entry.path));
    if (shouldRemove) {
      for (const entry of entries) {
        removeFavorite(entry.path);
      }
      return;
    }
    for (const entry of entries) {
      addFavorite(entry);
    }
  }

  return { addFavorite, favorites, isFavorite, removeFavorite, toggleFavorites };
}

export function parseFavorites(saved: unknown): FileEntry[] {
  return Array.isArray(saved) ? saved.filter(isFileEntry) : [];
}

function isFileEntry(value: unknown): value is FileEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const entry = value as Partial<FileEntry>;
  return (
    typeof entry.name === 'string' &&
    typeof entry.path === 'string' &&
    typeof entry.kind === 'string'
  );
}
