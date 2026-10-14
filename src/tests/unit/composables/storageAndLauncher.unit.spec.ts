import { expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { useStorage, refreshStorage } from '@/composables/useStorage';
import { getStorageInfo } from '@/services/filesystem';
import {
  useNasLauncherContext,
  nasContextActive,
  nasName,
} from '@/composables/useNasLauncherContext';
import { locale, setLocale } from '@/i18n';
vi.mock('@/services/filesystem', () => ({ getStorageInfo: vi.fn() }));

it('loads and refreshes storage, reports errors and always clears loading', async () => {
  await refreshStorage();
  const storage = { usedBytes: 25, totalBytes: 100, availableBytes: 75 };
  vi.mocked(getStorageInfo).mockResolvedValue(storage);
  let state!: ReturnType<typeof useStorage>;
  mount(
    defineComponent({
      setup() {
        state = useStorage();
        return () => h('div');
      },
    }),
  );
  expect(state.isLoading.value).toBe(true);
  await flushPromises();
  expect(state.storage.value).toEqual(storage);
  vi.mocked(getStorageInfo).mockRejectedValueOnce(new Error('Offline'));
  await refreshStorage();
  expect(state.error.value).toBe('Offline');
  vi.mocked(getStorageInfo).mockRejectedValueOnce(null);
  await state.loadStorage();
  expect(state.error.value).toBeTruthy();
  expect(state.isLoading.value).toBe(false);
  await state.loadStorage();
  expect(state.error.value).toBe('');
});

it('applies URL and launcher context and unregisters the listener', async () => {
  window.history.replaceState({}, '', '/?lang=it&theme=dark');
  vi.stubGlobal('CSS', { supports: vi.fn((_: string, value: string) => value === 'red') });
  const originalParent = Object.getOwnPropertyDescriptor(window, 'parent');
  const parent = { postMessage: vi.fn() };
  Object.defineProperty(window, 'parent', { configurable: true, value: parent });
  const arrive = (context: Record<string, unknown>) => {
    const event = new MessageEvent('message', {
      origin: window.location.origin,
      data: { nas: 1, type: 'context', context: { app: 'nas-file-manager', ...context } },
    });
    Object.defineProperty(event, 'source', { value: parent });
    window.dispatchEvent(event);
  };
  let state!: ReturnType<typeof useNasLauncherContext>;
  const wrapper = mount(
    defineComponent({
      setup() {
        state = useNasLauncherContext();
        return () => h('p', state.t.value.appName);
      },
    }),
  );
  expect(locale.value).toBe('it');
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(parent.postMessage).toHaveBeenCalledWith(
    { nas: 1, type: 'ready' },
    window.location.origin,
  );
  arrive({ nasName: ' My NAS ', theme: 'light', accent: 'red', locale: 'en' });
  expect(nasName.value).toBe('My NAS');
  expect(nasContextActive.value).toBe(true);
  expect(document.documentElement.style.getPropertyValue('--accent')).toBe('red');
  expect(locale.value).toBe('en');
  setLocale('it');
  expect(locale.value).toBe('en');
  arrive({ nasName: ' ', theme: 'dark', accent: 'invalid', locale: 'fr' });
  expect(nasName.value).toBe('nas');
  arrive({ nasName: 'Home', theme: 'dark', accent: 'invalid', locale: 'fr' });
  arrive({ theme: 'dark', accent: 'invalid', locale: 'fr' });
  expect(nasName.value).toBe('nas');
  expect(document.documentElement.style.getPropertyValue('--accent')).toBe('');
  wrapper.unmount();
  expect(nasContextActive.value).toBe(false);
  // Unmounted, it no longer follows the launcher.
  arrive({ nasName: 'Other', theme: 'dark', accent: 'red', locale: 'en' });
  expect(nasName.value).toBe('nas');
  if (originalParent) {
    Object.defineProperty(window, 'parent', originalParent);
  }
  window.history.replaceState({}, '', '/');
  mount(
    defineComponent({
      setup() {
        useNasLauncherContext();
        return () => h('div');
      },
    }),
  );
  expect(document.documentElement.dataset.theme).toBe('light');
  vi.unstubAllGlobals();
});
