<script setup lang="ts">

import { computed, ref } from 'vue';
import chevronRightIcon from '@/assets/icons/chevron-right.svg?url';
import moreIcon from '@/assets/icons/more.svg?url';
import searchIcon from '@/assets/icons/search.svg?url';
import shareIcon from '@/assets/icons/share.svg?url';
import starFilledIcon from '@/assets/icons/star-filled.svg?url';
import starIcon from '@/assets/icons/star.svg?url';
import storageIcon from '@/assets/icons/storage.svg?url';
import folderIcon from '@/assets/icons/thumbnail-folder.svg?url';
import ContextMenu from '@/components/common/ContextMenu.vue';
import EmptyPlaceholder from '@/components/common/EmptyPlaceholder.vue';
import FileThumbnail from '@/components/common/FileThumbnail.vue';
import LoadingSkeleton from '@/components/common/LoadingSkeleton.vue';
import ShareModal from '@/components/common/ShareModal.vue';
import {
  useDesktopExplorerContext,
  type DesktopContextAction,
} from '@/composables/useDesktopExplorerContext';
import { useFileClipboard } from '@/composables/useFileClipboard';
import {
  clearDraggedFiles,
  getDraggedFiles,
  isValidDropDestination,
  setDraggedFiles,
} from '@/composables/useFileDragAndDrop';
import { useFavorites } from '@/composables/useFavorites';
import { useI18n } from '@/i18n';
import { nasContextActive } from '@/composables/useNasLauncherContext';
import { formatModified } from '@/services/filesystem';
import { notifyNasShell, requestFolderShortcut } from '@/services/nasShell';
import type { FileEntry } from '@/types/files';
import type { VolumeKind } from '@/types/storage';
import formatSize from '@/utils/fileUtils';
import { getDisplayFileName } from '@/utils/fileDisplay';
import { showsDetails, usePreferences } from '@/composables/usePreferences';
import { useMediaQuery } from '@/composables/useViewport';

const props = defineProps<{
  selectedFiles: FileEntry[];
}>();

const emit = defineEmits<{
  'select-files': [files: FileEntry[]];
}>();

const {
  activeNavigation,
  copyToClipboard,
  cutToClipboard,
  fileActions,
  files,
  isComputerRoot,
  isListLoading,
  moveFilesToDestination,
  navigate,
  pasteClipboard,
  requestMove,
  search,
  viewMode,
  volumes,
} = useDesktopExplorerContext();
const { isFavorite, toggleFavorites } = useFavorites();
const { t } = useI18n();
const { preferences } = usePreferences();
const lastSelectedPath = ref<string | null>(null);
const contextFile = ref<FileEntry | null>(null);
const contextFiles = ref<FileEntry[]>([]);
const contextPosition = ref({ x: 0, y: 0 });
const isContextMenuOpen = ref(false);
const dropTargetPath = ref<string | null>(null);
const shortcutNotice = ref('');
const { canPaste } = useFileClipboard();
const sharedFolder = ref<FileEntry | null>(null);

/** What the list says when it has nothing, after where the person is. */
const emptyState = computed(() => {
  const texts = t.value;
  if (search.value) {
    return { icon: searchIcon, title: texts.noResults, text: texts.noResultsHint };
  }
  if (isComputerRoot.value && nasContextActive.value) {
    return { icon: storageIcon, title: texts.noDataVolumes, text: '' };
  }
  if (activeNavigation.value === 'favorites') {
    return { icon: starIcon, title: texts.noFavorites, text: texts.noFavoritesHint };
  }
  if (activeNavigation.value === 'shared') {
    return { icon: shareIcon, title: texts.noShares, text: texts.noSharesHint };
  }
  return { icon: folderIcon, title: texts.emptyFolder, text: texts.emptyFolderBrowseHint };
});

/** Says what a change of a share did, in the launcher when it is there. */
function reportShare(message: string) {
  if (!notifyNasShell(message, '', 'success')) {
    shortcutNotice.value = message;
  }
}

const DRIVE_KINDS: VolumeKind[] = ['device', 'external', 'network'];
const groupTitles = computed<Record<VolumeKind, string>>(() => ({
  device: t.value.dataDisks,
  external: t.value.externalDisks,
  network: t.value.networkDisks,
}));
const driveLabels = computed<Record<VolumeKind, string>>(() => ({
  device: t.value.diskDrive,
  external: t.value.externalDrive,
  network: t.value.networkDrive,
}));
// The root of the NAS lists its volumes: the data disks first, then the removable ones and the
// shares of the network, each group only when it has a volume.
const driveGroups = computed(() => {
  const kindOf = (file: FileEntry) =>
    volumes.value.find((volume) => volume.id === file.path.split('/').find(Boolean))?.kind ??
    'device';
  return DRIVE_KINDS.map((kind) => ({
    kind,
    files: files.value.filter((file) => kindOf(file) === kind),
  })).filter((group) => group.files.length > 0);
});
const { openArchive } = useDesktopExplorerContext();

function fileTypeLabel(file: FileEntry) {
  if (file.kind === 'folder') {
    return t.value.folders;
  }
  return t.value.file;
}

// A finger has no double click: on a touch screen a tap opens a folder or an archive, and on a
// file it selects it, which shows its details and their actions.
const { isMobileViewport: isTouch } = useMediaQuery('(pointer: coarse)');

// Without a details panel in this view a click opens a folder: there is nothing to show of it.
// Files still open with a double click.
function handleFileClick(file: FileEntry, event: MouseEvent) {
  const plain = !event.shiftKey && !event.ctrlKey && !event.metaKey;
  const opens = file.kind === 'folder' || file.kind === 'archive';
  const opensAtOnce =
    (isTouch.value && opens) ||
    (file.kind === 'folder' && !showsDetails(preferences.value, viewMode.value));
  if (plain && opensAtOnce) {
    handleFileDoubleClick(file);
    return;
  }
  selectFile(file, event);
}

function favoriteIcon(file: FileEntry) {
  return isFavorite(file.path) ? starFilledIcon : starIcon;
}

function favoriteLabel(file: FileEntry) {
  return isFavorite(file.path) ? t.value.removeFavorite : t.value.addFavorite;
}

function toggleFileFavorite(file: FileEntry) {
  toggleFavorites([file]);
}

function handleFileDoubleClick(file: FileEntry) {
  if (file.kind === 'archive') {
    void openArchive(file);
    return;
  }
  if (file.kind !== 'folder') {
    return;
  }
  clearSelection();
  navigate(file.path, file.name);
}

function handleDragStart(file: FileEntry, event: DragEvent) {
  const draggedFiles = isFileSelected(file) ? [...props.selectedFiles] : [file];
  setDraggedFiles(event, draggedFiles);
  dropTargetPath.value = null;
}

function handleDragEnd() {
  dropTargetPath.value = null;
  clearDraggedFiles();
}

function handleDragOver(file: FileEntry, event: DragEvent) {
  const draggedFiles = getDraggedFiles(event);
  if (!isValidDropDestination(draggedFiles, file)) {
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'none';
    }
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
  dropTargetPath.value = file.path;
}

function handleDragLeave(file: FileEntry, event: DragEvent) {
  const relatedTarget = event.relatedTarget;
  if (
    relatedTarget instanceof Node &&
    (event.currentTarget as HTMLElement).contains(relatedTarget)
  ) {
    return;
  }
  if (dropTargetPath.value === file.path) {
    dropTargetPath.value = null;
  }
}

function handleDrop(file: FileEntry, event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();
  const draggedFiles = getDraggedFiles(event);
  dropTargetPath.value = null;
  if (!isValidDropDestination(draggedFiles, file)) {
    return;
  }

  lastSelectedPath.value = null;
  emit('select-files', []);
  void moveFilesToDestination(draggedFiles, file.path);
}

function openContextMenu(file: FileEntry, event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  const isSelected = isFileSelected(file);
  if (!isSelected) {
    lastSelectedPath.value = file.path;
    emit('select-files', [file]);
  }
  contextFiles.value = isSelected ? [...props.selectedFiles] : [file];
  contextFile.value = file;
  isContextMenuOpen.value = true;
  contextPosition.value = {
    x: Math.max(12, Math.min(event.clientX, window.innerWidth - 232)),
    y: Math.max(12, Math.min(event.clientY, window.innerHeight - 370)),
  };
}

function selectFile(file: FileEntry, event: MouseEvent) {
  const fileIndex = files.value.findIndex((entry) => entry.path === file.path);
  if (fileIndex < 0) {
    return;
  }

  const anchorIndex = files.value.findIndex((entry) => entry.path === lastSelectedPath.value);
  const isToggleSelection = event.ctrlKey || event.metaKey;
  let nextSelection: FileEntry[];

  if (event.shiftKey && anchorIndex >= 0) {
    const rangeStart = Math.min(anchorIndex, fileIndex);
    const rangeEnd = Math.max(anchorIndex, fileIndex);
    const range = files.value.slice(rangeStart, rangeEnd + 1);
    if (isToggleSelection) {
      nextSelection = mergeSelection(props.selectedFiles, range);
    } else {
      nextSelection = range;
    }
  } else if (isToggleSelection) {
    nextSelection = toggleSelection(props.selectedFiles, file);
  } else {
    nextSelection = [file];
  }

  lastSelectedPath.value = file.path;
  emit('select-files', nextSelection);
}

function openEmptyContextMenu(event: MouseEvent) {
  if (event.target !== event.currentTarget) {
    return;
  }
  contextFile.value = null;
  contextFiles.value = [];
  contextPosition.value = {
    x: Math.max(12, Math.min(event.clientX, window.innerWidth - 232)),
    y: Math.max(12, Math.min(event.clientY, window.innerHeight - 270)),
  };
  isContextMenuOpen.value = true;
}

function closeContextMenu() {
  contextFile.value = null;
  contextFiles.value = [];
  isContextMenuOpen.value = false;
}

function isFileSelected(file: FileEntry) {
  return props.selectedFiles.some((selectedFile) => selectedFile.path === file.path);
}

function toggleSelection(selection: FileEntry[], file: FileEntry) {
  if (selection.some((selectedFile) => selectedFile.path === file.path)) {
    return selection.filter((selectedFile) => selectedFile.path !== file.path);
  }
  return [...selection, file];
}

function mergeSelection(selection: FileEntry[], additionalFiles: FileEntry[]) {
  const merged = new Map(selection.map((file) => [file.path, file]));
  for (const file of additionalFiles) {
    merged.set(file.path, file);
  }
  return files.value.filter((file) => merged.has(file.path));
}

function clearSelection() {
  lastSelectedPath.value = null;
  emit('select-files', []);
}

/** Adds a folder to the launcher desktop; the launcher notifies the outcome when it can. */
async function addDesktopShortcut(folder: FileEntry) {
  const result = await requestFolderShortcut(folder.path, folder.name);
  if (!result.success) {
    shortcutNotice.value = t.value.desktopShortcutFailed;
  } else if (!notifyNasShell(t.value.desktopShortcutAdded, '', 'success')) {
    shortcutNotice.value = t.value.desktopShortcutAdded;
  }
}

async function handleContextAction(action: DesktopContextAction) {
  const file = contextFile.value;
  const selectedFiles = contextFiles.value;
  if (action === 'paste') {
    await pasteClipboard();
    return;
  }
  if (action === 'copy-to-clipboard') {
    copyToClipboard(selectedFiles);
    return;
  }
  if (action === 'cut-to-clipboard') {
    cutToClipboard(selectedFiles);
    return;
  }
  if (!file || selectedFiles.length === 0) {
    return;
  }
  if (action === 'shortcut') {
    if (file.kind === 'folder') {
      await addDesktopShortcut(file);
    }
    closeContextMenu();
    return;
  }
  if (action === 'share') {
    sharedFolder.value = file.kind === 'folder' ? file : null;
    closeContextMenu();
    return;
  }
  if (action === 'favorite') {
    toggleFavorites(selectedFiles);
    contextFile.value = null;
    contextFiles.value = [];
    return;
  }
  if (action === 'move') {
    requestMove(selectedFiles);
    closeContextMenu();
    return;
  }

  await fileActions(action, selectedFiles);
  clearSelection();
  closeContextMenu();
}

</script>

<template>
  <section
    class="file_browser"
    :aria-label="t.allFiles"
    @contextmenu.prevent="openEmptyContextMenu"
  >
    <output v-if="shortcutNotice" class="shortcut_notice">{{ shortcutNotice }}</output>
    <LoadingSkeleton v-if="isListLoading" />

    <EmptyPlaceholder
      v-else-if="files.length === 0"
      class="file_browser_empty"
      :icon="emptyState.icon"
      :title="emptyState.title"
      :text="emptyState.text"
      testid="file_browser_empty"
    />

    <!-- NAS volume view, one group per kind of volume -->
    <div v-else-if="isComputerRoot" class="computer_view">
      <section
        v-for="group in driveGroups"
        :key="group.kind"
        class="drive_group"
        :aria-label="groupTitles[group.kind]"
        :data-testid="`drive_group_${group.kind}`"
      >
        <h2 class="drive_group_title">{{ groupTitles[group.kind] }}</h2>
        <div class="drive_grid">
          <button
            v-for="file in group.files"
            :key="file.path"
            class="computer_drive_card"
            :class="{
              selected: isFileSelected(file),
              drop_target: dropTargetPath === file.path,
            }"
            :aria-selected="isFileSelected(file)"
            :draggable="!isTouch"
            @click="handleFileClick(file, $event)"
            @dblclick="handleFileDoubleClick(file)"
            @contextmenu="openContextMenu(file, $event)"
            @dragstart="handleDragStart(file, $event)"
            @dragend="handleDragEnd"
            @dragover="handleDragOver(file, $event)"
            @dragleave="handleDragLeave(file, $event)"
            @drop="handleDrop(file, $event)"
          >
            <span class="computer_drive_icon" aria-hidden="true">
              <img class="icon_asset" :src="storageIcon" alt="" />
            </span>
            <span class="computer_drive_copy">
              <strong>{{ getDisplayFileName(file, preferences.showFileExtensions) }}</strong>
              <small>{{ driveLabels[group.kind] }}</small>
            </span>
            <span class="computer_drive_chevron" aria-hidden="true">
              <img class="icon_asset" :src="chevronRightIcon" alt="" />
            </span>
          </button>
        </div>
      </section>
    </div>

    <template v-else-if="viewMode === 'list'">
      <div class="list_header" aria-hidden="true">
        <span>{{ t.name }}</span>
        <span>{{ t.type }}</span>
        <span>{{ t.modified }}</span>
        <span>{{ t.size }}</span>
        <span></span>
      </div>
      <div class="file_list">
        <button
          v-for="file in files"
          :key="file.path"
          class="file_row"
          :class="{
            selected: isFileSelected(file),
            drop_target: dropTargetPath === file.path,
          }"
          :aria-selected="isFileSelected(file)"
          :draggable="!isTouch"
          @click="handleFileClick(file, $event)"
          @dblclick="handleFileDoubleClick(file)"
          @contextmenu="openContextMenu(file, $event)"
          @dragstart="handleDragStart(file, $event)"
          @dragend="handleDragEnd"
          @dragover="handleDragOver(file, $event)"
          @dragleave="handleDragLeave(file, $event)"
          @drop="handleDrop(file, $event)"
        >
          <span class="file_name_cell">
            <FileThumbnail class="file_icon" :file="file" />
            <strong>{{ getDisplayFileName(file, preferences.showFileExtensions) }}</strong>
            <span
              class="favorite_badge"
              aria-hidden="true"
              :title="favoriteLabel(file)"
              @click.stop="toggleFileFavorite(file)"
            >
              <img class="icon_asset" :src="favoriteIcon(file)" alt="" aria-hidden="true" />
            </span>
          </span>
          <span class="muted">{{ fileTypeLabel(file) }}</span>
          <span class="muted">{{ formatModified(file.modified) }}</span>
          <span class="muted">{{ formatSize(file.size) }}</span>
          <span
            class="row_menu"
            :aria-label="t.fileActions"
            @click.stop="openContextMenu(file, $event)"
          >
            <img class="icon_asset" :src="moreIcon" alt="" aria-hidden="true" />
          </span>
        </button>
      </div>
    </template>

    <div v-else class="file_grid">
      <button
        v-for="file in files"
        :key="file.path"
        class="file_card"
        :class="{
          selected: isFileSelected(file),
          drop_target: dropTargetPath === file.path,
        }"
        :aria-selected="isFileSelected(file)"
        :draggable="!isTouch"
        @click="handleFileClick(file, $event)"
        @dblclick="handleFileDoubleClick(file)"
        @contextmenu="openContextMenu(file, $event)"
        @dragstart="handleDragStart(file, $event)"
        @dragend="handleDragEnd"
        @dragover="handleDragOver(file, $event)"
        @dragleave="handleDragLeave(file, $event)"
        @drop="handleDrop(file, $event)"
      >
        <FileThumbnail class="file_card_thumbnail" :file="file" />
        <strong>{{ getDisplayFileName(file, preferences.showFileExtensions) }}</strong>
        <small>{{ formatModified(file.modified) }}</small>
        <span
          class="favorite_badge preview_favorite_badge"
          aria-hidden="true"
          :title="favoriteLabel(file)"
          @click.stop="toggleFileFavorite(file)"
        >
          <img class="icon_asset" :src="favoriteIcon(file)" alt="" aria-hidden="true" />
        </span>
        <span
          class="row_menu"
          :aria-label="t.fileActions"
          @click.stop="openContextMenu(file, $event)"
        >
          <img class="icon_asset" :src="moreIcon" alt="" aria-hidden="true" />
        </span>
      </button>
    </div>
  </section>

  <ContextMenu
    v-if="isContextMenuOpen"
    :file="contextFile"
    :files="contextFiles"
    :x="contextPosition.x"
    :y="contextPosition.y"
    :can-paste="canPaste"
    @action="handleContextAction"
    @close="closeContextMenu"
  />

  <ShareModal
    :open="Boolean(sharedFolder)"
    :folder="sharedFolder"
    @close="sharedFolder = null"
    @done="reportShare"
  />
</template>

<style scoped lang="scss">

.file_browser {
  min-width: 0;
  min-height: 0;
  height: 100%;
  // Room above the first row: a card lifted on hover would be cut by the scrolling edge.
  padding-top: 6px;
  overflow-y: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.file_browser_empty {
  min-height: 320px;
  margin: 4px 0 16px;
}

.list_header,
.file_row {
  display: grid;
  grid-template-columns:
    minmax(220px, 1.8fr) minmax(80px, 0.7fr) minmax(120px, 1fr) minmax(70px, 0.6fr)
    30px;
  align-items: center;
  gap: 14px;
}

.list_header {
  position: sticky;
  z-index: 2;
  top: 0;
  min-height: 40px;
  padding: 0 16px 9px;
  color: var(--muted);
  background: var(--bg);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.file_list {
  display: grid;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
}

.file_row {
  width: 100%;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  background: var(--surface);
  text-align: left;
  transition: background 0.15s ease;

  &:last-child {
    border-bottom: 0;
  }

  &:hover,
  &.selected {
    background: var(--surface-soft);
  }

  &.drop_target {
    border-color: var(--accent);
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
}

.file_name_cell {
  @extend %fx_row_center;
  min-width: 0;
  gap: 11px;
}

.file_name_cell strong,
.file_card strong {
  @extend %text_ellipsis;
}

.favorite_badge {
  display: grid;
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  place-items: center;
  border-radius: 6px;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    background: var(--accent-soft);
  }

  .icon_asset {
    width: 16px;
    height: 16px;
  }
}

.file_icon {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  border-radius: 9px;
  font-size: 16px;
}

.file_row .muted,
.file_card small {
  @extend %text_ellipsis;
  font-size: 11px;
}

.file_grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
}

.file_card {
  position: relative;
  display: grid;
  min-width: 0;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 14px;
  color: var(--text);
  background: var(--surface);
  text-align: left;

  &:hover,
  &.selected {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    background: var(--surface-soft);
  }

  &_thumbnail {
    width: 100%;
    height: 112px;
    border-radius: 10px;
    font-size: 32px;
  }

  .row_menu {
    position: absolute;
    top: 8px;
    right: 8px;
    padding: 2px 5px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--surface) 85%, transparent);
  }

  &.drop_target {
    border-color: var(--accent);
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .preview_favorite_badge {
    position: absolute;
    top: 8px;
    right: 38px;
    background: color-mix(in srgb, var(--surface) 85%, transparent);
  }
}

.computer_view {
  display: grid;
  gap: 28px;
  align-content: start;
}

.drive_group_title {
  margin: 0 0 12px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 750;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.drive_grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
  align-content: start;
}

.computer_drive_card {
  display: flex;
  min-width: 0;
  min-height: 104px;
  align-items: center;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: 16px;
  color: var(--text);
  background: var(--surface);
  text-align: left;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.15s ease;

  &:hover,
  &.selected {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
    background: var(--surface-soft);
    transform: translateY(-1px);
  }

  &.drop_target {
    border-color: var(--accent);
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
}

.computer_drive_icon {
  display: grid;
  width: 52px;
  height: 52px;
  flex: 0 0 52px;
  place-items: center;
  border-radius: 14px;
  background: var(--accent-soft);

  .icon_asset {
    width: 30px;
    height: 30px;
  }
}

.computer_drive_copy {
  display: grid;
  min-width: 0;
  gap: 5px;

  strong {
    @extend %text_ellipsis;
    font-size: 16px;
  }

  small {
    color: var(--muted);
    font-size: 11px;
  }
}

.computer_drive_chevron {
  display: grid;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  margin-left: auto;
  place-items: center;

  .icon_asset {
    width: 18px;
    height: 18px;
  }
}

.row_menu {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;

  .icon_asset {
    width: 18px;
    height: 18px;
  }
}

@media (max-width: 900px) {
  .list_header,
  .file_row {
    grid-template-columns: minmax(180px, 1.6fr) minmax(70px, 0.7fr) minmax(105px, 1fr) 30px;
  }

  .list_header span:nth-child(4),
  .file_row > span:nth-child(4) {
    display: none;
  }
}

@media (max-width: 720px) {
  .list_header {
    display: none;
  }

  .file_row {
    grid-template-columns: minmax(0, 1fr) 30px;
    gap: 10px;
  }

  .file_row > span:nth-child(2),
  .file_row > span:nth-child(3) {
    display: none;
  }
}

</style>
