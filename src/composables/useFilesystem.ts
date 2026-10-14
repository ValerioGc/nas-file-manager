import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from '@/i18n';
import { listDirectory, searchFilesystem } from '@/services/filesystem';
import type { FileEntry } from '@/types/files';
import { trimSlashes } from '@/utils/paths';

export function useFilesystem(fallbackEntries: FileEntry[], initialPath = '') {
  const { t } = useI18n();
  const entries = ref<FileEntry[]>(fallbackEntries);
  const error = ref('');
  const isLoading = ref(false);
  const isUsingBackend = ref(false);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingSearchResolve: (() => void) | null = null;
  let activeSearch: Promise<void> | null = null;
  let searchVersion = 0;

  async function load(path = '') {
    isLoading.value = true;
    error.value = '';
    try {
      entries.value = await listDirectory(path);
      isUsingBackend.value = true;
    } catch (cause) {
      isUsingBackend.value = false;
      entries.value = filterFallbackEntries(fallbackEntries, path);
      error.value = cause instanceof Error ? cause.message : t.value.loadFailed;
    } finally {
      isLoading.value = false;
    }
  }

  function search(query: string) {
    searchVersion += 1;
    const version = searchVersion;
    isLoading.value = true;
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
      pendingSearchResolve?.();
      pendingSearchResolve = null;
    }

    return new Promise<void>((resolve) => {
      pendingSearchResolve = resolve;
      searchTimer = setTimeout(() => {
        searchTimer = null;
        pendingSearchResolve = null;
        const request = runSearch(query, version);
        void request.then(resolve, resolve);
      }, 280);
    });
  }

  async function runSearch(query: string, version: number) {
    if (activeSearch) {
      await activeSearch;
      if (version !== searchVersion) {
        return;
      }
    }

    const request = executeSearch(query, version);
    activeSearch = request;
    try {
      await request;
    } finally {
      if (activeSearch === request) {
        activeSearch = null;
      }
    }
  }

  async function executeSearch(query: string, version: number) {
    isLoading.value = true;
    error.value = '';
    try {
      let result: FileEntry[];
      if (query.trim()) {
        result = await searchFilesystem(query);
      } else {
        result = await listDirectory('');
      }
      if (version === searchVersion) {
        entries.value = result;
        isUsingBackend.value = true;
      }
    } catch (cause) {
      if (version === searchVersion) {
        isUsingBackend.value = false;
        error.value = cause instanceof Error ? cause.message : t.value.searchFailed;
      }
    } finally {
      if (version === searchVersion) {
        isLoading.value = false;
      }
    }
  }

  onMounted(() => void load(initialPath));
  onBeforeUnmount(() => {
    searchVersion += 1;
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    pendingSearchResolve?.();
    pendingSearchResolve = null;
  });

  return { entries, error, isLoading, isUsingBackend, load, search };
}

function filterFallbackEntries(entries: FileEntry[], path: string) {
  const normalizedPath = trimSlashes(path);
  const prefix = normalizedPath ? `/${normalizedPath}/` : '/';

  return entries.filter((entry) => {
    if (!entry.path.startsWith(prefix)) {
      return false;
    }
    return !entry.path.slice(prefix.length).includes('/');
  });
}
