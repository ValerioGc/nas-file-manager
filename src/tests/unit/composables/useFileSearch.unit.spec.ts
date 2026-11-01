import { ref } from 'vue';
import { describe, expect, it } from 'vitest';
import { useFileSearch } from '@/composables/useFileSearch';
import type { FileEntry } from '@/types/files';

const entries: FileEntry[] = [
  { name: 'photo.png', path: '/assets/photo.png', kind: 'image', size: 12, modified: 1 },
  { name: 'notes.md', path: '/docs/notes.md', kind: 'document', size: 20, modified: 2 },
];

describe('useFileSearch', () => {
  it('returns all entries without a query and filters by name, path and kind', () => {
    const source = ref(entries);
    const { query, results } = useFileSearch(source);

    expect(results.value).toEqual(entries);
    query.value = 'assets';
    expect(results.value.map((entry) => entry.name)).toEqual(['photo.png']);
    query.value = 'DOCUMENT';
    expect(results.value.map((entry) => entry.name)).toEqual(['notes.md']);
  });
});
