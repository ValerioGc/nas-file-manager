import type { FileEntry } from '@/types/files';

export function isHiddenEntry(entry: Pick<FileEntry, 'name' | 'hidden'>) {
  return entry.hidden === true || entry.name.startsWith('.');
}

export function filterHiddenEntries(entries: FileEntry[], showHiddenFiles: boolean) {
  if (showHiddenFiles) {
    return entries;
  }

  return entries.filter(
    (entry) =>
      !isHiddenEntry(entry) && !entry.path.split('/').some((segment) => segment.startsWith('.')),
  );
}

export function getDisplayFileName(
  entry: Pick<FileEntry, 'name' | 'kind'>,
  showFileExtensions: boolean,
) {
  if (showFileExtensions || entry.kind === 'folder') {
    return entry.name;
  }

  const extensionSeparator = entry.name.lastIndexOf('.');
  if (extensionSeparator <= 0) {
    return entry.name;
  }

  return entry.name.slice(0, extensionSeparator);
}
