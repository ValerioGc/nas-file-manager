<script setup lang="ts">

import { computed, ref, watch } from 'vue';
import BaseModal from '@/components/common/BaseModal.vue';
import ActionMenu from '@/components/desktop/header/ActionMenu.vue';
import chevronLeftIcon from '@/assets/icons/chevron-left.svg?url';
import FilePreview from '@/components/common/FilePreview.vue';
import { useDesktopExplorerContext } from '@/composables/useDesktopExplorerContext';
import type { FileAction } from '@/composables/useFileOperations';
import { useFavorites } from '@/composables/useFavorites';
import { showsDetails, usePreferences } from '@/composables/usePreferences';
import { useI18n } from '@/i18n';
import type { FileEntry } from '@/types/files';

import FileBrowser from './FileBrowser.vue';

const { fileActions, files, isListLoading, isNarrowDesktop, viewMode } =
  useDesktopExplorerContext();
const { preferences } = usePreferences();
// The details panel, as the settings want it for this view: without it there is none to show.
const details = computed(
  () => files.value.length > 0 && showsDetails(preferences.value, viewMode.value),
);

const { t } = useI18n();
const { toggleFavorites } = useFavorites();
const selectedFiles = ref<FileEntry[]>([]);
let requestedSelection = new URL(window.location.href).searchParams.get('select');
const selectionError = ref(false);
watch([files, isListLoading], () => {
  if (!requestedSelection || isListLoading.value) {
    return;
  }
  const found = files.value.find((file) => file.name === requestedSelection);
  if (found) {
    selectedFiles.value = [found];
  } else {
    selectionError.value = true;
  }
  requestedSelection = null;
});
// Closed at every start: it opens on request.
const isDetailsCollapsed = ref(true);

function handleFileSelect(files: FileEntry[]) {
  selectedFiles.value = files;
}

function clearSelection() {
  selectedFiles.value = [];
}

async function handleSelectionAction(action: FileAction | 'favorite') {
  if (selectedFiles.value.length === 0) {
    return;
  }
  if (action === 'favorite') {
    toggleFavorites(selectedFiles.value);
    return;
  }
  await fileActions(action, [...selectedFiles.value]);
  clearSelection();
}

function collapseDetails() {
  isDetailsCollapsed.value = true;
}

function expandDetails() {
  isDetailsCollapsed.value = false;
}

</script>

<template>
  <div
    class="content_grid"
    :class="{
      details_collapsed: !isNarrowDesktop && details && isDetailsCollapsed,
      no_details: !details || isNarrowDesktop,
    }"
  >
    <!-- The toolbar heads the files only: the details panel starts at its height. -->
    <div class="browser_column">
      <ActionMenu />
      <p v-if="selectionError" role="alert">{{ t.selectedFileUnavailable }}</p>
      <FileBrowser :selected-files="selectedFiles" @select-files="handleFileSelect" />
    </div>

    <aside
      v-if="!isNarrowDesktop && details"
      class="details_panel"
      :class="{ collapsed: isDetailsCollapsed }"
      :aria-label="t.details"
    >
      <Transition name="details_slide" mode="out-in">
        <button
          v-if="isDetailsCollapsed"
          key="collapsed"
          class="icon_button details_expand"
          :aria-label="t.expandDetails"
          :title="t.expandDetails"
          type="button"
          @click="expandDetails"
        >
          <img class="icon_asset" :src="chevronLeftIcon" alt="" aria-hidden="true" />
        </button>
        <FilePreview
          v-else
          key="expanded"
          :files="selectedFiles"
          :title="t.details"
          show-actions
          show-collapse
          @collapse="collapseDetails"
          @action="handleSelectionAction"
        />
      </Transition>
    </aside>
  </div>

  <BaseModal
    :open="details && selectedFiles.length > 0 && isNarrowDesktop"
    :aria-label="t.details"
    content-class="file_details_modal"
    @close="clearSelection"
  >
    <!-- On a narrow screen, and with a finger, the details are where a file is acted on. -->
    <FilePreview
      v-if="selectedFiles.length > 0"
      :files="selectedFiles"
      :title="t.preview"
      show-actions
      show-close
      @close="clearSelection"
      @action="handleSelectionAction"
    />
  </BaseModal>
</template>

<style scoped lang="scss">

.content_grid {
  min-height: 0;
  height: 100%;
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 320px);
  gap: 20px;
  overflow: hidden;
  transition: grid-template-columns 0.22s ease;

  &.details_collapsed {
    grid-template-columns: minmax(0, 1fr) 42px;
  }

  &.no_details {
    grid-template-columns: minmax(0, 1fr);
  }
}

.browser_column {
  display: flex;
  flex-direction: column;
  gap: 22px;
  min-width: 0;
  min-height: 0;

  > :last-child {
    flex: 1;
  }
}

.details_panel {
  min-width: 0;
  min-height: 0;
  align-self: stretch;
  box-sizing: border-box;
  height: 100%;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
  transition: width 0.22s ease;

  :deep(.preview) {
    height: 100%;
    overflow-y: auto;
    border: 0;
    border-radius: 0;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  &.collapsed {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 10px;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
}

.details_expand {
  background: var(--surface);
}

.details_slide-enter-active,
.details_slide-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.22s ease;
}

.details_slide-enter-from {
  opacity: 0;
  transform: translateX(18px);
}

.details_slide-leave-to {
  opacity: 0;
  transform: translateX(-18px);
}

/*
 * Through the backdrop, the root of BaseModal, which carries this component's scope: a rule that
 * starts with a bare :deep() compiles to an attribute selector alone, and PurgeCSS drops it from
 * the production build, so the dialog lost its width and padding.
 */
.modal_backdrop :deep(.file_details_modal) {
  padding: 0;
}

</style>
