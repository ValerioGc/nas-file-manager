import { describe, expect, it } from 'vitest';
import { filterHiddenEntries, getDisplayFileName, isHiddenEntry } from '@/utils/fileDisplay';
import type { FileEntry } from '@/types/files';

const entries: FileEntry[] = [
  { name: 'visible.txt', path: '/visible.txt', kind: 'document', size: 1, modified: 1 },
  { name: '.hidden.txt', path: '/.hidden.txt', kind: 'document', size: 1, modified: 1 },
  {
    name: 'hidden-by-attribute',
    path: '/hidden-by-attribute',
    kind: 'file',
    hidden: true,
    size: 1,
    modified: 1,
  },
  { name: 'folder', path: '/folder', kind: 'folder', size: null, modified: 1 },
];

describe('file display helpers', () => {
  it('filters hidden entries unless the preference is enabled', () => {
    expect(filterHiddenEntries(entries, false).map((entry) => entry.name)).toEqual([
      'visible.txt',
      'folder',
    ]);
    expect(filterHiddenEntries(entries, true)).toEqual(entries);
    expect(isHiddenEntry(entries[1])).toBe(true);
  });

  it('hides only the final extension while preserving folders and dotfiles', () => {
    expect(getDisplayFileName(entries[0], false)).toBe('visible');
    expect(getDisplayFileName(entries[0], true)).toBe('visible.txt');
    expect(getDisplayFileName(entries[3], false)).toBe('folder');
    expect(getDisplayFileName(entries[1], false)).toBe('.hidden');
  });
});
