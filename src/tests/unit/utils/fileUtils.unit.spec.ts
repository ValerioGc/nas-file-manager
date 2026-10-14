import { expect, it } from 'vitest';
import formatSize from '@/utils/fileUtils';
import { buildFolderTree } from '@/utils/folderTree';
import { folder } from '../../helpers/fixtures';
it.each([
  [null, '-'],
  [0, '0 B'],
  [1023, '1023 B'],
  [1024, '1 KB'],
  [1048576, '1 MB'],
])('formats %s bytes as %s', (size, expected) => {
  expect(formatSize(size as number | null)).toBe(expected);
});
it('merges repeated ancestors and tolerates root entries and unnamed folders', () => {
  const tree = buildFolderTree([
    folder,
    { ...folder, path: '/docs/photos', name: 'Photos' },
    { ...folder, path: '/' },
    { ...folder, name: '', path: '/other' },
  ]);
  expect(tree[0].children).toHaveLength(2);
  expect(tree[0].children?.[0].children?.[0].name).toBe('Photos');
  expect(tree[0].children?.[1].name).toBe('other');
});
