import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useConflictResolution } from '@/composables/useConflictResolution';
import { useOperationConfirmation } from '@/composables/useOperationConfirmation';
import { useLoading } from '@/composables/useLoading';
import { useMediaQuery } from '@/composables/useViewport';
import { useFocusTrap } from '@/composables/useFocusTrap';
import { useDesktopExplorerContext } from '@/composables/useDesktopExplorerContext';
import { file } from '../../helpers/fixtures';

function host<T>(setup: () => T) {
  let state!: T;
  const wrapper = mount(
    defineComponent({
      setup() {
        state = setup();
        return () => h('div');
      },
    }),
  );
  return { state, wrapper };
}

describe('pending user decisions', () => {
  it('resolves and cancels conflict decisions and clears dialog state', async () => {
    const state = useConflictResolution();
    const conflicts = [{ file, existing: file, destination: '/target' }];
    const pending = state.requestConflictResolution(conflicts);
    expect(state.conflicts.value).toEqual(conflicts);
    expect(state.isConflictDialogOpen.value).toBe(true);
    const decisions = [{ sourcePath: file.path, action: 'overwrite' as const }];
    state.resolveConflicts(decisions);
    expect(await pending).toEqual(decisions);
    expect(state.conflicts.value).toEqual([]);
    const cancelled = state.requestConflictResolution(conflicts);
    state.cancelConflictResolution();
    expect(await cancelled).toEqual([]);
    expect(state.isConflictDialogOpen.value).toBe(false);
    state.cancelConflictResolution();
  });
  it('resolves confirmations and cancellation without leaving a pending request', async () => {
    const state = useOperationConfirmation();
    const request = {
      title: 'Delete',
      message: 'Delete file?',
      confirmLabel: 'Yes',
      cancelLabel: 'No',
    };
    const pending = state.confirmOperation(request);
    expect(state.request.value).toEqual(request);
    state.resolveConfirmation(true);
    expect(await pending).toBe(true);
    const cancelled = state.confirmOperation(request);
    state.cancelConfirmation();
    expect(await cancelled).toBe(false);
    expect(state.request.value).toBeNull();
    state.cancelConfirmation();
  });
});

it('restarts the loading timeout and cleans it up on unmount', () => {
  vi.useFakeTimers();
  const { state, wrapper } = host(() => useLoading());
  expect(state.isLoading.value).toBe(false);
  state.triggerLoading();
  vi.advanceTimersByTime(100);
  state.triggerLoading(300);
  vi.advanceTimersByTime(240);
  expect(state.isLoading.value).toBe(true);
  vi.advanceTimersByTime(60);
  expect(state.isLoading.value).toBe(false);
  state.triggerLoading();
  wrapper.unmount();
  expect(vi.getTimerCount()).toBe(0);
  host(() => useLoading(true)).wrapper.unmount();
});

it('syncs viewport changes and removes its listener', () => {
  const media = window.matchMedia('(pointer: coarse)');
  vi.spyOn(window, 'matchMedia').mockReturnValue(media);
  const { state, wrapper } = host(() => useMediaQuery('(pointer: coarse)'));
  expect(state.isMobileViewport.value).toBe(false);
  Object.defineProperty(media, 'matches', { value: true });
  const listener = vi.mocked(media.addEventListener).mock.calls[0][1] as () => void;
  listener();
  expect(state.isMobileViewport.value).toBe(true);
  wrapper.unmount();
  expect(media.removeEventListener).toHaveBeenCalledWith('change', listener);
});

it('traps Tab in both directions and restores the previous focus', async () => {
  const outside = document.createElement('button');
  document.body.append(outside);
  outside.focus();
  const active = ref(false);
  const wrapper = mount(
    defineComponent({
      setup() {
        const container = ref<HTMLElement | null>(null);
        useFocusTrap(active, () => container.value);
        return () => h('section', { ref: container }, [h('button', 'First'), h('button', 'Last')]);
      },
    }),
    { attachTo: document.body },
  );
  const [first, last] = wrapper.findAll('button');
  active.value = true;
  await nextTick();
  await nextTick();
  expect(document.activeElement).toBe(first.element);
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true }),
  );
  expect(document.activeElement).toBe(last.element);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
  expect(document.activeElement).toBe(first.element);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
  active.value = false;
  await nextTick();
  expect(document.activeElement).toBe(outside);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
  wrapper.unmount();
  const empty = host(() => useFocusTrap(true, () => null));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
  empty.wrapper.unmount();
});

it('fails clearly when the desktop context is missing', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(() => host(useDesktopExplorerContext)).toThrow('Desktop explorer context is unavailable');
});
