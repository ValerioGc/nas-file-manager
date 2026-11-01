import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileClipboard } from '@/composables/useFileClipboard';
import type { FileEntry } from '@/types/files';

const file: FileEntry = {
  name: 'notes.txt',
  path: '/notes.txt',
  kind: 'file',
  size: 12,
  modified: 1,
};

describe('useFileClipboard', () => {
  beforeEach(() => {
    useFileClipboard().clearClipboard();
  });

  it('shares copied files between composable consumers', () => {
    const first = useFileClipboard();
    const second = useFileClipboard();

    first.copyFiles([file]);

    expect(second.canPaste.value).toBe(true);
    expect(second.clipboard.value).toEqual({ files: [file], mode: 'copy' });
  });

  it('stores cut mode and clears the clipboard after a paste flow', () => {
    const { clipboard, cutFiles, clearClipboard } = useFileClipboard();

    cutFiles([file]);

    expect(clipboard.value?.mode).toBe('cut');
    clearClipboard();
    expect(clipboard.value).toBeNull();
  });

  it('ignores an empty selection', () => {
    const { canPaste, copyFiles } = useFileClipboard();

    copyFiles([]);

    expect(canPaste.value).toBe(false);
  });

  it('writes the copied paths to the system clipboard when the browser allows it', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { canPaste, copyFiles } = useFileClipboard();

    copyFiles([file, { ...file, path: '/other.txt' }]);
    copyFiles([file]);
    await Promise.resolve();

    expect(writeText).toHaveBeenNthCalledWith(1, '/notes.txt\n/other.txt');
    expect(writeText).toHaveBeenNthCalledWith(2, '/notes.txt');
    expect(canPaste.value).toBe(true);
  });

  it('keeps a cut inside the NAS, out of the system clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { clipboard, cutFiles } = useFileClipboard();

    cutFiles([file]);
    await Promise.resolve();

    expect(writeText).not.toHaveBeenCalled();
    expect(clipboard.value).toEqual({ files: [file], mode: 'cut' });
  });

  it('keeps the in-app clipboard without a system clipboard', () => {
    vi.stubGlobal('navigator', {});
    useFileClipboard().copyFiles([file]);
    vi.stubGlobal('navigator', undefined);
    useFileClipboard().copyFiles([file]);

    expect(useFileClipboard().canPaste.value).toBe(true);
  });
});
