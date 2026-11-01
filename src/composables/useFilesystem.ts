import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from '@/i18n';
import { listDirectory, searchFilesystem } from '@/services/filesystem';
import type { FileEntry } from '@/types/files';
import { messageOf } from '@/utils/errors';

export function useFilesystem(initialPath = '') {
  const { t } = useI18n();
  const entries = ref<FileEntry[]>([]);
  const error = ref('');
  const isLoading = ref(false);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingSearchResolve: (() => void) | null = null;
  let activeSearch: Promise<void> | null = null;
  let latest = 0;

  /** Loads a folder. Only the latest load or search may change the list. */
  async function load(path = '') {
    const current = ++latest;
    isLoading.value = true;
    error.value = '';
    try {
      const result = await listDirectory(path);
      if (current === latest) {
        entries.value = result;
      }
    } catch (cause) {
      if (current === latest) {
        entries.value = [];
        error.value = messageOf(cause, t.value.loadFailed);
      }
    } finally {
      if (current === latest) {
        isLoading.value = false;
      }
    }
  }

  function search(query: string) {
    latest += 1;
    const version = latest;
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
      if (version !== latest) {
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
      const result = await (query.trim() ? searchFilesystem(query) : listDirectory(''));
      if (version === latest) {
        entries.value = result;
      }
    } catch (cause) {
      if (version === latest) {
        error.value = messageOf(cause, t.value.searchFailed);
      }
    } finally {
      if (version === latest) {
        isLoading.value = false;
      }
    }
  }

  onMounted(() => void load(initialPath));
  onBeforeUnmount(() => {
    latest += 1;
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    pendingSearchResolve?.();
    pendingSearchResolve = null;
  });

  return { entries, error, isLoading, load, search };
}
