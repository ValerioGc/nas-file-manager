import { describe, expect, it } from 'vitest';
import {
  clearDraggedFiles,
  fileDragDataType,
  getDraggedFiles,
  isValidDropDestination,
  setDraggedFiles,
} from '@/composables/useFileDragAndDrop';
import type { FileEntry } from '@/types/files';

const sourceFile: FileEntry = {
  name: 'notes.txt',
  path: '/home/notes.txt',
  kind: 'file',
  size: 12,
  modified: null,
};

const sourceFolder: FileEntry = {
  name: 'documents',
  path: '/home/documents',
  kind: 'folder',
  size: null,
  modified: null,
};

const destinationFolder: FileEntry = {
  name: 'archive',
  path: '/home/archive',
  kind: 'folder',
  size: null,
  modified: null,
};

function createDragEvent() {
  const values = new Map<string, string>();
  const dataTransfer = {
    effectAllowed: '',
    dropEffect: 'none',
    setData(type: string, value: string) {
      values.set(type, value);
    },
    getData(type: string) {
      return values.get(type) ?? '';
    },
  } as unknown as DataTransfer;

  return { dataTransfer } as DragEvent;
}

describe('file drag and drop helpers', () => {
  it('serializes and restores dragged files through the data transfer payload', () => {
    const event = createDragEvent();

    setDraggedFiles(event, [sourceFile]);

    expect(event.dataTransfer?.effectAllowed).toBe('move');
    expect(getDraggedFiles(event)).toEqual([sourceFile]);
  });

  it('rejects non-folder destinations and folders inside the dragged folder', () => {
    expect(isValidDropDestination([sourceFile], destinationFolder)).toBe(true);
    expect(isValidDropDestination([sourceFile], sourceFile)).toBe(false);
    expect(
      isValidDropDestination([sourceFolder], {
        ...destinationFolder,
        path: '/home/documents/archive',
      }),
    ).toBe(false);
    expect(
      isValidDropDestination(
        [
          {
            ...sourceFolder,
            path: 'C:\\Users\\demo\\documents',
          },
        ],
        {
          ...destinationFolder,
          path: 'C:\\Users\\demo\\documents\\archive',
        },
      ),
    ).toBe(false);
    expect(
      isValidDropDestination([sourceFile], {
        ...destinationFolder,
        kind: 'file',
      }),
    ).toBe(false);
  });

  it('ignores malformed drag payloads', () => {
    const event = createDragEvent();
    event.dataTransfer?.setData(fileDragDataType, '{malformed');

    expect(getDraggedFiles(event)).toEqual([]);
  });

  it('keeps the active drag available while dragover hides the payload', () => {
    const sourceEvent = createDragEvent();
    const dragOverEvent = {
      dataTransfer: { getData: () => '' },
    } as unknown as DragEvent;

    setDraggedFiles(sourceEvent, [sourceFile]);

    expect(getDraggedFiles(dragOverEvent)).toEqual([sourceFile]);
    clearDraggedFiles();
    expect(getDraggedFiles(dragOverEvent)).toEqual([]);
  });
});
