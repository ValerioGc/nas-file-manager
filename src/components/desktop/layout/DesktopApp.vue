<script setup lang="ts">

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ConfirmDialog from '@/components/common/ConfirmDialog.vue';
import ConflictDialog from '@/components/common/ConflictDialog.vue';
import ArchiveDialog from '@/components/common/ArchiveDialog.vue';
import FileNameModal from '@/components/common/FileNameModal.vue';
import MoveDialog from '@/components/common/MoveDialog.vue';
import TransferProgress from '@/components/common/TransferProgress.vue';
import MainView from '@/components/desktop/layout/MainView.vue';
import AsideMenu from '@/components/desktop/navigation/AsideMenu.vue';
import SettingsModal from '@/components/desktop/settings/SettingsModal.vue';
import { provideDesktopExplorerContext } from '@/composables/useDesktopExplorerContext';
import { useFileClipboard } from '@/composables/useFileClipboard';
import { useConflictResolution } from '@/composables/useConflictResolution';
import { useOperationConfirmation } from '@/composables/useOperationConfirmation';
import { useFileOperations } from '@/composables/useFileOperations';
import { useNameDialog } from '@/composables/useNameDialog';
import { useTransferDialog } from '@/composables/useTransferDialog';
import { useFileSearch } from '@/composables/useFileSearch';
import { useFilesystem } from '@/composables/useFilesystem';
import { useFileSorting } from '@/composables/useFileSorting';
import { useFolderTree } from '@/composables/useFolderTree';
import { useNavigationHistory } from '@/composables/useNavigationHistory';
import { useFavorites } from '@/composables/useFavorites';
import { loadShares, useShares } from '@/composables/useShares';
import { loadTrashSettings } from '@/composables/useTrash';
import { useLoading } from '@/composables/useLoading';
import { usePersistentRef, usePreferences } from '@/composables/usePreferences';
import { refreshStorage } from '@/composables/useStorage';
import { useMediaQuery } from '@/composables/useViewport';
import { useI18n } from '@/i18n';
import { reportSuccess } from '@/services/notices';
import { nasName } from '@/composables/useNasLauncherContext';
import type { FileEntry } from '@/types/files';
import type { ConfirmationRequest } from '@/types/confirmation';
import type { FolderNode } from '@/types/folders';
import type { FileAction } from '@/types/actions';
import type { DesktopNavigation } from '@/types/navigation';
import { filterHiddenEntries } from '@/utils/fileDisplay';
import { messageOf } from '@/utils/errors';

const { locale, t } = useI18n();
const { preferences } = usePreferences();
const { favorites } = useFavorites();
const { overview: sharesOverview, sharedEntries } = useShares();
const isSettingsOpen = ref(false);
const isSidebarOpen = ref(false);
const isSidebarCollapsed = usePersistentRef('fs-explorer-desktop-sidebar-collapsed', false);
const viewMode = usePersistentRef<'grid' | 'list'>('fs-explorer-desktop-view-mode', 'list');

const nasRootName = computed(() => {
  const name = nasName.value.trim();
  return name && name.toLowerCase() !== 'nas' ? name : t.value.thisPc;
});
const initialPath = new URL(window.location.href).searchParams.get('path') ?? '/';
const selectedFolderPath = ref(initialPath);
const selectedFolderName = ref<string>(
  initialPath === '/'
    ? nasRootName.value
    : (initialPath.split('/').findLast(Boolean) ?? nasRootName.value),
);
const activeNavigation = ref<DesktopNavigation>('all-files');
const { folderNodes, volumes, loadFolderTree } = useFolderTree(nasRootName);
const notice = ref('');

function reportDone(message: string) {
  reportSuccess(message, (shown) => (notice.value = shown));
}

function errorMessage(error: unknown) {
  return messageOf(error, t.value.operationFailed);
}

async function runOperation(operation: () => Promise<string | null>) {
  try {
    const message = await operation();
    if (message) {
      reportDone(message);
    }
  } catch (error) {
    notice.value = errorMessage(error);
  }
}

/** Title of the favorites, shared or trash list. */
function navigationName(navigation: DesktopNavigation) {
  if (navigation === 'trash') {
    return t.value.trash;
  }
  return navigation === 'shared' ? t.value.shared : t.value.favorites;
}

watch(locale, () => {
  if (selectedFolderPath.value !== '/') {
    return;
  }
  if (activeNavigation.value !== 'all-files') {
    selectedFolderName.value = navigationName(activeNavigation.value);
    return;
  }
  selectedFolderName.value = nasRootName.value;
});
watch(nasName, () => {
  if (selectedFolderPath.value === '/' && activeNavigation.value === 'all-files') {
    selectedFolderName.value = nasRootName.value;
  }
  void loadFolderTree();
});
const archiveFile = ref<FileEntry | null>(null);
const {
  cancelConflictResolution,
  conflicts,
  isConflictDialogOpen,
  requestConflictResolution,
  resolveConflicts,
} = useConflictResolution();
const {
  cancelConfirmation,
  confirmOperation: requestConfirmation,
  request: confirmationRequest,
  resolveConfirmation,
} = useOperationConfirmation();
const { isMobileViewport: isNarrowDesktop } = useMediaQuery('(max-width: 1100px)');
const { isMobileViewport: isMobileSidebar } = useMediaQuery('(max-width: 680px)');
const {
  entries,
  error: filesystemError,
  isLoading: isFilesystemLoading,
  load,
  search: searchFilesystem,
} = useFilesystem(initialPath);
const {
  create: createFolder,
  createFile,
  isMutating,
  perform,
  performMany,
  rename: renameFile,
  transfer,
  transferToDestination,
  upload,
} = useFileOperations(async () => {
  await load(selectedFolderPath.value);
  await loadFolderTree();
  await refreshStorage();
  if (sharesOverview.value.shares.length > 0) {
    await loadShares();
  }
});

const { clipboard, clearClipboard, copyFiles, cutFiles } = useFileClipboard();
const { query: search, results: searchResults } = useFileSearch(entries);

const visibleSource = computed(() => {
  let source: FileEntry[];
  if (activeNavigation.value === 'favorites') {
    source = favorites.value;
  } else if (activeNavigation.value === 'shared') {
    source = sharedEntries.value;
  } else {
    source = searchResults.value;
  }

  return filterHiddenEntries(source, preferences.value.showHiddenFiles);
});

const { sortBy, sortedEntries: visibleFiles } = useFileSorting(visibleSource);
const { isLoading: isFilterLoading, triggerLoading: triggerListLoading } = useLoading();
const isListLoading = computed(() => isFilesystemLoading.value || isFilterLoading.value);
const canMutateCurrentPath = computed(() => selectedFolderPath.value !== '/');
const isComputerRoot = computed(
  () => activeNavigation.value === 'all-files' && selectedFolderPath.value === '/',
);

const searchSummary = computed(() =>
  search.value ? t.value.globalResults.replace('{count}', String(visibleFiles.value.length)) : '',
);

const { canGoBack, goBack } = useNavigationHistory(
  activeNavigation,
  selectedFolderPath,
  selectedFolderName,
  (previous) => {
    if (previous.navigation === 'all-files') {
      navigateTo(previous.path, previous.name);
    } else {
      selectNavigation(previous.navigation);
    }
  },
);

const canGoUp = computed(
  () => activeNavigation.value === 'all-files' && selectedFolderPath.value !== '/',
);
const breadcrumbs = computed(() => {
  if (activeNavigation.value !== 'all-files') {
    return [{ label: navigationName(activeNavigation.value), path: '/' }];
  }
  const segments = selectedFolderPath.value.split('/').filter(Boolean);
  return [
    { label: nasRootName.value, path: '/' },
    ...segments.map((label, index) => ({
      label:
        index === 0 ? (volumes.value.find((volume) => volume.id === label)?.name ?? label) : label,
      path: `/${segments.slice(0, index + 1).join('/')}`,
    })),
  ];
});
const {
  request: nameModal,
  error: nameModalError,
  isSubmitting: isNameModalSubmitting,
  title: nameModalTitle,
  initialName: nameModalInitialName,
  hint: nameModalHint,
  requireExtension: requiresFileExtension,
  submitLabel: nameModalSubmitLabel,
  open: openNameModal,
  close: closeNameModal,
  clearError: clearNameModalError,
  submit: submitName,
} = useNameDialog({
  directory: () => selectedFolderPath.value,
  createFolder,
  createFile,
  rename: renameFile,
  done: reportDone,
});
const {
  action: transferAction,
  files: moveDialogFiles,
  isOpen: isMoveDialogOpen,
  isSubmitting: isMoveDialogSubmitting,
  request: requestTransfer,
  close: closeMoveDialog,
  submit: submitMove,
} = useTransferDialog({
  transfer: transferToDestination,
  resolveConflicts: requestConflictResolution,
  confirmOperation: requestConfirmation,
  done: reportDone,
  failed: (reason) => {
    notice.value = errorMessage(reason);
  },
});

provideDesktopExplorerContext({
  breadcrumbs,
  canGoBack,
  canGoUp,
  canMutateCurrentPath,
  files: visibleFiles,
  isListLoading,
  isComputerRoot,
  isMutating,
  isNarrowDesktop,
  isMobileSidebar,
  isSidebarCollapsed,
  search,
  searchSummary,
  selectedFolderName,
  sortBy,
  viewMode,
  volumes,
  createFolder: createFolderAtCurrent,
  createFile: createFileAtCurrent,
  copyToClipboard,
  cutToClipboard,
  activeNavigation,
  fileAction: handleFileAction,
  fileActions: handleFilesAction,
  navigate: navigateTo,
  goBack,
  goHome: () => navigateTo('/'),
  goUp,
  openArchive,
  selectNavigation,
  openSettings: () => (isSettingsOpen.value = true),
  refreshFolders: async () => {
    await loadFolderTree();
    await refreshStorage();
  },
  openSidebar: () => (isSidebarOpen.value = true),
  moveFilesToDestination,
  pasteClipboard,
  requestMove,
  upload: handleUpload,
});

function toggleSidebar() {
  if (isMobileSidebar.value) {
    isSidebarOpen.value = !isSidebarOpen.value;
  } else {
    isSidebarCollapsed.value = !isSidebarCollapsed.value;
  }
}

function closeSidebar() {
  isSidebarOpen.value = false;
}

function openArchive(file: FileEntry) {
  archiveFile.value = file;
}

async function handleFileAction(action: FileAction, file: FileEntry) {
  if (action === 'rename') {
    openRenameModal(file);
    return;
  }
  if (action === 'move' || action === 'copy') {
    requestTransfer(action, [file]);
    return;
  }
  await runOperation(() => perform(action, file, confirmDeletion));
}

async function handleFilesAction(action: FileAction, files: FileEntry[]) {
  if (action === 'rename') {
    if (files.length === 1) {
      openRenameModal(files[0]);
    }
    return;
  }
  if (action === 'move' || action === 'copy') {
    requestTransfer(action, files);
    return;
  }
  await runOperation(() => performMany(action, files, confirmDeletion));
}

function copyToClipboard(files: FileEntry[]) {
  copyFiles(files);
  notice.value = t.value.copiedToClipboard.replace('{count}', String(files.length));
}

function cutToClipboard(files: FileEntry[]) {
  cutFiles(files);
  notice.value = t.value.cutToClipboard.replace('{count}', String(files.length));
}

async function pasteClipboard() {
  const pending = clipboard.value;
  if (!pending) {
    return;
  }
  try {
    const message = await transferToDestination(
      pending.mode === 'cut' ? 'move' : 'copy',
      pending.files,
      selectedFolderPath.value,
      requestConflictResolution,
      requestConfirmation,
    );
    if (message) {
      reportDone(t.value.pasted.replace('{count}', String(pending.files.length)));
    }
    if (pending.mode === 'cut') {
      clearClipboard();
    }
  } catch (error) {
    notice.value = errorMessage(error);
  }
}

async function moveFilesToDestination(files: FileEntry[], destination: string) {
  if (files.length === 0) {
    return;
  }
  await runOperation(() =>
    transferToDestination(
      'move',
      files,
      destination,
      requestConflictResolution,
      requestConfirmation,
    ),
  );
}

function requestMove(files: FileEntry[]) {
  requestTransfer('move', files);
}

/** Deletions ask for confirmation unless disabled in the settings. Overwrites always ask. */
function confirmDeletion(request: ConfirmationRequest) {
  return preferences.value.confirmBeforeDelete
    ? requestConfirmation(request)
    : Promise.resolve(true);
}

function createFolderAtCurrent() {
  openNameModal('create');
}

function createFileAtCurrent() {
  openNameModal('create-file');
}

function openRenameModal(file: FileEntry) {
  openNameModal('rename', file);
}

async function handleUpload(files: FileList) {
  await runOperation(() => upload(selectedFolderPath.value, files));
}

function navigateTo(path: string, name?: string) {
  activeNavigation.value = 'all-files';
  selectedFolderPath.value = path;
  const segment = path.split('/').findLast(Boolean);
  selectedFolderName.value =
    name ??
    volumes.value.find((volume) => volume.id === segment)?.name ??
    segment ??
    nasRootName.value;
  void load(path);
}

function goUp() {
  if (canGoUp.value) {
    navigateTo(selectedFolderPath.value.replace(/\/[^/]+$/, '') || '/');
  }
}

let filesLocation: { path: string; name: string } | null = null;

function selectNavigation(navigation: DesktopNavigation) {
  const leaving = activeNavigation.value;
  search.value = '';
  if (navigation !== 'all-files') {
    if (leaving === 'all-files') {
      filesLocation = { path: selectedFolderPath.value, name: selectedFolderName.value };
    }
    activeNavigation.value = navigation;
    selectedFolderName.value = navigationName(navigation);
    selectedFolderPath.value = '/';
    if (navigation === 'shared') {
      void loadShares();
    }
  } else if (leaving !== 'all-files' && filesLocation) {
    navigateTo(filesLocation.path, filesLocation.name);
  } else {
    activeNavigation.value = navigation;
    selectedFolderName.value = nasRootName.value;
    selectedFolderPath.value = '/';
    void load('/');
  }
  closeSidebar();
}

function selectFolder(folder: FolderNode) {
  navigateTo(folder.path, folder.name);
  closeSidebar();
}

function closeTopmostLayer(event: KeyboardEvent) {
  if (event.key !== 'Escape') {
    return;
  }
  if (isSettingsOpen.value) {
    isSettingsOpen.value = false;
  } else if (isSidebarOpen.value) {
    closeSidebar();
  }
}

watch(search, (query) => {
  triggerListLoading(160);
  void searchFilesystem(query);
});

watch(isMobileSidebar, (isMobile) => {
  if (!isMobile) {
    closeSidebar();
  }
});

onMounted(() => {
  window.addEventListener('keydown', closeTopmostLayer);
  void loadFolderTree();
  void loadTrashSettings();
});

onBeforeUnmount(() => window.removeEventListener('keydown', closeTopmostLayer));

</script>

<template>
  <div
    class="app_shell"
    :class="{
      sidebar_open: isSidebarOpen,
      sidebar_collapsed: isSidebarCollapsed,
      compact_list: preferences.compactList,
      colored_navigation: preferences.coloredNavigation,
    }"
  >
    <div class="app_content">
      <AsideMenu
        :folder-nodes="folderNodes"
        :is-collapsed="isSidebarCollapsed"
        :is-open="isSidebarOpen"
        :active-navigation="activeNavigation"
        :selected-folder-path="selectedFolderPath"
        @close="closeSidebar"
        @select-folder="selectFolder"
        @select-navigation="selectNavigation"
        @toggle="toggleSidebar"
      />

      <MainView />
    </div>

    <div v-if="isSidebarOpen && isMobileSidebar" class="overlay" @click="closeSidebar"></div>

    <p v-if="filesystemError" role="alert" class="toast">{{ filesystemError }}</p>
    <p v-if="notice" class="toast" @click="notice = ''">{{ notice }}</p>
    <TransferProgress :transfer="transfer" />

    <SettingsModal :open="isSettingsOpen" @close="isSettingsOpen = false" />

    <ArchiveDialog :archive="archiveFile" @close="archiveFile = null" />

    <MoveDialog
      :open="isMoveDialogOpen"
      :action="transferAction"
      :files="moveDialogFiles"
      :folder-nodes="folderNodes"
      :current-path="selectedFolderPath"
      :is-submitting="isMoveDialogSubmitting"
      @close="closeMoveDialog"
      @confirm="submitMove"
    />

    <ConflictDialog
      :open="isConflictDialogOpen"
      :conflicts="conflicts"
      @close="cancelConflictResolution"
      @confirm="resolveConflicts"
    />

    <ConfirmDialog
      :open="Boolean(confirmationRequest)"
      :title="confirmationRequest?.title ?? ''"
      :message="confirmationRequest?.message ?? ''"
      :confirm-label="confirmationRequest?.confirmLabel ?? ''"
      :cancel-label="confirmationRequest?.cancelLabel ?? ''"
      @close="cancelConfirmation"
      @confirm="resolveConfirmation(true)"
    />

    <FileNameModal
      :open="Boolean(nameModal)"
      :title="nameModalTitle"
      :initial-name="nameModalInitialName"
      :hint="nameModalHint"
      :require-extension="requiresFileExtension"
      :submit-label="nameModalSubmitLabel"
      :error="nameModalError"
      :is-submitting="isNameModalSubmitting"
      @close="closeNameModal"
      @submit="submitName"
      @clear-error="clearNameModalError"
    />
  </div>
</template>

<style scoped lang="scss">

.app_shell {
  @extend %fx_column;
  position: relative;
  width: 100%;
  height: 100vh;
  min-height: 0;
  overflow: hidden;
  overscroll-behavior: none;
  color: var(--text);
  background: var(--nas-app-content, var(--bg));
}

.app_content {
  display: flex;
  align-items: stretch;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  flex: 1;
}

.toast {
  position: fixed;
  z-index: 30;
  right: 20px;
  bottom: 20px;
  max-width: min(360px, calc(100vw - 40px));
  margin: 0;
  padding: 12px 16px;
  border-radius: 10px;
  color: #fff;
  background: #273044;
  box-shadow: var(--shadow);
  font-size: 12px;
}

.overlay {
  @media (max-width: 680px) {
    display: block;
  }
}

</style>
