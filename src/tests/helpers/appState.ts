import { ref } from 'vue';
import { vi } from 'vitest';
import type { useFileOperations } from '@/composables/useFileOperations';
import type { useFilesystem } from '@/composables/useFilesystem';
import type { StorageInfo } from '@/types/storage';
import { file, folder, archive } from './fixtures';
export function appState() {
  type Operations = ReturnType<typeof useFileOperations>;
  const operations = {
    create: vi.fn<Operations['create']>().mockResolvedValue('Created'),
    createFile: vi.fn<Operations['createFile']>().mockResolvedValue('Created file'),
    rename: vi.fn<Operations['rename']>().mockResolvedValue('Renamed'),
    perform: vi.fn<Operations['perform']>().mockResolvedValue('Done'),
    performMany: vi.fn<Operations['performMany']>().mockResolvedValue('Done'),
    transferToDestination: vi.fn<Operations['transferToDestination']>().mockResolvedValue('Moved'),
    upload: vi.fn<Operations['upload']>().mockResolvedValue('Uploaded'),
    isMutating: ref(false),
    transfer: ref<Operations['transfer']['value']>(null),
  } satisfies Operations;
  const filesystem = {
    isUsingBackend: ref(true),
    entries: ref([folder, file, archive]),
    error: ref(''),
    isLoading: ref(false),
    load: vi.fn<ReturnType<typeof useFilesystem>['load']>().mockResolvedValue(undefined),
    search: vi.fn<ReturnType<typeof useFilesystem>['search']>().mockResolvedValue(undefined),
  };
  const storage = ref<StorageInfo | null>({ usedBytes: 50, totalBytes: 100, availableBytes: 50 });
  return { operations, filesystem, storage };
}
