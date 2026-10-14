<script setup lang="ts">

import { computed, ref } from 'vue';
import addIcon from '@/assets/icons/add.svg?url';
import fileIcon from '@/assets/icons/thumbnail-file.svg?url';
import gridIcon from '@/assets/icons/grid.svg?url';
import listIcon from '@/assets/icons/list.svg?url';
import newFolderIcon from '@/assets/icons/new-folder.svg?url';
import searchIcon from '@/assets/icons/search.svg?url';
import { useDesktopExplorerContext } from '@/composables/useDesktopExplorerContext';
import type { FileSort } from '@/composables/useFileSorting';
import { useI18n } from '@/i18n';

const { t } = useI18n();
const {
  canMutateCurrentPath,
  isComputerRoot,
  files,
  createFolder,
  createFile,
  isMutating,
  search,
  searchSummary,
  sortBy,
  upload,
  viewMode,
} = useDesktopExplorerContext();

const uploadInput = ref<HTMLInputElement | null>(null);

const searchModel = computed({
  get: () => search.value,
  set: (value: string) => (search.value = value),
});

const viewModeModel = computed({
  get: () => viewMode.value,
  set: (value) => (viewMode.value = value),
});

function openUploadPicker() {
  uploadInput.value?.click();
}

function handleUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  if (!input.files) {
    return;
  }
  void upload(input.files);
  input.value = '';
}

function handleSortChange(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) {
    return;
  }
  if (!isFileSort(target.value)) {
    return;
  }
  sortBy.value = target.value;
}

function isFileSort(value: string): value is FileSort {
  return value === 'name' || value === 'modified' || value === 'size' || value === 'type';
}

</script>

<template>
  <div v-if="!isComputerRoot" class="workspace_toolbar">
    <div class="toolbar_search">
      <label class="search_box">
        <img class="icon_asset" :src="searchIcon" alt="" aria-hidden="true" />
        <input
          v-model="searchModel"
          name="search"
          type="search"
          :placeholder="t.search"
          :aria-label="t.search"
        />
      </label>
      <span v-if="searchSummary" class="search_summary">{{ searchSummary }}</span>
    </div>

    <span class="toolbar_divider" aria-hidden="true"></span>

    <div class="toolbar_group file_actions">
      <button
        class="icon_button toolbar_action"
        :aria-label="t.uploadFile"
        :title="t.uploadFile"
        :disabled="isMutating || !canMutateCurrentPath"
        @click="openUploadPicker"
      >
        <img class="icon_asset" :src="addIcon" alt="" aria-hidden="true" />
      </button>
      <button
        class="icon_button toolbar_action"
        :aria-label="t.newFolderAction"
        :title="t.newFolderAction"
        :disabled="isMutating || !canMutateCurrentPath"
        @click="createFolder"
      >
        <img class="icon_asset" :src="newFolderIcon" alt="" aria-hidden="true" />
      </button>
      <button
        class="icon_button toolbar_action"
        :aria-label="t.newFileAction"
        :title="t.newFileAction"
        :disabled="isMutating || !canMutateCurrentPath"
        @click="createFile"
      >
        <img class="icon_asset" :src="fileIcon" alt="" aria-hidden="true" />
      </button>
    </div>

    <span class="toolbar_divider" aria-hidden="true"></span>

    <div class="toolbar_group toolbar_sort">
      <label class="sort_control">
        <span>{{ t.sortBy }}</span>
        <select name="sort" :value="sortBy" :aria-label="t.sortFiles" @change="handleSortChange">
          <option value="name">{{ t.name }}</option>
          <option value="modified">{{ t.modified }}</option>
          <option value="size">{{ t.size }}</option>
          <option value="type">{{ t.type }}</option>
        </select>
      </label>
    </div>

    <span v-if="!isComputerRoot" class="toolbar_divider" aria-hidden="true"></span>

    <fieldset v-if="!isComputerRoot" class="toolbar_group view_switcher">
      <legend class="visually_hidden">{{ t.sortFiles }}</legend>
      <button
        class="icon_button"
        :class="{ active: viewModeModel === 'list' }"
        :aria-label="t.listView"
        :title="t.listView"
        :disabled="files.length === 0"
        @click="viewModeModel = 'list'"
      >
        <img class="icon_asset" :src="listIcon" alt="" aria-hidden="true" />
      </button>
      <button
        class="icon_button"
        :class="{ active: viewModeModel === 'grid' }"
        :aria-label="t.gridView"
        :title="t.gridView"
        :disabled="files.length === 0"
        @click="viewModeModel = 'grid'"
      >
        <img class="icon_asset" :src="gridIcon" alt="" aria-hidden="true" />
      </button>
    </fieldset>

    <label for="desktop-upload-input" class="visually_hidden">{{ t.uploadFile }}</label>
    <input
      id="desktop-upload-input"
      ref="uploadInput"
      class="visually_hidden"
      type="file"
      multiple
      @change="handleUpload"
    />
  </div>
</template>

<style scoped lang="scss">

@use '@/styles/partials/tokens' as *;

.workspace_toolbar,
.toolbar_search,
.toolbar_group,
.sort_control {
  @extend %fx_row_center;
}

.workspace_toolbar {
  gap: 12px;
  min-width: 0;
}

.toolbar_search {
  min-width: 0;
  flex: 0 1 360px;
  gap: 10px;
}

.search_summary {
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
}

.toolbar_group {
  flex: 0 0 auto;
  gap: 4px;
}

.sort_control {
  gap: 7px;
  color: var(--muted);
  font-size: 11px;

  select {
    min-height: 36px;
    padding: 0 9px;
    border: 1px solid var(--border);
    border-radius: 9px;
    color: var(--text);
    background: var(--surface);
    font-size: 11px;
  }
}

@media (max-width: $mobile-breakpoint) {
  // On a phone: the search on a row of its own, then the actions, the order and the view on one.
  .workspace_toolbar {
    flex-wrap: wrap;
    row-gap: 10px;
  }

  .toolbar_search,
  .search_box {
    flex-basis: 100%;
  }

  .toolbar_divider {
    display: none;
  }

  .toolbar_sort {
    margin-left: auto;
  }

  .sort_control > span {
    display: none;
  }
}

</style>
