import type { FileEntry } from '@/types/files';
import { trimTrailingSlashes } from '@/utils/paths';

export const fileDragDataType = 'application/x-fs-explorer-files';

let activeDraggedFiles: FileEntry[] = [];

export function setDraggedFiles(event: DragEvent, files: FileEntry[]) {
  if (!event.dataTransfer || files.length === 0) {
    return;
  }

  activeDraggedFiles = [...files];
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData(fileDragDataType, JSON.stringify(files));
}

export function getDraggedFiles(event: DragEvent): FileEntry[] {
  const value = event.dataTransfer?.getData(fileDragDataType);
  if (!value) {
    return [...activeDraggedFiles];
  }

  try {
    const files = JSON.parse(value) as FileEntry[];
    if (!Array.isArray(files)) {
      return [];
    }
    return files.filter((file) => typeof file?.path === 'string' && typeof file?.name === 'string');
  } catch {
    return [];
  }
}

export function clearDraggedFiles() {
  activeDraggedFiles = [];
}

export function isValidDropDestination(files: FileEntry[], destination: FileEntry) {
  if (destination.kind !== 'folder' || files.length === 0) {
    return false;
  }

  const destinationPath = normalizePath(destination.path);

  return files.every((file) => {
    const filePath = normalizePath(file.path);
    return filePath !== destinationPath && !destinationPath.startsWith(`${filePath}/`);
  });
}

function normalizePath(path: string) {
  const normalizedPath = trimTrailingSlashes(path.replaceAll('\\', '/'));
  return normalizedPath || '/';
}
