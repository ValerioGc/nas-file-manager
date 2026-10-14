import { onBeforeUnmount, ref } from 'vue';

export function useLoading(initial = false) {
  const isLoading = ref(initial);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function triggerLoading(duration = 240) {
    isLoading.value = true;
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      isLoading.value = false;
    }, duration);
  }

  onBeforeUnmount(() => timer && clearTimeout(timer));

  return { isLoading, triggerLoading };
}
