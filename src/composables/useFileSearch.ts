import { computed, ref, type MaybeRef, unref } from 'vue';
import type { FileEntry } from '@/types/files';

export function useFileSearch(entries: MaybeRef<FileEntry[]>) {
  const query = ref('');
  const results = computed(() => {
    const normalizedQuery = query.value.trim().toLocaleLowerCase();
    if (!normalizedQuery) {
      return unref(entries);
    }

    return unref(entries).filter((entry) =>
      `${entry.name} ${entry.path} ${entry.kind}`.toLocaleLowerCase().includes(normalizedQuery),
    );
  });

  return { query, results };
}
