import { computed, ref, type MaybeRef, unref } from 'vue';
import type { FileEntry, FileSort } from '@/types/files';

// Same order as `localeCompare` with these options, without building it for every comparison.
const names = new Intl.Collator(undefined, { numeric: true });

export function useFileSorting(entries: MaybeRef<FileEntry[]>) {
  const sortBy = ref<FileSort>('name');
  const sortedEntries = computed(() => {
    return [...unref(entries)].sort((left, right) => {
      if (sortBy.value === 'size') {
        return (left.size ?? -1) - (right.size ?? -1);
      }
      if (sortBy.value === 'type') {
        return left.kind.localeCompare(right.kind);
      }
      if (sortBy.value === 'modified') {
        return compareModified(right.modified, left.modified);
      }
      return names.compare(left.name, right.name);
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
