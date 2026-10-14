<script setup lang="ts">

import closeIcon from '@/assets/icons/close.svg?url';
import BaseModal from '@/components/common/BaseModal.vue';

defineProps<{
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();

</script>

<template>
  <BaseModal :open="open" :aria-label="title" content-class="confirm_dialog" @close="emit('close')">
    <div class="confirm_dialog_heading">
      <h2>{{ title }}</h2>
      <button
        class="icon_button confirm_dialog_close"
        :aria-label="cancelLabel"
        :title="cancelLabel"
        type="button"
        @click="emit('close')"
      >
        <img class="icon_asset" :src="closeIcon" alt="" aria-hidden="true" />
      </button>
    </div>

    <p class="confirm_dialog_message">{{ message }}</p>

    <div class="confirm_dialog_actions">
      <button class="button secondary" type="button" @click="emit('close')">
        {{ cancelLabel }}
      </button>
      <button class="button primary" type="button" @click="emit('confirm')">
        {{ confirmLabel }}
      </button>
    </div>
  </BaseModal>
</template>

<style scoped lang="scss">

/*
 * Through the backdrop, the root of BaseModal, which carries this component's scope: a rule that
 * starts with a bare :deep() compiles to an attribute selector alone, and PurgeCSS drops it from
 * the production build, so the dialog lost its width and padding.
 */
.modal_backdrop :deep(.confirm_dialog) {
  width: min(460px, calc(100vw - 48px));
  padding: 22px;
}

.confirm_dialog_heading,
.confirm_dialog_actions {
  @extend %fx_between;
}

.confirm_dialog_heading {
  gap: 18px;

  h2 {
    margin: 0;
    font-size: 18px;
  }
}

.confirm_dialog_close {
  flex: 0 0 auto;
  font-size: 22px;
}

.confirm_dialog_message {
  margin: 18px 0 0;
  color: var(--muted);
  line-height: 1.5;
}

.confirm_dialog_actions {
  justify-content: flex-end;
  gap: 8px;
  margin-top: 24px;
}

</style>
