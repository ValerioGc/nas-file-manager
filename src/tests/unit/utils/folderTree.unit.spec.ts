import { describe, expect, it } from 'vitest';
import { buildFolderTree } from '@/utils/folderTree';

describe('folder tree', () => {
  it('uses the published volume label instead of its internal identifier', () => {
    const tree = buildFolderTree([
      {
        name: 'Data-sdb',
        path: '/v-7395de7d-15dc-448f-bc09-81657b8639fb',
        kind: 'folder',
        size: null,
        modified: null,
      },
    ]);

    expect(tree[0]?.children?.[0]).toMatchObject({
      name: 'Data-sdb',
      path: '/v-7395de7d-15dc-448f-bc09-81657b8639fb',
    });
  });
});
