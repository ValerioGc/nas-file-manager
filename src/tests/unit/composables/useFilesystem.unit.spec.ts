import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({ listDirectory: vi.fn(), searchFilesystem: vi.fn() }));
vi.mock('@/services/filesystem', () => service);

import { useFilesystem } from '@/composables/useFilesystem';
import type { FileEntry } from '@/types/files';

const fallback: FileEntry[] = [
  { name: 'fallback', path: '/fallback', kind: 'file', size: 1, modified: 1 },
  { name: 'docs', path: '/docs', kind: 'folder', size: null, modified: 1 },
  { name: 'nested', path: '/docs/nested.txt', kind: 'file', size: 1, modified: 1 },
];

describe('useFilesystem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('loads and searches backend entries while preserving fallback on errors', async () => {
    vi.mocked(service.listDirectory).mockResolvedValue([{ ...fallback[0], name: 'loaded' }]);
    vi.mocked(service.searchFilesystem).mockResolvedValue([{ ...fallback[0], name: 'found' }]);
    const { entries, error, isUsingBackend, load, search } = useFilesystem(fallback);

    await load('/docs');
    expect(entries.value[0].name).toBe('loaded');
    await search('found');
    expect(entries.value[0].name).toBe('found');
    expect(isUsingBackend.value).toBe(true);

    vi.mocked(service.listDirectory).mockRejectedValueOnce(new Error('offline'));
    await load();
    expect(error.value).toBe('offline');
    expect(isUsingBackend.value).toBe(false);
    expect(entries.value.map((entry) => entry.name)).toEqual(['fallback', 'docs']);

    vi.mocked(service.searchFilesystem).mockRejectedValueOnce('offline search');
    await search('again');
    expect(error.value).toBe('Unable to run the search');

    await search('');
    expect(service.listDirectory).toHaveBeenCalled();
  });

  it('debounces consecutive searches', async () => {
    vi.useFakeTimers();
    vi.mocked(service.searchFilesystem).mockResolvedValueOnce([
      { ...fallback[0], name: 'latest result' },
    ]);
    const { entries, search } = useFilesystem(fallback);

    const firstRequest = search('old');
    const secondRequest = search('latest');
    await vi.advanceTimersByTimeAsync(280);
    await secondRequest;

    expect(service.searchFilesystem).toHaveBeenCalledTimes(1);
    expect(entries.value[0].name).toBe('latest result');
    await firstRequest;
    vi.useRealTimers();
  });

  it('filters fallback entries below a folder and handles non-error failures', async () => {
    vi.mocked(service.listDirectory).mockRejectedValueOnce('offline');
    const { entries, error, isUsingBackend, load } = useFilesystem(fallback);

    await load('/docs/');

    expect(entries.value.map((entry) => entry.name)).toEqual(['nested']);
    expect(error.value).toBe('Unable to read the files');
    expect(isUsingBackend.value).toBe(false);
  });

  it('ignores stale searches while an earlier request is still pending', async () => {
    vi.useFakeTimers();
    let finishFirst!: (entries: FileEntry[]) => void;
    vi.mocked(service.searchFilesystem)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValueOnce([{ ...fallback[0], name: 'third result' }]);
    const { entries, search } = useFilesystem(fallback);

    const first = search('first');
    await vi.advanceTimersByTimeAsync(280);
    const second = search('second');
    await vi.advanceTimersByTimeAsync(280);
    const third = search('third');
    await vi.advanceTimersByTimeAsync(280);
    finishFirst([{ ...fallback[0], name: 'stale result' }]);
    await Promise.all([first, second, third]);

    expect(service.searchFilesystem).toHaveBeenCalledTimes(2);
    expect(entries.value[0].name).toBe('third result');
    vi.useRealTimers();
  });
});
