import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';

const service = vi.hoisted(() => ({ listDirectory: vi.fn(), searchFilesystem: vi.fn() }));
vi.mock('@/services/filesystem', () => service);

import { useFilesystem } from '@/composables/useFilesystem';
import type { FileEntry } from '@/types/files';

const sample: FileEntry = { name: 'sample', path: '/sample', kind: 'file', size: 1, modified: 1 };

describe('useFilesystem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('loads and searches backend entries and empties the list on errors', async () => {
    vi.mocked(service.listDirectory).mockResolvedValue([{ ...sample, name: 'loaded' }]);
    vi.mocked(service.searchFilesystem).mockResolvedValue([{ ...sample, name: 'found' }]);
    const { entries, error, load, search } = useFilesystem();

    await load('/docs');
    expect(entries.value[0].name).toBe('loaded');
    await search('found');
    expect(entries.value[0].name).toBe('found');

    vi.mocked(service.listDirectory).mockRejectedValueOnce(new Error('offline'));
    await load();
    expect(error.value).toBe('offline');
    expect(entries.value).toEqual([]);

    vi.mocked(service.searchFilesystem).mockRejectedValueOnce('offline search');
    await search('again');
    expect(error.value).toBe('Unable to run the search');

    await search('');
    expect(service.listDirectory).toHaveBeenCalled();
  });

  it('debounces consecutive searches', async () => {
    vi.useFakeTimers();
    vi.mocked(service.searchFilesystem).mockResolvedValueOnce([
      { ...sample, name: 'latest result' },
    ]);
    const { entries, search } = useFilesystem();

    const firstRequest = search('old');
    const secondRequest = search('latest');
    await vi.advanceTimersByTimeAsync(280);
    await secondRequest;

    expect(service.searchFilesystem).toHaveBeenCalledTimes(1);
    expect(entries.value[0].name).toBe('latest result');
    await firstRequest;
    vi.useRealTimers();
  });

  it('keeps the folder opened last when an earlier answer arrives late', async () => {
    let answerFirst!: (entries: FileEntry[]) => void;
    vi.mocked(service.listDirectory)
      .mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)))
      .mockResolvedValueOnce([{ ...sample, name: 'second' }]);
    const { entries, isLoading, load } = useFilesystem();

    const first = load('/first');
    await load('/second');
    answerFirst([{ ...sample, name: 'first' }]);
    await first;

    expect(entries.value[0].name).toBe('second');
    expect(isLoading.value).toBe(false);
  });

  it('handles non-error failures', async () => {
    vi.mocked(service.listDirectory).mockRejectedValueOnce('offline');
    const { entries, error, load } = useFilesystem();

    await load('/docs/');

    expect(entries.value).toEqual([]);
    expect(error.value).toBe('Unable to read the files');
  });

  it('loads its start folder when mounted and drops a pending search when unmounted', async () => {
    vi.useFakeTimers();
    vi.mocked(service.listDirectory).mockResolvedValue([sample]);
    let state!: ReturnType<typeof useFilesystem>;
    const wrapper = mount(
      defineComponent({
        setup() {
          state = useFilesystem('/docs');
          return () => h('div');
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(service.listDirectory).toHaveBeenCalledWith('/docs');

    const pending = state.search('late');
    wrapper.unmount();
    await pending;
    await vi.advanceTimersByTimeAsync(280);
    expect(service.searchFilesystem).not.toHaveBeenCalled();
    vi.useRealTimers();
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
      .mockResolvedValueOnce([{ ...sample, name: 'third result' }]);
    const { entries, search } = useFilesystem();

    const first = search('first');
    await vi.advanceTimersByTimeAsync(280);
    const second = search('second');
    await vi.advanceTimersByTimeAsync(280);
    const third = search('third');
    await vi.advanceTimersByTimeAsync(280);
    finishFirst([{ ...sample, name: 'stale result' }]);
    await Promise.all([first, second, third]);

    expect(service.searchFilesystem).toHaveBeenCalledTimes(2);
    expect(entries.value[0].name).toBe('third result');
    vi.useRealTimers();
  });
});
