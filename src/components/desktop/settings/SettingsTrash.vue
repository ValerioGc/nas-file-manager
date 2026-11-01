<script setup lang="ts">

import { onMounted, ref } from 'vue';
import deleteIcon from '@/assets/icons/delete.svg?url';
import ConfirmDialog from '@/components/common/ConfirmDialog.vue';
import SettingsRow from '@/components/common/SettingsRow.vue';
import SettingsSection from '@/components/common/SettingsSection.vue';
import { NasNumberStepper, NasSwitch } from '@valeriogc/nas-base-app';
import { refreshTrashUsage, useTrash } from '@/composables/useTrash';
import { useI18n } from '@/i18n';
import { emptyTrash } from '@/services/trash';
import formatSize from '@/utils/fileUtils';

const { t } = useI18n();
const {
  settings: trash,
  loaded: trashLoaded,
  save: saveTrash,
  items: trashItems,
  bytes: trashBytes,
  usageLoaded,
} = useTrash();
const trashError = ref('');
const trashBusy = ref(false);
const confirmingDisable = ref(false);
const emptyOnDisable = ref(false);
const confirmingEmpty = ref(false);

// Shown when the settings open, so the size is read again each time.
onMounted(() => void refreshTrashUsage());

function toggleTrash(enabled: boolean) {
  if (enabled) {
    void changeTrash(() => saveTrash({ enabled: true }));
    return;
  }
  emptyOnDisable.value = false;
  confirmingDisable.value = true;
}

function disableTrash() {
  confirmingDisable.value = false;
  void changeTrash(async () => {
    await saveTrash({ enabled: false });
    if (emptyOnDisable.value) {
      await emptyTrash();
    }
  });
}

async function changeTrash(change: () => Promise<unknown>) {
  trashBusy.value = true;
  trashError.value = '';
  try {
    await change();
  } catch {
    trashError.value = t.value.trashUnavailable;
  } finally {
    await refreshTrashUsage();
    trashBusy.value = false;
  }
}

function emptyTheTrash() {
  if (!confirmingEmpty.value) {
    confirmingEmpty.value = true;
    return;
  }
  confirmingEmpty.value = false;
  void changeTrash(() => emptyTrash());
}

</script>

<template>
  <SettingsSection :title="t.trash">
    <SettingsRow :title="t.trashEnabled" :description="t.trashEnabledDescription">
      <NasSwitch
        :model-value="trash.enabled"
        :label="t.trashEnabled"
        :disabled="!trashLoaded || trashBusy"
        testid="settings_trash"
        @update:model-value="toggleTrash"
      />
    </SettingsRow>
    <SettingsRow :description="t.trashDaysDescription">
      <template #title>
        <label for="settings-trash-days" class="settings_row_label">{{ t.trashDays }}</label>
      </template>
      <NasNumberStepper
        id="settings-trash-days"
        :model-value="trash.days"
        :min="1"
        :max="3650"
        :disabled="!trashLoaded || trashBusy || (!trash.enabled && trashItems === 0)"
        :increase-label="t.increase"
        :decrease-label="t.decrease"
        testid="settings_trash_days"
        @update:model-value="(days) => changeTrash(() => saveTrash({ days }))"
      />
    </SettingsRow>
    <SettingsRow :description="trashError">
      <template #title>
        <span data-testid="settings_trash_used">{{
          usageLoaded
            ? t.trashUsed.replace('{size}', formatSize(trashBytes))
            : t.previewCacheReading
        }}</span>
      </template>
      <button
        class="button secondary"
        type="button"
        :disabled="!trashLoaded || trashBusy || !usageLoaded || trashItems === 0"
        data-testid="settings_trash_empty"
        @click="emptyTheTrash"
      >
        <img class="icon_asset" :src="deleteIcon" alt="" aria-hidden="true" />
        {{ confirmingEmpty ? t.trashEmptyConfirm : t.previewCacheEmpty }}
      </button>
    </SettingsRow>
  </SettingsSection>
  <ConfirmDialog
    :open="confirmingDisable"
    :title="t.trashDisableTitle"
    :message="t.trashDisableMessage.replace('{days}', String(trash.days))"
    :confirm-label="t.trashDisable"
    :cancel-label="t.cancel"
    @close="confirmingDisable = false"
    @confirm="disableTrash"
  >
    <label class="empty_on_disable">
      <input v-model="emptyOnDisable" type="checkbox" data-testid="trash_empty_on_disable" />
      <span>{{ t.trashEmptyAlso }}</span>
    </label>
  </ConfirmDialog>
</template>

<style scoped lang="scss">

.empty_on_disable {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 20px;

  input {
    width: 18px;
    height: 18px;
    flex: none;
  }
}

</style>
