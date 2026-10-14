// Composable for handling viewport-related reactive state

import { onBeforeUnmount, onMounted, ref } from 'vue';

export function useMediaQuery(query: string) {
  const isMobileViewport = ref(false);
  let mediaQuery: MediaQueryList | undefined;

  const syncViewport = () => {
    isMobileViewport.value = Boolean(mediaQuery?.matches);
  };

  onMounted(() => {
    mediaQuery = window.matchMedia(query);
    syncViewport();
    mediaQuery.addEventListener('change', syncViewport);
  });

  onBeforeUnmount(() => mediaQuery?.removeEventListener('change', syncViewport));

  return { isMobileViewport };
}
