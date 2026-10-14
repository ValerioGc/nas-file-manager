<script setup lang="ts">

import { ref, watch } from 'vue';
import closeIcon from '@/assets/icons/close.svg?url';
import BaseModal from '@/components/common/BaseModal.vue';
import { useI18n } from '@/i18n';
import type { ConflictAction, ConflictDecision, FileConflict } from '@/types/conflicts';
import { validateFileName } from '@/utils/fileNameValidation';

const props = withDefaults(
  defineProps<{
    open: boolean;
    conflicts: FileConflict[];
    isSubmitting?: boolean;
  }>(),
  { isSubmitting: false },
);

const emit = defineEmits<{
  close: [];
  confirm: [decisions: ConflictDecision[]];
}>();

const { t } = useI18n();
const decisions = ref<Record<string, ConflictDecision>>({});
const errors = ref<Record<string, string>>({});

watch(
  () => [props.open, props.conflicts] as const,
  ([open, conflicts]) => {
    if (!open) {
      return;
    }
    decisions.value = Object.fromEntries(
      conflicts.map((conflict) => [
        conflict.file.path,
        {
          sourcePath: conflict.file.path,
          action: 'skip' as ConflictAction,
          name: suggestedName(conflict.file.name),
        },
      ]),
    );
    errors.value = {};
  },
  { immediate: true },
);

function suggestedName(name: string) {
  const extensionIndex = name.lastIndexOf('.');
  if (extensionIndex <= 0) {
    return `${name} (copy)`;
  }
  return `${name.slice(0, extensionIndex)} (copy)${name.slice(extensionIndex)}`;
}

function updateAction(sourcePath: string, action: ConflictAction) {
  const decision = decisions.value[sourcePath];
  if (decision) {
    decision.action = action;
    delete errors.value[sourcePath];
  }
}

function updateName(sourcePath: string, name: string) {
  const decision = decisions.value[sourcePath];
  if (decision) {
    decision.name = name;
    delete errors.value[sourcePath];
  }
}

function confirmConflicts() {
  const nextErrors: Record<string, string> = {};
  for (const decision of Object.values(decisions.value)) {
    if (decision.action !== 'rename') {
      continue;
    }
    const validationKey = validateFileName(decision.name ?? '', false);
    if (validationKey) {
      nextErrors[decision.sourcePath] = t.value[validationKey];
    }
  }
  errors.value = nextErrors;
  if (Object.keys(nextErrors).length > 0) {
    return;
  }
  emit('confirm', Object.values(decisions.value));
}

</script>

<template>
  <BaseModal
    :open="open"
    :aria-label="t.conflictTitle"
    content-class="conflict_dialog"
    @close="emit('close')"
  >
    <div class="conflict_dialog_heading">
      <div>
        <h2>{{ t.conflictTitle }}</h2>
        <p>{{ t.conflictDescription }}</p>
      </div>
      <button
        class="icon_button conflict_dialog_close"
        :aria-label="t.close"
        :title="t.close"
        type="button"
        @click="emit('close')"
      >
        <img class="icon_asset" :src="closeIcon" alt="" aria-hidden="true" />
      </button>
    </div>

    <div class="conflict_dialog_list">
      <div v-for="conflict in conflicts" :key="conflict.file.path" class="conflict_item">
        <div class="conflict_item_copy">
          <strong>{{ conflict.file.name }}</strong>
          <small>{{ t.conflictExisting }}: {{ conflict.existing.path }}</small>
        </div>
        <label class="conflict_item_choice">
          <span>{{ t.conflictAction }}</span>
          <select
            name="conflict_action"
            :value="decisions[conflict.file.path]?.action"
            @change="
              updateAction(
                conflict.file.path,
                ($event.target as HTMLSelectElement).value as ConflictAction,
              )
            "
          >
            <option value="overwrite">{{ t.overwrite }}</option>
            <option value="rename">{{ t.renameCopy }}</option>
            <option value="skip">{{ t.skip }}</option>
          </select>
        </label>
        <label v-if="decisions[conflict.file.path]?.action === 'rename'" class="conflict_item_name">
          <span>{{ t.newName }}</span>
          <input
            name="conflict_name"
            :value="decisions[conflict.file.path]?.name"
            type="text"
            @input="updateName(conflict.file.path, ($event.target as HTMLInputElement).value)"
          />
          <p v-if="errors[conflict.file.path]" class="conflict_item_error">
            {{ errors[conflict.file.path] }}
          </p>
        </label>
      </div>
    </div>

    <div class="conflict_dialog_actions">
      <button class="button secondary" type="button" @click="emit('close')">
        {{ t.skip }}
      </button>
      <button
        class="button primary"
        type="button"
        :disabled="isSubmitting"
        @click="confirmConflicts"
      >
        {{ t.confirm }}
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
.modal_backdrop :deep(.conflict_dialog) {
  width: min(600px, calc(100vw - 48px));
  padding: 22px;
}

.conflict_dialog_heading,
.conflict_dialog_actions {
  @extend %fx_between;
}

.conflict_dialog_heading {
  gap: 18px;
  margin-bottom: 18px;

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: 18px;
  }

  p {
    margin-top: 5px;
    color: var(--muted);
    font-size: 12px;
  }
}

.conflict_dialog_close {
  flex: 0 0 auto;
  font-size: 22px;
}

.conflict_dialog_list {
  display: grid;
  gap: 10px;
  max-height: 360px;
  overflow-y: auto;
}

.conflict_item {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-soft);
}

.conflict_item_copy,
.conflict_item_choice,
.conflict_item_name {
  display: grid;
  gap: 4px;
}

.conflict_item_copy {
  min-width: 0;

  strong,
  small {
    @extend %text_ellipsis;
  }

  small,
  span {
    color: var(--muted);
    font-size: 11px;
  }
}

.conflict_item_choice,
.conflict_item_name {
  span {
    color: var(--muted);
    font-size: 11px;
  }

  select,
  input {
    min-height: 34px;
    padding: 0 9px;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    background: var(--surface);
    outline: 0;
  }
}

.conflict_dialog_actions {
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}

.conflict_item_error {
  margin: 0;
  color: #db5965;
  font-size: 11px;
}

</style>
