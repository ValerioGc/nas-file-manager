import type { FileEntry } from '@/types/files';
export const file: FileEntry = {
  name: 'report.txt',
  path: '/docs/report.txt',
  kind: 'document',
  size: 1024,
  modified: 1000,
};
export const folder: FileEntry = {
  name: 'docs',
  path: '/docs',
  kind: 'folder',
  size: null,
  modified: null,
};
export const archive: FileEntry = {
  ...file,
  name: 'backup.zip',
  path: '/docs/backup.zip',
  kind: 'archive',
};
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
