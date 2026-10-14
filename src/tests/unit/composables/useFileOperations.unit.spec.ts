import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  copyEntry: vi.fn(),
  clearPreviewCache: vi.fn(),
  createFile: vi.fn(),
  createDirectory: vi.fn(),
  deleteEntry: vi.fn(),
  downloadFile: vi.fn(),
  moveEntry: vi.fn(),
  renameEntry: vi.fn(),
  uploadFile: vi.fn(),
  listDirectory: vi.fn(),
}));
vi.mock('@/services/filesystem', () => api);

import { useTrash } from '@/composables/useTrash';
import { useFileOperations } from '@/composables/useFileOperations';
import type { FileEntry } from '@/types/files';

const file: FileEntry = {
  name: 'draft.txt',
  path: '/draft.txt',
  kind: 'file',
  size: 1,
  modified: 1,
};

describe('useFileOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('renames, copies, moves, deletes and creates with what the windows of the app gave', async () => {
    const completed = vi.fn();
    const { create, perform, rename, transferToDestination } = useFileOperations(completed);
    const confirmOperation = vi.fn(async () => true);
    const prompt = vi.spyOn(window, 'prompt');
    const confirm = vi.spyOn(window, 'confirm');

    await expect(rename(file, 'renamed.txt')).resolves.toContain('Item renamed');
    await expect(transferToDestination('copy', [file], '/archive')).resolves.toContain('Copied 1');
    await expect(transferToDestination('move', [file], '/archive')).resolves.toContain('Moved 1');
    await expect(perform('delete', file, confirmOperation)).resolves.toContain(
      'Moved to the trash',
    );
    await expect(create('/', 'folder')).resolves.toContain('Folder created');
    expect(api.renameEntry).toHaveBeenCalledWith('/draft.txt', 'renamed.txt');
    expect(api.copyEntry).toHaveBeenCalledWith('/draft.txt', '/archive/draft.txt');
    expect(api.moveEntry).toHaveBeenCalledWith('/draft.txt', '/archive/draft.txt');
    expect(api.createDirectory).toHaveBeenCalledWith('/folder');
    expect(api.clearPreviewCache).toHaveBeenCalledTimes(5);
    expect(completed).toHaveBeenCalledTimes(5);
    // Nothing asks the browser: inside the launcher it would answer nothing.
    expect(prompt).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('uses the shared confirmation resolver for destructive operations', async () => {
    const confirmOperation = vi.fn(async () => true);
    const { perform, performMany } = useFileOperations();

    await expect(perform('delete', file, confirmOperation)).resolves.toBe(
      'Moved to the trash (draft.txt)',
    );
    await expect(
      performMany(
        'delete',
        [file, { ...file, name: 'image.png', path: '/image.png' }],
        confirmOperation,
      ),
    ).resolves.toBe('2 items moved to the trash');

    // With the trash on (its default) a deletion says where it goes.
    expect(confirmOperation).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        title: 'Confirm deletion',
        message: 'Move “draft.txt” to the trash?',
        confirmLabel: 'Move to trash',
      }),
    );
    expect(confirmOperation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: 'Move the 2 selected items to the trash?',
        confirmLabel: 'Move to trash',
      }),
    );
    useTrash().settings.value = { enabled: false, days: 30 };
    await expect(perform('delete', file, confirmOperation)).resolves.toContain('Item deleted');
    await expect(performMany('delete', [file, file], confirmOperation)).resolves.toContain(
      'Deleted 2',
    );
    expect(confirmOperation).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ confirmLabel: 'Delete' }),
    );
    expect(confirmOperation).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ confirmLabel: 'Delete' }),
    );
    useTrash().settings.value = { enabled: true, days: 30 };
  });

  it('creates a new empty file with the provided extension', async () => {
    const { createFile } = useFileOperations();

    await expect(createFile('/documents', 'notes.txt')).resolves.toContain('File created');

    expect(api.createFile).toHaveBeenCalledWith('/documents/notes.txt');
  });

  it('transfers multiple entries to an explicit destination', async () => {
    const secondFile = { ...file, name: 'image.png', path: '/image.png' };
    const { transferToDestination } = useFileOperations();

    await expect(transferToDestination('copy', [file, secondFile], '/archive')).resolves.toContain(
      'Copied 2',
    );

    expect(api.copyEntry).toHaveBeenNthCalledWith(1, '/draft.txt', '/archive/draft.txt');
    expect(api.copyEntry).toHaveBeenNthCalledWith(2, '/image.png', '/archive/image.png');
  });

  it('resolves overwrite, rename and skip conflict decisions', async () => {
    const existing = { ...file, path: '/archive/draft.txt' };
    vi.mocked(api.listDirectory).mockResolvedValue([existing]);
    const { transferToDestination } = useFileOperations();
    const resolveConflicts = vi.fn(async () => [
      { sourcePath: file.path, action: 'overwrite' as const },
    ]);
    const confirmOperation = vi.fn(async () => true);

    await expect(
      transferToDestination('copy', [file], '/archive', resolveConflicts, confirmOperation),
    ).resolves.toContain('Copied');
    expect(resolveConflicts).toHaveBeenCalledWith([{ file, existing, destination: '/archive' }]);
    expect(api.deleteEntry).toHaveBeenCalledWith('/archive/draft.txt');
    expect(api.copyEntry).toHaveBeenCalledWith('/draft.txt', '/archive/draft.txt');
    expect(confirmOperation).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Confirm overwrite', confirmLabel: 'Overwrite' }),
    );

    vi.clearAllMocks();
    vi.mocked(api.listDirectory).mockResolvedValue([existing]);
    const renameResolution = vi.fn(async () => [
      { sourcePath: file.path, action: 'rename' as const, name: 'draft-copy.txt' },
    ]);
    await expect(
      transferToDestination('move', [file], '/archive', renameResolution),
    ).resolves.toContain('Moved');
    expect(api.moveEntry).toHaveBeenCalledWith('/draft.txt', '/archive/draft-copy.txt');

    vi.clearAllMocks();
    vi.mocked(api.listDirectory).mockResolvedValue([existing]);
    const skipResolution = vi.fn(async () => [{ sourcePath: file.path, action: 'skip' as const }]);
    await expect(
      transferToDestination('copy', [file], '/archive', skipResolution),
    ).resolves.toBeNull();
    expect(api.copyEntry).not.toHaveBeenCalled();
  });

  it('does not mutate data when the user cancels, or when no window can ask', async () => {
    const { create, perform } = useFileOperations();
    await expect(
      perform(
        'delete',
        file,
        vi.fn(async () => false),
      ),
    ).resolves.toBeNull();
    await expect(perform('delete', file)).resolves.toBeNull();
    await expect(create('/', '')).resolves.toBeNull();
    expect(api.deleteEntry).not.toHaveBeenCalled();
    expect(api.createDirectory).not.toHaveBeenCalled();
  });

  it('tracks upload and download operations', async () => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:download'),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal('document', { createElement: vi.fn(() => ({ click: vi.fn() })) });
    vi.mocked(api.downloadFile).mockResolvedValue({ blob: new Blob(['file']), name: 'draft.txt' });
    vi.mocked(api.uploadFile).mockResolvedValue(file);
    const { perform, transfer, upload } = useFileOperations();
    const uploadItem = { name: 'upload.txt' } as File;

    await expect(perform('download', file)).resolves.toContain('Download');
    await expect(upload('/', [uploadItem])).resolves.toContain('File uploaded');
    expect(api.downloadFile).toHaveBeenCalledWith('/draft.txt');
    expect(api.uploadFile).toHaveBeenCalledWith('/upload.txt', uploadItem);
    expect(transfer.value?.progress).toBe(100);
  });

  it('handles empty, single and multi-file deletions and downloads', async () => {
    const secondFile = { ...file, name: 'image.png', path: '/image.png' };
    const { performMany } = useFileOperations();

    await expect(performMany('delete', [])).resolves.toBeNull();
    await expect(
      performMany(
        'delete',
        [file],
        vi.fn(async () => true),
      ),
    ).resolves.toContain('Moved to the trash');
    await expect(performMany('delete', [file, secondFile])).resolves.toBeNull();

    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:download'),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal('document', { createElement: vi.fn(() => ({ click: vi.fn() })) });
    vi.mocked(api.downloadFile).mockResolvedValue({ blob: new Blob(['file']), name: 'file.txt' });
    await expect(performMany('download', [file, secondFile])).resolves.toBeNull();
    expect(api.downloadFile).toHaveBeenCalledTimes(2);
  });

  it('sends several entries to the destination chosen and reports what was transferred', async () => {
    const secondFile = { ...file, name: 'image.png', path: '/image.png' };
    const { transferToDestination } = useFileOperations();

    await expect(transferToDestination('copy', [file, secondFile], '/archive')).resolves.toContain(
      'Copied 2',
    );
    await expect(transferToDestination('move', [file, secondFile], '/archive')).resolves.toContain(
      'Moved 2',
    );
    await expect(transferToDestination('copy', [], '/archive')).resolves.toBeNull();
    await expect(transferToDestination('move', [file], '  ')).resolves.toBeNull();
    await expect(transferToDestination('move', [file], '/archive')).resolves.toContain('Moved 1');
    expect(api.moveEntry).toHaveBeenLastCalledWith('/draft.txt', '/archive/draft.txt');
  });

  it('copies into nested folders and stops when nothing was transferred', async () => {
    const nested = { ...file, path: '/docs/draft.txt' };
    vi.mocked(api.listDirectory).mockResolvedValue([nested]);
    const { transferToDestination } = useFileOperations();
    const resolveConflicts = vi.fn(async () => []);

    await expect(transferToDestination('copy', [nested], '/docs/sub')).resolves.toContain(
      'Copied 1',
    );
    expect(api.copyEntry).toHaveBeenCalledWith('/docs/draft.txt', '/docs/sub/draft.txt');
    await expect(
      transferToDestination('move', [nested], '/docs', resolveConflicts),
    ).resolves.toBeNull();
    await expect(
      transferToDestination(
        'move',
        [nested, { ...nested, name: 'other.txt', path: '/other.txt' }],
        '/docs',
        vi.fn(async () => []),
      ),
    ).resolves.toContain('Moved 1');
    vi.mocked(api.listDirectory).mockResolvedValue([]);
    await expect(
      transferToDestination('copy', [file], '/docs', resolveConflicts),
    ).resolves.toContain('Copied 1');
    expect(resolveConflicts).not.toHaveBeenCalled();
  });

  it('keeps conflicting entries when the overwrite is refused or no name is given', async () => {
    const existing = { ...file, path: '/archive/draft.txt' };
    vi.mocked(api.listDirectory).mockResolvedValue([existing]);
    const { transferToDestination } = useFileOperations();
    const overwrite = vi.fn(async () => [{ sourcePath: file.path, action: 'overwrite' as const }]);

    await expect(
      transferToDestination(
        'copy',
        [file],
        '/archive',
        overwrite,
        vi.fn(async () => false),
      ),
    ).resolves.toBeNull();
    // Without a window to confirm in, nothing is overwritten.
    await expect(transferToDestination('copy', [file], '/archive', overwrite)).resolves.toBeNull();
    await expect(
      transferToDestination(
        'copy',
        [file],
        '/archive',
        vi.fn(async () => [{ sourcePath: file.path, action: 'rename' as const, name: '' }]),
      ),
    ).resolves.toBeNull();
    await expect(
      transferToDestination(
        'copy',
        [file],
        '/archive',
        vi.fn(async () => []),
      ),
    ).resolves.toBeNull();
    expect(api.copyEntry).not.toHaveBeenCalled();
    expect(api.deleteEntry).not.toHaveBeenCalled();
  });

  it('skips unchanged and empty names for files, and empty uploads', async () => {
    const { createFile, rename, upload } = useFileOperations();

    await expect(rename(file, file.name)).resolves.toBeNull();
    await expect(rename(file, '')).resolves.toBeNull();
    await expect(createFile('/docs', '')).resolves.toBeNull();
    await expect(createFile('/docs', 'notes.md')).resolves.toContain('notes.md');
    await expect(upload('/', [])).resolves.toBeNull();
    await expect(
      upload('/docs', [{ name: 'a.txt' } as File, { name: 'b.txt' } as File]),
    ).resolves.toContain('2');
    expect(api.createFile).toHaveBeenCalledWith('/docs/notes.md');
    expect(api.uploadFile).toHaveBeenCalledWith('/docs/b.txt', { name: 'b.txt' });
    expect(api.renameEntry).not.toHaveBeenCalled();
  });

  it('advances the transfer progress while it runs and clears it afterwards', async () => {
    vi.useFakeTimers();
    let finish = () => {};
    vi.mocked(api.uploadFile).mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve(file);
      }),
    );
    const { transfer, upload } = useFileOperations();

    const pending = upload('/', [{ name: 'big.bin' } as File]);
    vi.advanceTimersByTime(180);
    expect(transfer.value?.progress).toBe(13);
    vi.advanceTimersByTime(180 * 20);
    expect(transfer.value?.progress).toBe(97);
    transfer.value = null;
    vi.advanceTimersByTime(180);
    finish();
    await pending;
    expect(transfer.value).toBeNull();
    vi.advanceTimersByTime(360);
    expect(transfer.value).toBeNull();
  });
});
