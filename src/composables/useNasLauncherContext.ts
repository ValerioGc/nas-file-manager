import { computed, onUnmounted, ref, watch } from 'vue';
import { useNasLauncherContext as useLauncherContext } from '@valeriogc/nas-base-app';
import { locale, messages, setLocale } from '@/i18n';

/** Whether the launcher holds the page: then language and theme are its own. */
export const nasContextActive = ref(false);
export const nasName = ref('nas');

/** The context of the launcher, with the catalogue of the application. */
export function useNasLauncherContext() {
  const { active, context } = useLauncherContext({
    onLocaleChange: (value) => setLocale(value, true),
  });
  // At once, before the language and the theme it brings are applied.
  watch(active, (value) => (nasContextActive.value = value), { flush: 'sync' });
  watch(
    () => context.value?.nasName,
    (name) => (nasName.value = name?.trim() || 'nas'),
    { flush: 'sync' },
  );
  onUnmounted(() => (nasContextActive.value = false));
  const t = computed(() => messages[locale.value]);
  return { locale, t };
}
