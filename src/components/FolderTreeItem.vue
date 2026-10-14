<script setup lang="ts">

import { ref } from 'vue';
import type { FolderNode } from '@/types/folders';
import collapseIcon from '@/assets/icons/chevron-down.svg?url';
import expandIcon from '@/assets/icons/chevron-right.svg?url';
import { useI18n } from '@/i18n';
const { t } = useI18n();

import spacerIcon from '@/assets/icons/spacer.svg?url';
import { getDraggedFiles, isValidDropDestination } from '@/composables/useFileDragAndDrop';
import type { FileEntry } from '@/types/files';

const props = defineProps<{
  node: FolderNode;
  expandedPaths: ReadonlySet<string>;
  selectedPath: string;
  enableDrop?: boolean;
}>();

const emit = defineEmits<{
  toggle: [path: string];
  select: [node: FolderNode];
  'drop-files': [files: FileEntry[], destination: FolderNode];
}>();

const isDropTarget = ref(false);

function folderEntry(): FileEntry {
  return {
    name: props.node.name,
    path: props.node.path,
    kind: 'folder',
    size: null,
    modified: null,
  };
}

function handleItemClick() {
  if (props.node.selectable !== false) {
    emit('select', props.node);
  }
  if (props.node.children?.length && !props.expandedPaths.has(props.node.path)) {
    emit('toggle', props.node.path);
  }
}

function handleToggle() {
  emit('toggle', props.node.path);
}

function handleDragOver(event: DragEvent) {
  if (!props.enableDrop) {
    return;
  }

  const draggedFiles = getDraggedFiles(event);
  if (!isValidDropDestination(draggedFiles, folderEntry())) {
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
  isDropTarget.value = true;
}

function handleDragLeave(event: DragEvent) {
  const relatedTarget = event.relatedTarget;
  if (
    relatedTarget instanceof Node &&
    (event.currentTarget as HTMLElement).contains(relatedTarget)
  ) {
    return;
  }
  isDropTarget.value = false;
}

function handleDrop(event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();
  const draggedFiles = getDraggedFiles(event);
  isDropTarget.value = false;
  if (!isValidDropDestination(draggedFiles, folderEntry())) {
    return;
  }
  emit('drop-files', draggedFiles, props.node);
}

</script>

<template>
  <li class="tree">
    <div
      class="tree_row"
      :class="{ selected: selectedPath === node.path, drop_target: isDropTarget }"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    >
      <button
        v-if="node.children?.length"
        class="tree_row_toggle"
        type="button"
        :aria-label="expandedPaths.has(node.path) ? t.collapseFolder : t.expandFolder"
        :aria-expanded="expandedPaths.has(node.path)"
        @click.stop="handleToggle"
      >
        <img
          v-if="expandedPaths.has(node.path)"
          class="tree_toggle_icon"
          :src="collapseIcon"
          alt=""
          aria-hidden="true"
        />
        <img v-else class="tree_toggle_icon" :src="expandIcon" alt="" aria-hidden="true" />
      </button>

      <span v-else class="tree_row_spacer"></span>

      <button
        class="tree_item_button"
        :aria-label="node.name"
        :aria-current="node.selectable === false ? undefined : selectedPath === node.path"
        @click="handleItemClick"
      >
        <img class="tree_folder_icon" :src="spacerIcon" alt="" aria-hidden="true" />
        <span>{{ node.name }}</span>
      </button>
    </div>

    <ul v-if="node.children?.length && expandedPaths.has(node.path)" class="tree_children">
      <FolderTreeItem
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :expanded-paths="expandedPaths"
        :selected-path="selectedPath"
        :enable-drop="enableDrop"
        @toggle="emit('toggle', $event)"
        @select="emit('select', $event)"
        @drop-files="(files, destination) => emit('drop-files', files, destination)"
      />
    </ul>
  </li>
</template>

<style scoped lang="scss">

.tree {
  .tree_row {
    display: flex;
    align-items: center;
    min-width: 0;
    border-radius: 8px;

    &:hover,
    &.selected {
      background: var(--surface-soft);
    }

    &.selected .tree_item_button {
      color: var(--accent);
      font-weight: 650;
    }

    &.drop_target {
      background: var(--accent-soft);
      box-shadow: inset 0 0 0 1px var(--accent);
    }

    .tree_item_button {
      display: flex;
      align-items: center;
      min-width: 0;
      flex: 1;
      gap: 8px;
      padding: 7px 8px 7px 0;
      color: var(--muted);
      background: transparent;
      text-align: left;
      font-size: 12px;

      span {
        @extend %text_ellipsis;
      }

      .tree_folder_icon {
        width: 18px;
        height: 18px;
        flex: 0 0 18px;
        object-fit: contain;
      }
    }

    &_toggle,
    &_spacer {
      display: grid;
      flex: 0 0 22px;
      place-items: center;
      width: 22px;
      height: 30px;
      color: var(--muted);
      background: transparent;
      font-size: 18px;
      line-height: 1;
    }

    &_toggle:hover {
      color: var(--text);
    }

    .tree_toggle_icon {
      width: 15px;
      height: 15px;
      object-fit: contain;
    }
  }

  .tree_children {
    @extend %reset_list;
    padding-left: 19px;
  }
}

</style>
