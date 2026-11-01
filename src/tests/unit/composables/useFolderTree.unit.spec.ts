import { beforeEach, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const service = vi.hoisted(() => ({ listDirectory: vi.fn(), listVolumes: vi.fn() }));
vi.mock('@/services/filesystem', () => service);

import { useFolderTree } from '@/composables/useFolderTree';
import { usePreferences } from '@/composables/usePreferences';
import type { FileEntry } from '@/types/files';

const folder = (path: string, name = path.split('/').at(-1) ?? ''): FileEntry => ({
  name,
  path,
  kind: 'folder',
  size: null,
  modified: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  usePreferences().preferences.value.showHiddenFiles = false;
});

it('groups the disks of the NAS, the USB drives and the network shares', async () => {
  service.listDirectory.mockResolvedValue([
    folder('/disk', 'Data'),
    folder('/usb', 'Stick'),
    folder('/share', 'Office'),
    folder('/disk/.hidden'),
  ]);
  service.listVolumes.mockResolvedValue([
    { id: 'disk', name: 'Data', kind: 'device' },
    { id: 'usb', name: 'Stick', kind: 'external' },
    { id: 'share', name: 'Office', kind: 'network' },
  ]);
  const { folderNodes, volumes, loadFolderTree } = useFolderTree(ref('Home'));

  await loadFolderTree();

  expect(volumes.value.map((volume) => volume.id)).toEqual(['disk', 'usb', 'share']);
  expect(
    folderNodes.value.map((node) => [node.name, node.path, node.selectable, node.children?.length]),
  ).toEqual([
    ['Home', '/', undefined, 1],
    ['USB', '@external', false, 1],
    ['Network', '@network', false, 1],
  ]);
});

it('keeps an empty root, leaves out empty groups and empties the tree on errors', async () => {
  service.listDirectory.mockResolvedValue([folder('/', '')]);
  service.listVolumes.mockResolvedValue([]);
  const { folderNodes, loadFolderTree } = useFolderTree(ref('Home'));

  await loadFolderTree();
  expect(folderNodes.value.map((node) => node.path)).toEqual(['/']);

  service.listVolumes.mockRejectedValueOnce(new Error('offline'));
  await loadFolderTree();
  expect(folderNodes.value).toEqual([]);
});
