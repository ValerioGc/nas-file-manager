<script setup lang="ts">

import { computed, ref } from 'vue';
import { useFocusTrap } from '@/composables/useFocusTrap';

const props = withDefaults(
  defineProps<{
    // Keep the public prop name aligned with the accessibility attribute used by callers.
    // eslint-disable-next-line vue/prop-name-casing
    'aria-label': string;
    contentClass?: string;
    open: boolean;
  }>(),
  { contentClass: '' },
);

const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLElement | null>(null);
const isOpen = computed(() => props.open);

useFocusTrap(isOpen, () => dialog.value);

</script>

<template>
  <div v-if="open" class="modal_backdrop" @click.self="emit('close')">
    <dialog
      ref="dialog"
      open
      class="base_modal"
      :class="contentClass"
      aria-modal="true"
      :aria-label="props['aria-label']"
      tabindex="-1"
      @keydown.esc.stop="emit('close')"
    >
      <slot name="header"></slot>
      <slot></slot>
      <slot name="footer"></slot>
    </dialog>
  </div>
</template>

<style scoped lang="scss">

// Undoes the browser placement of an open <dialog>: the backdrop centres it. `:where` keeps the
// reset below the content classes of the callers.
:where(.base_modal) {
  position: static;
  margin: 0;
  padding: 0;
}

.base_modal {
  width: min(430px, 100%);
  max-height: min(740px, calc(100vh - 40px));
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 16px;
  color: var(--text);
  background: var(--surface);
  box-shadow: var(--shadow);
}

</style>
