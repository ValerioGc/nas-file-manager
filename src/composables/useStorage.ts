import { onMounted, ref } from 'vue';
import { useI18n } from '@/i18n';
import { getStorageInfo } from '@/services/filesystem';
import type { StorageInfo } from '@/types/storage';
import { messageOf } from '@/utils/errors';

const storage = ref<StorageInfo | null>(null);
const isLoading = ref(false);
const error = ref('');
let refreshHandler: (() => Promise<void>) | null = null;

export function refreshStorage() {
  return refreshHandler?.() ?? Promise.resolve();
}

export function useStorage() {
  const { t } = useI18n();

  async function loadStorage() {
    isLoading.value = true;
    error.value = '';
    try {
      storage.value = await getStorageInfo();
    } catch (cause) {
      error.value = messageOf(cause, t.value.loadFailed);
    } finally {
      isLoading.value = false;
    }
  }

  refreshHandler = loadStorage;
  onMounted(() => void loadStorage());

  return { storage, isLoading, error, loadStorage };
}
