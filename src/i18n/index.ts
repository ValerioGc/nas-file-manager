import { computed, ref } from 'vue';
import { en } from '@/i18n/locales/en';
import { it } from '@/i18n/locales/it';
import { nasContextActive } from '@/composables/useNasLauncherContext';

export type Locale = 'it' | 'en';
export const messages = { en, it } as const;

const storageKey = 'fs-explorer-locale';
export const locale = ref<Locale>(readLocale());

if (typeof document !== 'undefined') {
  document.documentElement.lang = locale.value;
}

export function useI18n() {
  const t = computed(() => messages[locale.value]);
  return { locale, t, setLocale };
}

function readLocale(): Locale {
  if (typeof localStorage === 'undefined') {
    return 'en';
  }
  return localStorage.getItem(storageKey) === 'it' ? 'it' : 'en';
}

export function setLocale(value: Locale, fromLauncher = false) {
  if (nasContextActive.value && !fromLauncher) {
    return;
  }
  locale.value = value;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = value;
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(storageKey, value);
  }
}
