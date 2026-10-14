<script setup lang="ts">

import { ref, watch } from 'vue';
import FolderTreeItem from '@/components/FolderTreeItem.vue';
import type { FileEntry } from '@/types/files';
import type { FolderNode } from '@/types/folders';

const props = withDefaults(
  defineProps<{
    nodes: FolderNode[];
    selectedPath: string;
    expandAll?: boolean;
    enableDrop?: boolean;
  }>(),
  { expandAll: false, enableDrop: false },
);

const emit = defineEmits<{
  select: [node: FolderNode];
  'drop-files': [files: FileEntry[], destination: FolderNode];
}>();

const expandedPaths = ref(new Set(['/']));

watch(
  [() => props.nodes, () => props.expandAll],
  ([nodes, expandAll]) => {
    expandedPaths.value = expandAll ? collectPaths(nodes) : new Set(['/']);
  },
  { immediate: true },
);

function toggleFolder(path: string) {
  const next = new Set(expandedPaths.value);
  if (next.has(path)) {
    next.delete(path);
  } else {
    next.add(path);
  }

  expandedPaths.value = next;
}

function collectPaths(nodes: FolderNode[]) {
  const paths = new Set<string>();
  for (const node of nodes) {
    paths.add(node.path);
    if (node.children?.length) {
      for (const path of collectPaths(node.children)) {
        paths.add(path);
      }
    }
  }
  return paths;
}

function handleDrop(files: FileEntry[], destination: FolderNode) {
  emit('drop-files', files, destination);
}

</script>

<template>
  <ul class="folder_tree" data-testid="folder_tree">
    <FolderTreeItem
      v-for="node in nodes"
      :key="node.path"
      v-memo="[node, selectedPath, expandedPaths, enableDrop]"
      :node="node"
      :expanded-paths="expandedPaths"
      :selected-path="selectedPath"
      :enable-drop="enableDrop"
      @toggle="toggleFolder"
      @select="emit('select', $event)"
      @drop-files="handleDrop"
    />
  </ul>
</template>

<style scoped lang="scss">

.folder_tree {
  @extend %reset_list;
}

</style>
