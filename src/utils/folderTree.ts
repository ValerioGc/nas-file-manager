import type { FileEntry } from '@/types/files';
import type { FolderNode } from '@/types/folders';

export function buildFolderTree(folders: FileEntry[], rootName = 'Home'): FolderNode[] {
  const root: FolderNode = { name: rootName, path: '/', children: [] };
  for (const folder of folders) {
    let children = root.children!;
    let currentPath = '';
    let leaf: FolderNode | undefined;
    for (const segment of folder.path.split('/').filter(Boolean)) {
      currentPath += `/${segment}`;
      let node = children.find((child) => child.path === currentPath);
      if (!node) {
        node = { name: segment, path: currentPath, children: [] };
        children.push(node);
      }
      leaf = node;
      children = node.children!;
    }
    if (leaf && folder.name) {
      leaf.name = folder.name;
    }
  }
  return [root];
}
