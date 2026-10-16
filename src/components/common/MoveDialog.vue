<script setup lang="ts">

import { computed, ref, watch } from 'vue';
import closeIcon from '@/assets/icons/close.svg?url';
import BaseModal from '@/components/common/BaseModal.vue';
import FolderTree from '@/components/FolderTree.vue';
import { useI18n } from '@/i18n';
import type { FileEntry } from '@/types/files';
import type { FolderNode } from '@/types/folders';

const props = defineProps<{
  open: boolean;
  /** What happens to the files in the chosen folder: they move there, or a copy goes there. */
  action?: 'copy' | 'move';
  files: FileEntry[];
  folderNodes: FolderNode[];
  currentPath: string;
  isSubmitting?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [destination: string];
}>();

const { t } = useI18n();
const label = computed(() => (props.action === 'copy' ? t.value.copy : t.value.move));
const search = ref('');
const selectedPath = ref('/');

const filteredNodes = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  if (!query) {
    return props.folderNodes;
  }
  return props.folderNodes
    .map((node) => filterNode(node, query))
    .filter((node): node is FolderNode => node !== null);
});

watch(
  () => [props.open, props.currentPath] as const,
  ([open, currentPath]) => {
    if (open) {
      search.value = '';
      selectedPath.value = currentPath;
    }
  },
  { immediate: true },
);

function filterNode(node: FolderNode, query: string): FolderNode | null {
  const matches = `${node.name} ${node.path}`.toLocaleLowerCase().includes(query);
  const children = (node.children ?? [])
    .map((child) => filterNode(child, query))
    .filter((child): child is FolderNode => child !== null);
  if (!matches && children.length === 0) {
    return null;
  }
  return { ...node, children };
}

function selectFolder(node: FolderNode) {
  selectedPath.value = node.path;
}

function confirmMove() {
  emit('confirm', selectedPath.value);
}

</script>

<template>
  <BaseModal :open="open" :aria-label="label" content-class="move_dialog" @close="emit('close')">
    <div class="move_dialog_heading">
      <div>
        <h2>{{ label }}</h2>
        <p>{{ t.selectedItems.replace('{count}', String(files.length)) }}</p>
      </div>
      <button
        class="icon_button move_dialog_close"
        :aria-label="t.close"
        :title="t.close"
        type="button"
        @click="emit('close')"
      >
        <img class="icon_asset" :src="closeIcon" alt="" aria-hidden="true" />
      </button>
    </div>

    <label class="move_dialog_search_label" for="move-folder-search">{{ t.search }}</label>
    <input
      id="move-folder-search"
      v-model="search"
      class="move_dialog_search"
      type="search"
      :placeholder="t.search"
      autocomplete="off"
    />

    <div class="move_dialog_tree" :aria-label="t.folders">
      <FolderTree
        :nodes="filteredNodes"
        :selected-path="selectedPath"
        :expand-all="Boolean(search)"
        @select="selectFolder"
      />
      <p v-if="filteredNodes.length === 0" class="move_dialog_empty">{{ t.empty }}</p>
    </div>

    <div class="move_dialog_actions">
      <button class="button secondary" type="button" @click="emit('close')">
        {{ t.close }}
      </button>
      <button class="button primary" type="button" :disabled="isSubmitting" @click="confirmMove">
        {{ label }}
      </button>
    </div>
  </BaseModal>
</template>

<style scoped lang="scss">

/*
 * Through the backdrop, the root of BaseModal, which carries this component's scope: a rule that
 * starts with a bare :deep() compiles to an attribute selector alone, and PurgeCSS drops it from
 * the production build, so the dialog lost its width and padding.
 */
.modal_backdrop :deep(.move_dialog) {
  width: min(520px, calc(100vw - 48px));
  padding: 22px;
}

.move_dialog_heading,
.move_dialog_actions {
  @extend %fx_between;
}

.move_dialog_heading {
  margin-bottom: 18px;

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: 18px;
  }

  p {
    margin-top: 5px;
    color: var(--muted);
    font-size: 11px;
  }
}

.move_dialog_close {
  font-size: 22px;
}

.move_dialog_search_label {
  display: block;
  margin-bottom: 7px;
  color: var(--muted);
  font-size: 11px;
}

.move_dialog_search {
  @extend %text_field;
}

.move_dialog_tree {
  min-height: 160px;
  max-height: 330px;
  margin: 14px 0;
  padding: 8px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
}

.move_dialog_empty {
  margin: 20px 8px;
  color: var(--muted);
  font-size: 12px;
}

.move_dialog_actions {
  justify-content: flex-end;
  gap: 8px;
}

</style>
