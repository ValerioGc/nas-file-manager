import { computed, ref, type MaybeRef, unref } from 'vue';
import type { FileEntry } from '@/types/files';

export type FileSort = 'modified' | 'name' | 'size' | 'type';

export function useFileSorting(entries: MaybeRef<FileEntry[]>) {
  const sortBy = ref<FileSort>('name');
  const sortedEntries = computed(() => {
    const direction = sortBy.value === 'modified' ? -1 : 1;
    return [...unref(entries)].sort((left, right) => {
      if (sortBy.value === 'size') {
        return ((left.size ?? -1) - (right.size ?? -1)) * direction;
      }
      if (sortBy.value === 'type') {
        return left.kind.localeCompare(right.kind) * direction;
      }
      if (sortBy.value === 'modified') {
        return compareModified(right.modified, left.modified);
      }
      return left.name.localeCompare(right.name, undefined, { numeric: true });
    });
  });

  return { sortBy, sortedEntries };
}

function compareModified(left: FileEntry['modified'], right: FileEntry['modified']) {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  return String(left ?? '').localeCompare(String(right ?? ''));
}
