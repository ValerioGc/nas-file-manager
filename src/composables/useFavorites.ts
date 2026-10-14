import type { FileEntry } from '@/types/files';
import { appApiUrl } from '@/services/apiUrl';
import { storedDocument } from '@valeriogc/nas-base-app';

// Shared by every browser that opens the Explorer, through its backend.
const stored = storedDocument('favorites', {
  parse: parseFavorites,
  url: appApiUrl,
  legacyKey: 'fs-explorer-favorites',
});
const favorites = stored.value;

export const loadFavorites = stored.load;

export function useFavorites() {
  function isFavorite(path: string) {
    return favorites.value.some((entry) => entry.path === path);
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

  function toggleFavorite(entry: FileEntry) {
    if (isFavorite(entry.path)) {
      removeFavorite(entry.path);
      return;
    }
    addFavorite(entry);
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

  return { addFavorite, favorites, isFavorite, removeFavorite, toggleFavorite, toggleFavorites };
}

/** The saved favorites that are entries, none when what was saved is not a list. */
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
