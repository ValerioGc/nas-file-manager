// Composable for handling storage-related reactive state

import { onMounted, ref } from 'vue';
import { useI18n } from '@/i18n';
import { getStorageInfo } from '@/services/filesystem';
import type { StorageInfo } from '@/types/storage';

const storage = ref<StorageInfo | null>(null);
const isLoading = ref(false);
const error = ref('');
let refreshHandler: (() => Promise<void>) | null = null;

export function refreshStorage() {
  if (!refreshHandler) {
    return Promise.resolve();
  }

  return refreshHandler();
}

export function useStorage() {
  const { t } = useI18n();

  async function loadStorage() {
    isLoading.value = true;
    error.value = '';
    try {
      storage.value = await getStorageInfo();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : t.value.loadFailed;
    } finally {
      isLoading.value = false;
    }
  }

  refreshHandler = loadStorage;
  onMounted(() => void loadStorage());

  return { storage, isLoading, error, loadStorage };
}
