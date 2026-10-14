import { computed, ref, watch, type Ref } from 'vue';
import { nasContextActive } from '@/composables/useNasLauncherContext';
import { appApiUrl } from '@/services/apiUrl';
import { storedDocument } from '@valeriogc/nas-base-app';

export type ThemeMode = 'auto' | 'dark' | 'light';

export type Preferences = {
  animatedPreviews: boolean;
  coloredNavigation: boolean;
  compactList: boolean;
  confirmBeforeDelete: boolean;
  detailsPanel: boolean;
  detailsInGrid: boolean;
  detailsInList: boolean;
  generatePreviews: boolean;
  showFileExtensions: boolean;
  showFreeSpace: boolean;
  showHiddenFiles: boolean;
};

type Settings = { preferences: Preferences; themeMode: ThemeMode };

const defaultPreferences: Preferences = {
  animatedPreviews: true,
  coloredNavigation: false,
  compactList: false,
  confirmBeforeDelete: true,
  detailsPanel: true,
  detailsInGrid: true,
  detailsInList: true,
  generatePreviews: true,
  showFileExtensions: true,
  showFreeSpace: true,
  showHiddenFiles: false,
};
const themeModes: ThemeMode[] = ['auto', 'dark', 'light'];

/** What was saved, kept only where it is valid: anything else falls back to the default. */
export function parseSettings(saved: unknown): Settings {
  const stored: { preferences?: unknown; themeMode?: unknown } =
    saved && typeof saved === 'object' ? saved : {};
  const values: Partial<Record<keyof Preferences, unknown>> =
    stored.preferences && typeof stored.preferences === 'object' ? stored.preferences : {};
  const preferences = { ...defaultPreferences };
  for (const key of Object.keys(defaultPreferences) as (keyof Preferences)[]) {
    const value = values[key];
    if (typeof value === 'boolean') {
      preferences[key] = value;
    }
  }
  return {
    preferences,
    themeMode: themeModes.find((mode) => mode === stored.themeMode) ?? 'auto',
  };
}

// Shared by every browser that opens the Explorer, through its backend.
const settings = storedDocument('preferences', {
  parse: parseSettings,
  url: appApiUrl,
  legacyKey: 'fs-explorer-preferences',
});
const preferences = computed<Preferences>({
  get: () => settings.value.value.preferences,
  set: (value) => (settings.value.value = { ...settings.value.value, preferences: value }),
});
const themeMode = computed<ThemeMode>({
  get: () => settings.value.value.themeMode,
  set: (value) => (settings.value.value = { ...settings.value.value, themeMode: value }),
});
const systemDark = ref(matchesSystemDark());
const systemTheme = computed<'dark' | 'light'>(() => (systemDark.value ? 'dark' : 'light'));
const theme = computed<'dark' | 'light'>(() =>
  themeMode.value === 'auto' ? systemTheme.value : themeMode.value,
);

if (typeof window !== 'undefined') {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', (event) => (systemDark.value = event.matches));
}

watch(theme, applyTheme, { immediate: true });

export const loadPreferences = settings.load;

export function usePreferences() {
  function setTheme(value: ThemeMode) {
    if (nasContextActive.value) {
      return;
    }
    themeMode.value = value;
  }

  return { preferences, setTheme, theme, themeMode };
}

/** Whether the details panel is shown in a view: on, and on for that view. */
export function showsDetails(values: Preferences, viewMode: 'grid' | 'list') {
  return values.detailsPanel && (viewMode === 'list' ? values.detailsInList : values.detailsInGrid);
}

export function usePersistentRef<T>(key: string, fallback: T): Ref<T> {
  const state = ref(readStored(key, fallback)) as Ref<T>;
  watch(state, (value) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(value));
    }
  });
  return state;
}

function applyTheme(value: 'dark' | 'light') {
  if (typeof document !== 'undefined' && !nasContextActive.value) {
    document.documentElement.dataset.theme = value;
  }
}

function matchesSystemDark() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function readStored<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') {
    return fallback;
  }
  try {
    return JSON.parse(localStorage.getItem(key) ?? '') as T;
  } catch {
    return fallback;
  }
}
