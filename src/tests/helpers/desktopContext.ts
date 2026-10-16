import { computed, ref } from 'vue';
import { vi } from 'vitest';
import type { DesktopExplorerContext } from '@/composables/useDesktopExplorerContext';
import { file, folder, archive } from './fixtures';
export function desktopContext() {
  const entries = ref([file, folder, archive]);
  const loading = ref(false);
  const root = ref(false);
  const context: DesktopExplorerContext = {
    breadcrumbs: computed(() => [
      { label: 'Home', path: '/' },
      { label: 'Docs', path: '/docs' },
    ]),
    canGoBack: computed(() => true),
    canGoUp: computed(() => !root.value),
    canMutateCurrentPath: computed(() => !root.value),
    files: computed(() => entries.value),
    isListLoading: computed(() => loading.value),
    isComputerRoot: computed(() => root.value),
    isMutating: ref(false),
    isNarrowDesktop: ref(false),
    isMobileSidebar: ref(false),
    isSidebarCollapsed: ref(false),
    search: ref(''),
    searchSummary: computed(() => '3 results'),
    selectedFolderName: ref('Docs'),
    sortBy: ref('name'),
    viewMode: ref('list'),
    volumes: ref([]),
    activeNavigation: ref('all-files'),
    createFolder: vi.fn(),
    createFile: vi.fn(),
    copyToClipboard: vi.fn(),
    cutToClipboard: vi.fn(),
    fileAction: vi.fn(),
    fileActions: vi.fn(),
    navigate: vi.fn(),
    goBack: vi.fn(),
    goHome: vi.fn(),
    goUp: vi.fn(),
    openArchive: vi.fn(),
    selectNavigation: vi.fn(),
    openSettings: vi.fn(),
    refreshFolders: vi.fn(),
    openSidebar: vi.fn(),
    pasteClipboard: vi.fn(),
    moveFilesToDestination: vi.fn(),
    requestMove: vi.fn(),
    upload: vi.fn(),
  };
  return { context, entries, loading, root };
}
export function dataTransfer() {
  const values = new Map<string, string>();
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: (key: string, value: string) => values.set(key, value),
    getData: (key: string) => values.get(key) ?? '',
  };
}
