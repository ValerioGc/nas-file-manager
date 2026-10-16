<script setup lang="ts">

import { ref, watch } from 'vue';
import BaseModal from '@/components/common/BaseModal.vue';
import closeIcon from '@/assets/icons/close.svg?url';
import { useI18n } from '@/i18n';
import { validateFileName, type FileNameValidationError } from '@/utils/fileNameValidation';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    initialName?: string;
    hint?: string;
    requireExtension?: boolean;
    submitLabel: string;
    error?: string;
    isSubmitting?: boolean;
  }>(),
  {
    initialName: '',
    hint: '',
    requireExtension: false,
    error: '',
    isSubmitting: false,
  },
);

const emit = defineEmits<{
  close: [];
  submit: [name: string];
  'clear-error': [];
}>();

const { t } = useI18n();
const draftName = ref('');
const validationError = ref('');

watch(
  () => [props.open, props.initialName] as const,
  ([open, initialName]) => {
    if (open) {
      draftName.value = initialName;
      validationError.value = '';
    }
  },
  { immediate: true },
);

function handleInput() {
  validationError.value = '';
  emit('clear-error');
}

function submitName() {
  const validationKey = validateFileName(draftName.value, props.requireExtension);
  if (validationKey) {
    validationError.value = getValidationMessage(validationKey);
    return;
  }
  emit('submit', draftName.value.trim());
}

function getValidationMessage(key: FileNameValidationError) {
  return t.value[key];
}

</script>

<template>
  <BaseModal
    :open="open"
    :aria-label="title"
    content-class="file_name_modal"
    @close="emit('close')"
  >
    <form @submit.prevent="submitName">
      <div class="file_name_modal_heading">
        <h2>{{ title }}</h2>
        <button
          class="icon_button file_name_modal_close"
          :aria-label="t.close"
          :title="t.close"
          type="button"
          @click="emit('close')"
        >
          <img class="icon_asset" :src="closeIcon" alt="" aria-hidden="true" />
        </button>
      </div>

      <label class="file_name_modal_label" for="file-name-input">{{ t.name }}</label>
      <p v-if="hint" class="file_name_modal_hint">{{ hint }}</p>
      <input
        id="file-name-input"
        v-model="draftName"
        class="file_name_modal_input"
        type="text"
        autocomplete="off"
        autofocus
        :aria-invalid="Boolean(validationError || error)"
        :aria-describedby="validationError || error ? 'file-name-error' : undefined"
        @input="handleInput"
      />
      <p v-if="validationError || error" id="file-name-error" class="file_name_modal_error">
        {{ validationError || error }}
      </p>

      <div class="file_name_modal_actions">
        <button class="button secondary" type="button" @click="emit('close')">
          {{ t.close }}
        </button>
        <button class="button primary" type="submit" :disabled="isSubmitting">
          {{ submitLabel }}
        </button>
      </div>
    </form>
  </BaseModal>
</template>

<style scoped lang="scss">

/*
 * Through the backdrop, the root of BaseModal, which carries this component's scope: a rule that
 * starts with a bare :deep() compiles to an attribute selector alone, and PurgeCSS drops it from
 * the production build, so the dialog lost its width and padding.
 */
.modal_backdrop :deep(.file_name_modal) {
  width: min(520px, calc(100vw - 48px));
  padding: 22px;
}

.file_name_modal_heading,
.file_name_modal_actions {
  @extend %fx_between;
}

.file_name_modal_heading {
  margin-bottom: 22px;

  h2 {
    margin: 0;
    font-size: 18px;
  }
}

.file_name_modal_close {
  font-size: 22px;
}

.file_name_modal_label {
  display: block;
  margin-bottom: 8px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 650;
}

.file_name_modal_input {
  @extend %text_field;
}

.file_name_modal_hint {
  margin: -2px 0 8px;
  color: var(--muted);
  font-size: 11px;
}

.file_name_modal_error {
  margin: 8px 0 0;
  color: #db5965;
  font-size: 11px;
}

.file_name_modal_actions {
  justify-content: flex-end;
  gap: 8px;
  margin-top: 24px;
}

</style>
