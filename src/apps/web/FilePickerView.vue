<script setup lang="ts">

import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import backIcon from '@/assets/icons/back.svg?url';
import closeIcon from '@/assets/icons/close.svg?url';
import homeIcon from '@/assets/icons/home.svg?url';
import folderIcon from '@/assets/icons/thumbnail-folder.svg?url';
import fileIcon from '@/assets/icons/thumbnail-file.svg?url';
import gridIcon from '@/assets/icons/grid.svg?url';
import listIcon from '@/assets/icons/list.svg?url';
import newFolderIcon from '@/assets/icons/new-folder.svg?url';
import searchIcon from '@/assets/icons/search.svg?url';
import EmptyPlaceholder from '@/components/common/EmptyPlaceholder.vue';
import FileNameModal from '@/components/common/FileNameModal.vue';
import FileThumbnail from '@/components/common/FileThumbnail.vue';
import { joinPath } from '@/composables/useFileOperations';
import { useI18n } from '@/i18n';
import {
  createDirectory,
  createFile,
  listDirectory,
  listVolumes,
  searchFilesystem,
} from '@/services/filesystem';
import { sendPickedFiles } from '@/services/nasShell';
import type { FileEntry } from '@/types/files';
import type { VolumeInfo } from '@/types/storage';

const { t } = useI18n();
const query = new URL(window.location.href).searchParams;
const token = query.get('nasPicker') ?? '';
const multiple = query.get('multiple') === '1';
// The caller wants one folder: the one being browsed when the user confirms.
const folder = query.get('folder') === '1';
const extensions = (query.get('extensions') ?? '')
  .split(',')
  .filter((extension) => /^\.[a-z0-9]{1,10}$/i.test(extension));
const directory = query.get('directory');
const path = ref('/');
const entries = ref<FileEntry[]>([]);
const selected = ref<FileEntry[]>([]);
const loading = ref(false);
const error = ref('');
const searchQuery = ref('');
// The disks are folders named by their id: the volumes give the names to show.
const volumes = ref<VolumeInfo[]>([]);
const view = ref<'list' | 'grid'>('list');
// What the name window creates in the folder being browsed, if it is open.
const creating = ref<'folder' | 'file' | null>(null);
const createError = ref('');
const isCreating = ref(false);
let loadVersion = 0;

const visibleEntries = computed(() =>
  entries.value.filter(
    (entry) =>
      entry.kind === 'folder' ||
      (!folder &&
        (!extensions.length ||
          extensions.some((extension) =>
            entry.name.toLowerCase().endsWith(extension.toLowerCase()),
          ))),
  ),
);

/** The name of a segment of a path, the name of its disk for the first one. */
function segmentName(segment: string, index: number) {
  return index === 0
    ? (volumes.value.find((volume) => volume.id === segment)?.name ?? segment)
    : segment;
}

/** A path as the user reads it, with the name of its disk. */
function readablePath(location: string) {
  return `/${location.split('/').filter(Boolean).map(segmentName).join('/')}`;
}

// The folders from the start down to the one being browsed; the start is the home button.
const breadcrumbs = computed(() => {
  const parts = path.value.split('/').filter(Boolean);
  return parts.map((segment, index) => ({
    name: segmentName(segment, index),
    path: `/${parts.slice(0, index + 1).join('/')}`,
  }));
});

const folderName = computed(() => breadcrumbs.value.at(-1)?.name ?? t.value.thisPc);

const parentPath = computed(() => {
  const parts = path.value.split('/').filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join('/')}` : '/';
});

async function openFolder(nextPath: string) {
  const version = ++loadVersion;
  loading.value = true;
  error.value = '';
  selected.value = [];
  searchQuery.value = '';
  try {
    const result = await listDirectory(nextPath);
    if (version === loadVersion) {
      entries.value = result;
      path.value = nextPath;
    }
  } catch (reason) {
    if (version === loadVersion) {
      error.value = reason instanceof Error ? reason.message : t.value.loadFailed;
    }
  } finally {
    if (version === loadVersion) {
      loading.value = false;
    }
  }
}

async function search() {
  if (!searchQuery.value.trim()) {
    await openFolder(path.value);
    return;
  }
  const version = ++loadVersion;
  loading.value = true;
  error.value = '';
  selected.value = [];
  try {
    const result = await searchFilesystem(searchQuery.value.trim());
    if (version === loadVersion) {
      entries.value = result;
    }
  } catch {
    if (version === loadVersion) {
      error.value = t.value.searchFailed;
    }
  } finally {
    if (version === loadVersion) {
      loading.value = false;
    }
  }
}

function choose(entry: FileEntry) {
  if (entry.kind === 'folder') {
    void openFolder(entry.path);
    return;
  }
  if (!multiple) {
    selected.value = [entry];
    return;
  }
  selected.value = selected.value.some((file) => file.path === entry.path)
    ? selected.value.filter((file) => file.path !== entry.path)
    : [...selected.value, entry];
}

function startCreating(kind: 'folder' | 'file') {
  createError.value = '';
  creating.value = kind;
}

function closeCreating() {
  if (!isCreating.value) {
    creating.value = null;
  }
}

async function create(name: string) {
  const target = joinPath(path.value, name);
  isCreating.value = true;
  createError.value = '';
  try {
    await (creating.value === 'file' ? createFile(target) : createDirectory(target));
    creating.value = null;
    await openFolder(path.value);
  } catch (reason) {
    createError.value = reason instanceof Error ? reason.message : t.value.operationFailed;
  } finally {
    isCreating.value = false;
  }
}

function picked() {
  if (folder) {
    return [{ name: folderName.value, path: path.value }];
  }
  return selected.value.map((file) => ({
    name: file.name,
    path: file.path,
    download: `api/downloads?path=${encodeURIComponent(file.path.replace(/^\/+/, ''))}`,
  }));
}

function finish(cancelled: boolean) {
  sendPickedFiles(token, cancelled ? [] : picked(), cancelled);
}

// Escape closes the picker, as the cross does, unless the name window is open over it.
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !creating.value) {
    finish(true);
  }
}

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  void openFolder(directory?.startsWith('/') ? directory : '/');
  // Without them the disks keep their ids: nothing else depends on them.
  listVolumes()
    .then((found) => (volumes.value = found))
    .catch(() => undefined);
});

</script>

<template>
  <main class="app_surface file_picker">
    <header class="file_picker_header">
      <h1>{{ folder ? t.pickFolder : t.pickFiles }}</h1>
      <button
        class="icon_button file_picker_close"
        type="button"
        :aria-label="t.cancel"
        :title="t.cancel"
        data-testid="file_picker_close"
        @click="finish(true)"
      >
        <img class="icon_asset" :src="closeIcon" alt="" aria-hidden="true" />
      </button>
    </header>
    <div class="file_picker_toolbar">
      <div class="file_picker_place">
        <button
          class="icon_button"
          type="button"
          :aria-label="t.back"
          :title="t.back"
          :disabled="path === '/' || loading"
          @click="openFolder(parentPath)"
        >
          <img class="icon_asset" :src="backIcon" alt="" aria-hidden="true" />
        </button>
        <button
          class="icon_button"
          type="button"
          :aria-label="t.home"
          :title="t.home"
          :disabled="path === '/' || loading"
          data-testid="file_picker_home"
          @click="openFolder('/')"
        >
          <img class="icon_asset" :src="homeIcon" alt="" aria-hidden="true" />
        </button>
        <nav class="file_picker_crumbs" :aria-label="t.breadcrumbs" :title="readablePath(path)">
          <span class="file_picker_separator" aria-hidden="true">/</span>
          <template v-for="(crumb, index) in breadcrumbs" :key="crumb.path">
            <span v-if="index > 0" class="file_picker_separator" aria-hidden="true">/</span>
            <button
              class="file_picker_crumb"
              :class="{ current: index === breadcrumbs.length - 1 }"
              type="button"
              :aria-current="index === breadcrumbs.length - 1 ? 'location' : undefined"
              :disabled="loading"
              @click="openFolder(crumb.path)"
            >
              {{ crumb.name }}
            </button>
          </template>
        </nav>
      </div>
      <div class="file_picker_tools">
        <form class="search_box" @submit.prevent="search">
          <input
            v-model="searchQuery"
            name="picker_search"
            type="search"
            :aria-label="t.search"
            :placeholder="t.search"
          />
          <button
            class="icon_button"
            type="submit"
            :aria-label="t.search"
            :title="t.search"
            :disabled="loading"
          >
            <img class="icon_asset" :src="searchIcon" alt="" aria-hidden="true" />
          </button>
        </form>
        <span class="toolbar_divider" aria-hidden="true"></span>
        <button
          class="icon_button"
          type="button"
          :aria-label="t.newFolderAction"
          :title="t.newFolderAction"
          :disabled="path === '/' || loading"
          @click="startCreating('folder')"
        >
          <img class="icon_asset" :src="newFolderIcon" alt="" aria-hidden="true" />
        </button>
        <!-- A file made while choosing a folder would not show among the folders. -->
        <button
          v-if="!folder"
          class="icon_button"
          type="button"
          :aria-label="t.newFileAction"
          :title="t.newFileAction"
          :disabled="path === '/' || loading"
          @click="startCreating('file')"
        >
          <img class="icon_asset" :src="fileIcon" alt="" aria-hidden="true" />
        </button>
        <span class="toolbar_divider" aria-hidden="true"></span>
        <fieldset class="view_switcher">
          <legend class="visually_hidden">{{ t.listView }} / {{ t.gridView }}</legend>
          <button
            class="icon_button"
            :class="{ active: view === 'list' }"
            type="button"
            :aria-label="t.listView"
            :title="t.listView"
            :aria-pressed="view === 'list'"
            @click="view = 'list'"
          >
            <img class="icon_asset" :src="listIcon" alt="" aria-hidden="true" />
          </button>
          <button
            class="icon_button"
            :class="{ active: view === 'grid' }"
            type="button"
            :aria-label="t.gridView"
            :title="t.gridView"
            :aria-pressed="view === 'grid'"
            @click="view = 'grid'"
          >
            <img class="icon_asset" :src="gridIcon" alt="" aria-hidden="true" />
          </button>
        </fieldset>
      </div>
    </div>
    <p v-if="error" class="file_picker_error" role="alert">{{ error }}</p>
    <EmptyPlaceholder v-else-if="loading" :title="t.loadingList" loading />
    <EmptyPlaceholder
      v-else-if="visibleEntries.length === 0"
      :icon="searchQuery ? searchIcon : folderIcon"
      :title="searchQuery ? t.noResults : t.emptyFolder"
      :text="searchQuery ? t.noResultsHint : folder ? t.emptyFolderPick : t.emptyFolderHint"
      testid="file_picker_empty"
    />
    <ul v-else class="file_picker_list" :class="{ file_picker_grid: view === 'grid' }">
      <li v-for="entry in visibleEntries" :key="entry.path">
        <button
          class="button secondary"
          type="button"
          :aria-pressed="
            entry.kind === 'folder' ? undefined : selected.some((file) => file.path === entry.path)
          "
          @click="choose(entry)"
        >
          <FileThumbnail v-if="view === 'grid'" class="file_picker_thumbnail" :file="entry" />
          <img
            v-else
            :src="entry.kind === 'folder' ? folderIcon : fileIcon"
            alt=""
            aria-hidden="true"
          />
          <span>{{ entry.name }}</span>
          <small v-if="searchQuery">{{ readablePath(entry.path) }}</small>
        </button>
      </li>
    </ul>
    <footer>
      <span v-if="!folder" class="muted">
        {{ t.selectedFiles.replace('{count}', String(selected.length)) }}
      </span>
      <button class="button secondary" type="button" @click="finish(true)">{{ t.cancel }}</button>
      <button
        class="button primary"
        type="button"
        :disabled="folder ? loading || Boolean(error) : selected.length === 0"
        @click="finish(false)"
      >
        {{ folder ? t.chooseFolder : t.chooseFiles }}
      </button>
    </footer>
    <FileNameModal
      :open="Boolean(creating)"
      :title="creating === 'file' ? t.newFileName : t.newFolderName"
      :hint="creating === 'file' ? t.fileExtensionHint : ''"
      :require-extension="creating === 'file'"
      :submit-label="t.create"
      :error="createError"
      :is-submitting="isCreating"
      @close="closeCreating"
      @submit="create"
      @clear-error="createError = ''"
    />
  </main>
</template>

<style scoped lang="scss">

.file_picker {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  height: 100vh;
  padding: 20px 24px 24px;
  color: var(--text);
  background: var(--nas-app-content, var(--bg));

  &_header {
    @extend %fx_row_center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;

    h1 {
      margin: 0;
      font-size: 24px;
    }
  }

  &_close {
    flex: none;
    font-size: 18px;
  }

  &_toolbar {
    @extend %fx_row_center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px 16px;
    margin-bottom: 14px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);

    .icon_button:disabled {
      opacity: 0.45;
      cursor: default;
    }
  }

  &_place {
    @extend %fx_row_center;
    flex: 1 1 260px;
    gap: 4px;
    min-width: 0;
  }

  &_tools {
    @extend %fx_row_center;
    gap: 8px;
    margin-left: auto;

    .search_box {
      flex: 0 1 240px;
      padding-right: 2px;

      .icon_button {
        flex: 0 0 auto;
        width: 30px;
        height: 30px;
        font-size: 16px;
      }
    }
  }

  // The path as a trail: separators, the folders before muted, the current one marked.
  &_crumbs {
    @extend %fx_row_center;
    min-width: 0;
    gap: 6px;
    margin-left: 6px;
    overflow-x: auto;
    font-size: 14px;
    scrollbar-width: thin;
  }

  &_separator {
    flex: none;
    color: var(--muted);
    opacity: 0.6;
  }

  &_crumb {
    flex: 0 0 auto;
    max-width: 200px;
    padding: 3px 6px;
    overflow: hidden;
    border-radius: 6px;
    color: var(--muted);
    background: transparent;
    text-overflow: ellipsis;
    white-space: nowrap;

    &:hover:not(:disabled) {
      color: var(--text);
      background: var(--chosen-bg, var(--nas-hover));
    }

    &.current {
      color: var(--accent);
      font-weight: 600;
    }
  }

  &_list {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 0;
    overflow: auto;
    list-style: none;

    button {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 12px;
      width: 100%;
      min-height: 44px;
      text-align: left;
    }

    img {
      width: 22px;
      height: 22px;
    }

    li + li {
      margin-top: 4px;
    }
  }

  // The grid shows the preview of each file, the folders with their icon.
  &_grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    align-content: start;
    gap: 10px;

    li + li {
      margin-top: 0;
    }

    button {
      display: grid;
      justify-items: start;
      gap: 8px;
      min-height: 0;
      padding: 10px;
    }

    span {
      @extend %text_ellipsis;
      max-width: 100%;
    }
  }

  &_thumbnail {
    width: 100%;
    height: 96px;
    border-radius: 10px;
    font-size: 32px;
  }

  &_error {
    margin: 0 0 12px;
    color: var(--danger, var(--nas-error));
  }

  footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 14px;

    span {
      margin-right: auto;
    }
  }
}

</style>
