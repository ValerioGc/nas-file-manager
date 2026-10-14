import { nextTick, onBeforeUnmount, onMounted, watch, type MaybeRef, unref } from 'vue';

const focusableSelector =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(active: MaybeRef<boolean>, container: () => HTMLElement | null) {
  let previousFocus: HTMLElement | null = null;

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Tab' || !unref(active)) {
      return;
    }
    const elements = Array.from(
      container()?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
    );
    const last = elements.at(-1);
    if (!last) {
      return;
    }
    const first = elements[0];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  watch(
    () => unref(active),
    (open) => {
      if (open) {
        previousFocus =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        void nextTick(() => container()?.querySelector<HTMLElement>(focusableSelector)?.focus());
      } else {
        previousFocus?.focus();
        previousFocus = null;
      }
    },
  );
  onMounted(() => document.addEventListener('keydown', onKeydown));
  onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
}
