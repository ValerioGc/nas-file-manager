<script setup lang="ts">

import { computed } from 'vue';
import copyIcon from '@/assets/icons/copy.svg?url';
import closeIcon from '@/assets/icons/close.svg?url';
import chevronRightIcon from '@/assets/icons/chevron-right.svg?url';
import deleteIcon from '@/assets/icons/delete.svg?url';
import moveIcon from '@/assets/icons/move.svg?url';
import renameIcon from '@/assets/icons/rename.svg?url';
import starFilledIcon from '@/assets/icons/star-filled.svg?url';
import starIcon from '@/assets/icons/star.svg?url';
import type { FileAction } from '@/composables/useFileOperations';
import { useFavorites } from '@/composables/useFavorites';
import FileThumbnail from '@/components/common/FileThumbnail.vue';
import { formatModified } from '@/services/filesystem';
import type { FileEntry } from '@/types/files';
import formatSize from '@/utils/fileUtils';
import { useI18n } from '@/i18n';
import { usePreferences } from '@/composables/usePreferences';
import { getDisplayFileName } from '@/utils/fileDisplay';
const { t } = useI18n();
const { isFavorite } = useFavorites();
const { preferences } = usePreferences();
type PreviewAction = FileAction | 'favorite';

const props = withDefaults(
  defineProps<{
    file?: FileEntry | null;
    files?: FileEntry[];
    title: string;
    showClose?: boolean;
    showCollapse?: boolean;
    showActions?: boolean;
  }>(),
  {
    file: null,
    files: () => [],
    showClose: false,
    showCollapse: false,
    showActions: false,
  },
);

const emit = defineEmits<{
  close: [];
  collapse: [];
  action: [action: PreviewAction];
}>();

const resolvedFiles = computed(() => {
  if (props.files.length > 0) {
    return props.files;
  }
  if (props.file) {
    return [props.file];
  }
  return [];
});
const singleFile = computed(() => {
  if (resolvedFiles.value.length === 1) {
    return resolvedFiles.value[0];
  }
  return null;
});
const selectedFileCount = computed(
  () => resolvedFiles.value.filter((file) => file.kind !== 'folder').length,
);
const selectedFolderCount = computed(
  () => resolvedFiles.value.filter((file) => file.kind === 'folder').length,
);
const selectedSize = computed(() =>
  resolvedFiles.value.reduce((total, file) => total + (file.size ?? 0), 0),
);
const actionButtons = computed<{ type: PreviewAction; label: string; icon: string }[]>(() => {
  const labels = t.value;
  const buttons: { type: PreviewAction; label: string; icon: string }[] = [
    { type: 'copy' as const, label: labels.copy, icon: copyIcon },
    { type: 'move' as const, label: labels.move, icon: moveIcon },
    { type: 'delete' as const, label: labels.delete, icon: deleteIcon },
  ];
  if (resolvedFiles.value.length === 1) {
    buttons.push({ type: 'rename' as const, label: labels.rename, icon: renameIcon });
  }
  if (resolvedFiles.value.length > 0) {
    const allFavorites = resolvedFiles.value.every((file) => isFavorite(file.path));
    buttons.push({
      type: 'favorite' as const,
      label: allFavorites ? labels.removeFavorite : labels.addFavorite,
      icon: allFavorites ? starFilledIcon : starIcon,
    });
  }
  return buttons;
});

function formatCount(message: string, count: number) {
  return message.replace('{count}', String(count));
}

</script>

<template>
  <section class="preview">
    <div class="preview_heading">
      <span>{{ title }}</span>
      <div class="preview_actions">
        <button
          v-if="props.showCollapse"
          class="icon_button preview_collapse"
          :aria-label="t.collapseDetails"
          :title="t.collapseDetails"
          type="button"
          @click="emit('collapse')"
        >
          <img class="icon_asset" :src="chevronRightIcon" alt="" aria-hidden="true" />
        </button>
        <button
          v-if="props.showClose"
          class="icon_button preview_close"
          :aria-label="t.close"
          :title="t.close"
          type="button"
          @click="emit('close')"
        >
          <img class="icon_asset" :src="closeIcon" alt="" aria-hidden="true" />
        </button>
      </div>
    </div>

    <div v-if="singleFile" class="preview_content">
      <FileThumbnail class="details_thumbnail" :file="singleFile" />
      <div class="preview_title">
        <h2>{{ getDisplayFileName(singleFile, preferences.showFileExtensions) }}</h2>
        <p class="muted">{{ singleFile.kind === 'folder' ? t.folders : t.file }}</p>
      </div>
      <dl class="details">
        <div>
          <dt>{{ t.modifiedLabel }}</dt>
          <dd>{{ formatModified(singleFile.modified) }}</dd>
        </div>
        <div>
          <dt>{{ t.sizeLabel }}</dt>
          <dd>{{ formatSize(singleFile.size) }}</dd>
        </div>
        <div>
          <dt>{{ t.pathLabel }}</dt>
          <dd>{{ singleFile.path }}</dd>
        </div>
      </dl>
    </div>
    <div v-else-if="resolvedFiles.length > 1" class="preview_selection_summary">
      <h2>{{ formatCount(t.selectedItems, resolvedFiles.length) }}</h2>
      <p class="muted">
        {{ formatCount(t.selectedFiles, selectedFileCount) }} ·
        {{ formatCount(t.selectedFolders, selectedFolderCount) }}
      </p>
      <dl class="details">
        <div>
          <dt>{{ t.sizeLabel }}</dt>
          <dd>{{ formatSize(selectedSize) }}</dd>
        </div>
      </dl>
    </div>
    <div v-else class="empty_preview">{{ t.emptyPreview }}</div>

    <div v-if="props.showActions && resolvedFiles.length > 0" class="preview_file_actions">
      <button
        v-for="action in actionButtons"
        :key="action.type"
        class="button secondary"
        type="button"
        @click="emit('action', action.type)"
      >
        <img class="icon_asset" :src="action.icon" alt="" aria-hidden="true" />
        {{ action.label }}
      </button>
    </div>
  </section>
</template>

<style scoped lang="scss">

.preview {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);

  &_heading {
    @extend %fx_between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    font-weight: 700;
  }

  &_actions {
    @extend %fx_row_center;
    gap: 4px;
  }

  &_collapse {
    width: 32px;
    height: 32px;
  }

  &_close {
    width: 36px;
    height: 36px;
    margin: -6px -8px -6px 0;
    border: 1px solid var(--border);
    background: var(--surface-soft);
    font-size: 22px;
  }

  &_content {
    display: grid;
    grid-template-columns: 78px minmax(0, 1fr);
    gap: 16px;
    padding: 20px 18px;
  }

  &_file_actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 0 18px 18px;

    .button {
      flex: 1 1 100px;
    }
  }

  &_selection_summary {
    padding: 20px 18px 0;

    h2,
    p {
      margin: 0;
    }

    h2 {
      font-size: 16px;
    }

    p {
      margin-top: 6px;
      font-size: 12px;
    }
  }

  &_title {
    min-width: 0;
    align-self: center;
    text-align: left;

    h2 {
      @extend %text_ellipsis;
      margin: 0 0 4px;
      font-size: 15px;
    }

    .muted {
      margin: 0;
      font-size: 12px;
    }
  }
}

.details {
  grid-column: 1 / -1;
  margin: 0;
  text-align: left;

  &_thumbnail {
    width: 78px;
    height: 78px;
    border-radius: 12px;
    font-size: 30px;
  }

  div {
    @extend %fx_between;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
    font-size: 11px;
  }

  dt {
    color: var(--muted);
  }

  dd {
    max-width: 150px;
    @extend %text_ellipsis;
    margin: 0;
  }
}

</style>
