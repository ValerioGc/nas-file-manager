<script setup lang="ts">

import { ref, watch } from 'vue';
import closeIcon from '@/assets/icons/close.svg?url';
import BaseModal from '@/components/common/BaseModal.vue';
import FileThumbnail from '@/components/common/FileThumbnail.vue';
import { useI18n } from '@/i18n';
import type { FileEntry } from '@/types/files';
import { formatModified } from '@/services/filesystem';
import formatSize from '@/utils/fileUtils';

const props = defineProps<{
  archive: FileEntry | null;
  entries: FileEntry[];
  error: string;
  isLoaded: boolean;
  isLoading: boolean;
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
  submit: [password: string];
}>();

const { t } = useI18n();
const password = ref('');

watch(
  () => props.open,
  (open) => {
    if (open) {
      password.value = '';
    }
  },
);

function submit() {
  emit('submit', password.value);
}

</script>

<template>
  <BaseModal
    :open="open"
    :aria-label="t.openArchive"
    content-class="archive_dialog"
    @close="emit('close')"
  >
    <header class="archive_dialog_header">
      <div>
        <p class="archive_dialog_eyebrow">{{ t.archive }}</p>
        <h2>{{ archive?.name }}</h2>
      </div>
      <button
        class="icon_button archive_dialog_close"
        :aria-label="t.close"
        :title="t.close"
        type="button"
        @click="emit('close')"
      >
        <img class="icon_asset" :src="closeIcon" alt="" aria-hidden="true" />
      </button>
    </header>

    <form class="archive_dialog_unlock" @submit.prevent="submit">
      <label for="archive-password">{{ t.archivePassword }}</label>
      <input
        id="archive-password"
        v-model="password"
        type="password"
        autocomplete="current-password"
        :placeholder="t.archivePasswordPlaceholder"
      />
      <p>{{ t.archivePasswordHint }}</p>
      <button class="button primary" type="submit" :disabled="isLoading">
        {{ t.openArchive }}
      </button>
    </form>

    <p v-if="error" class="archive_dialog_error" role="alert">{{ error }}</p>
    <div v-if="isLoading" class="archive_dialog_loading" aria-live="polite">
      {{ t.loadingArchive }}
    </div>
    <div v-else-if="entries.length > 0" class="archive_dialog_entries">
      <div v-for="entry in entries" :key="entry.path" class="archive_dialog_entry">
        <FileThumbnail :file="entry" />
        <div class="archive_dialog_entry_copy">
          <strong>{{ entry.path }}</strong>
          <small>
            {{ entry.kind === 'folder' ? t.folders : formatSize(entry.size) }}
            <span v-if="entry.modified"> · {{ formatModified(entry.modified) }}</span>
          </small>
        </div>
      </div>
    </div>
    <p v-else-if="isLoaded" class="archive_dialog_empty">{{ t.archiveEmpty }}</p>
  </BaseModal>
</template>

<style scoped lang="scss">

.archive_dialog {
  width: min(680px, calc(100vw - 48px));
  padding: 24px;
}

.archive_dialog_header {
  @extend %fx_between;
  gap: 16px;
  margin-bottom: 20px;

  h2,
  p {
    margin: 0;
  }

  h2 {
    @extend %text_ellipsis;
    font-size: 20px;
  }
}

.archive_dialog_eyebrow {
  margin-bottom: 6px !important;
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.archive_dialog_close {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
}

.archive_dialog_unlock {
  display: grid;
  gap: 8px;

  label {
    font-weight: 700;
  }

  input {
    width: 100%;
    box-sizing: border-box;
  }

  p {
    margin: 0 0 4px;
    color: var(--muted);
    font-size: 12px;
  }

  .button {
    justify-self: end;
  }
}

.archive_dialog_error {
  margin: 16px 0 0;
  color: var(--danger, #e76f51);
  font-size: 13px;
}

.archive_dialog_loading,
.archive_dialog_empty {
  margin: 22px 0 0;
  color: var(--muted);
  text-align: center;
}

.archive_dialog_entries {
  display: grid;
  max-height: min(420px, 45vh);
  margin-top: 20px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 12px;
}

.archive_dialog_entry {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);

  &:last-child {
    border-bottom: 0;
  }

  :deep(.file_thumbnail) {
    flex: 0 0 auto;
    width: 38px;
    height: 38px;
    border-radius: 8px;
  }
}

.archive_dialog_entry_copy {
  display: grid;
  min-width: 0;
  gap: 3px;

  strong,
  small {
    @extend %text_ellipsis;
  }

  small {
    color: var(--muted);
  }
}

</style>
