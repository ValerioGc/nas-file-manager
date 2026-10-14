import { beforeEach, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { file } from '../../helpers/fixtures';

/** The backend of the Explorer: the documents it keeps, by name, and the ones it was given. */
function backend(saved: Record<string, unknown> = {}) {
  const stored = new Map(
    Object.entries(saved).map(([name, value]) => [name, JSON.stringify(value)]),
  );
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const name = url.slice(url.lastIndexOf('/') + 1);
    if (init?.method === 'PUT') {
      stored.set(name, String(init.body));
      return new Response(null, { status: 204 });
    }
    return new Response(stored.get(name) ?? 'null');
  });
  vi.stubGlobal('fetch', fetch);
  return (name: string): unknown => JSON.parse(stored.get(name) ?? 'null');
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
});

it('loads preferences, saves changes on the backend and respects launcher-owned theme', async () => {
  const saved = backend({ preferences: { preferences: { compactList: true }, themeMode: 'dark' } });
  const { usePreferences, usePersistentRef, loadPreferences } =
    await import('@/composables/usePreferences');
  const { nasContextActive } = await import('@/composables/useNasLauncherContext');
  const state = usePreferences();
  expect(state.preferences.value.compactList).toBe(false);
  await loadPreferences();
  expect(state.preferences.value.compactList).toBe(true);
  expect(state.theme.value).toBe('dark');
  state.setTheme('light');
  await nextTick();
  expect(document.documentElement.dataset.theme).toBe('light');
  state.setTheme('auto');
  await nextTick();
  expect(state.theme.value).toBe('light');
  const calls = vi.mocked(window.matchMedia).mock.results;
  const media = calls[calls.length - 1].value;
  const callback = media.addEventListener.mock.calls[0][1];
  callback({ matches: true });
  expect(state.theme.value).toBe('dark');
  nasContextActive.value = true;
  state.setTheme('light');
  expect(state.themeMode.value).toBe('auto');
  state.preferences.value.compactList = false;
  state.preferences.value = { ...state.preferences.value, showHiddenFiles: true };
  await vi.advanceTimersByTimeAsync(400);
  expect(saved('preferences')).toEqual({
    preferences: expect.objectContaining({ compactList: false, showHiddenFiles: true }),
    themeMode: 'auto',
  });
  nasContextActive.value = false;
  const setting = usePersistentRef('setting', 7);
  expect(setting.value).toBe(7);
  setting.value = 9;
  await nextTick();
  expect(localStorage.getItem('setting')).toBe('9');
  expect(usePersistentRef('setting', 0).value).toBe(9);
});

it('keeps only the valid saved preferences', async () => {
  const { parseSettings } = await import('@/composables/usePreferences');
  expect(parseSettings('{')).toEqual(parseSettings(null));
  expect(parseSettings({ preferences: 3, themeMode: 'blue' }).themeMode).toBe('auto');
  expect(
    parseSettings({ preferences: { compactList: 'yes', showHiddenFiles: true, other: true } })
      .preferences,
  ).toEqual(expect.objectContaining({ compactList: false, showHiddenFiles: true }));
});

it('carries over the preferences and the favorites this browser kept before', async () => {
  localStorage.setItem('fs-explorer-preferences', JSON.stringify({ themeMode: 'light' }));
  localStorage.setItem('fs-explorer-favorites', JSON.stringify([file]));
  const saved = backend();
  const { loadPreferences, usePreferences } = await import('@/composables/usePreferences');
  const { loadFavorites, useFavorites } = await import('@/composables/useFavorites');
  await Promise.all([loadPreferences(), loadFavorites()]);
  expect(usePreferences().themeMode.value).toBe('light');
  expect(useFavorites().favorites.value).toEqual([file]);
  await vi.advanceTimersByTimeAsync(400);
  expect(saved('favorites')).toEqual([file]);
  expect(localStorage.getItem('fs-explorer-favorites')).toBeNull();
});

it('supports missing browser storage', async () => {
  vi.stubGlobal('localStorage', undefined);
  backend();
  const { usePreferences, usePersistentRef } = await import('@/composables/usePreferences');
  const state = usePreferences();
  state.setTheme('dark');
  const stored = usePersistentRef('missing', false);
  stored.value = true;
  await nextTick();
  expect(state.theme.value).toBe('dark');
  const { useFavorites } = await import('@/composables/useFavorites');
  useFavorites().addFavorite(file);
  await nextTick();
  expect(useFavorites().favorites.value).toEqual([file]);
});

it.each([3, {}, [null, 3, {}, { name: 'bad', path: 2 }, file]])(
  'validates saved favorites: %j',
  async (value) => {
    const saved = backend({ favorites: value });
    const { useFavorites, loadFavorites } = await import('@/composables/useFavorites');
    await loadFavorites();
    const state = useFavorites();
    expect(state.favorites.value).toEqual(Array.isArray(value) ? [file] : []);
    state.favorites.value = [];
    await nextTick();
    state.toggleFavorites([]);
    state.toggleFavorite(file);
    expect(state.isFavorite(file.path)).toBe(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(saved('favorites')).toEqual([file]);
    state.toggleFavorite(file);
    await vi.advanceTimersByTimeAsync(400);
    expect(saved('favorites')).toEqual([]);
  },
);
