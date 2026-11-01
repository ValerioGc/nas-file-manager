import { ref } from 'vue';
import { describe, expect, it } from 'vitest';
import { useFileSorting } from '@/composables/useFileSorting';
import type { FileEntry } from '@/types/files';

const entries: FileEntry[] = [
  { name: 'zeta.txt', path: '/zeta.txt', kind: 'file', size: 20, modified: 100 },
  { name: 'alpha.png', path: '/alpha.png', kind: 'image', size: 10, modified: 200 },
  { name: 'folder', path: '/folder', kind: 'folder', size: null, modified: 50 },
];

describe('useFileSorting', () => {
  it('sorts immutable source data by each supported field', () => {
    const source = ref(entries);
    const { sortBy, sortedEntries } = useFileSorting(source);

    expect(sortedEntries.value.map((entry) => entry.name)).toEqual([
      'alpha.png',
      'folder',
      'zeta.txt',
    ]);
    sortBy.value = 'size';
    expect(sortedEntries.value.at(-1)?.name).toBe('zeta.txt');
    sortBy.value = 'type';
    expect(sortedEntries.value.at(0)?.kind).toBe('file');
    sortBy.value = 'modified';
    expect(sortedEntries.value.at(0)?.name).toBe('alpha.png');
    expect(entries[0].name).toBe('zeta.txt');
  });

  it('sorts non-numeric modified values safely', () => {
    const source = ref([
      { ...entries[0], name: 'later', modified: '2026-02-01' },
      { ...entries[1], name: 'earlier', modified: null },
    ]);
    const { sortBy, sortedEntries } = useFileSorting(source);

    sortBy.value = 'modified';
    expect(sortedEntries.value).toHaveLength(2);
  });
});
