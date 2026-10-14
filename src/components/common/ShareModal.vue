<script setup lang="ts">

import { computed, ref, watch } from 'vue';
import BaseModal from '@/components/common/BaseModal.vue';
import closeIcon from '@/assets/icons/close.svg?url';
import shareIcon from '@/assets/icons/share.svg?url';
import { useShares } from '@/composables/useShares';
import { useI18n } from '@/i18n';
import { confirmSharePassword, type PasswordOutcome } from '@/services/shares';
import type { FileEntry } from '@/types/files';

const props = defineProps<{ open: boolean; folder: FileEntry | null }>();

const emit = defineEmits<{
  close: [];
  /** What happened, for the notice of the page. */
  done: [message: string];
}>();

const { t } = useI18n();
const { overview, shareOf, share, unshare } = useShares();
const isProtected = ref(true);
const writable = ref(false);
const password = ref('');
const error = ref('');
const busy = ref(false);

const current = computed(() => (props.folder ? shareOf(props.folder.path) : null));
const host = typeof window === 'undefined' ? 'nas' : window.location.hostname || 'nas';
const addresses = computed(() =>
  current.value
    ? [`\\\\${host}\\${current.value.name}`, `smb://${host}/${encodeURI(current.value.name)}`]
    : [],
);

// Samba keeps its own copy of the password: it is asked only when no protected share made one.
const needsPassword = computed(
  () =>
    isProtected.value &&
    !current.value?.protected &&
    !overview.value.shares.some((item) => item.protected),
);

watch(
  () => [props.open, props.folder?.path] as const,
  ([open]) => {
    if (open) {
      isProtected.value = current.value?.protected ?? true;
      writable.value = current.value?.writable ?? false;
      password.value = '';
      error.value = '';
    }
  },
  { immediate: true },
);

const passwordErrors: Record<
  Exclude<PasswordOutcome, 'ok'>,
  'sharePasswordWrong' | 'sharePasswordThrottled' | 'shareUnavailable' | 'operationFailed'
> = {
  wrong: 'sharePasswordWrong',
  throttled: 'sharePasswordThrottled',
  unavailable: 'shareUnavailable',
  failed: 'operationFailed',
};

async function submit() {
  const folder = props.folder;
  if (!folder || busy.value) {
    return;
  }
  error.value = '';
  busy.value = true;
  try {
    if (needsPassword.value) {
      const outcome = await confirmSharePassword(password.value);
      if (outcome !== 'ok') {
        error.value = t.value[passwordErrors[outcome]];
        return;
      }
    }
    const saved = await share(folder.path, {
      writable: writable.value,
      protected: isProtected.value,
    });
    emit('done', t.value.shareSaved.replace('{name}', saved.name));
    emit('close');
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : t.value.operationFailed;
  } finally {
    busy.value = false;
  }
}

async function stopSharing() {
  const folder = props.folder;
  if (!folder || busy.value) {
    return;
  }
  error.value = '';
  busy.value = true;
  try {
    await unshare(folder.path);
    emit('done', t.value.shareRemoved.replace('{name}', folder.name));
    emit('close');
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : t.value.operationFailed;
  } finally {
    busy.value = false;
  }
}

</script>

<template>
  <BaseModal
    :open="open && Boolean(folder)"
    :aria-label="t.shareTitle"
    content-class="share_modal"
    @close="emit('close')"
  >
    <form v-if="folder" data-testid="share_modal" @submit.prevent="submit">
      <div class="share_modal_heading">
        <span class="share_modal_symbol" aria-hidden="true">
          <img class="icon_asset" :src="shareIcon" alt="" />
        </span>
        <div>
          <h2>{{ t.shareTitle }}</h2>
          <p class="share_modal_folder">{{ folder.name }}</p>
        </div>
        <button
          class="icon_button share_modal_close"
          :aria-label="t.close"
          :title="t.close"
          type="button"
          @click="emit('close')"
        >
          <img class="icon_asset" :src="closeIcon" alt="" aria-hidden="true" />
        </button>
      </div>

      <p class="share_modal_intro">{{ current ? t.shareActiveHint : t.shareHint }}</p>

      <ul v-if="addresses.length" class="share_modal_addresses" :aria-label="t.shareAddresses">
        <li v-for="address in addresses" :key="address">
          <code>{{ address }}</code>
        </li>
      </ul>

      <fieldset class="share_modal_group">
        <legend>{{ t.sharePermissions }}</legend>
        <label class="share_modal_choice" :class="{ chosen: !writable }">
          <input
            v-model="writable"
            name="share_access"
            type="radio"
            :value="false"
            data-testid="share_read_only"
          />
          <span>
            <strong>{{ t.shareReadOnly }}</strong>
            <small>{{ t.shareReadOnlyHint }}</small>
          </span>
        </label>
        <label class="share_modal_choice" :class="{ chosen: writable }">
          <input
            v-model="writable"
            name="share_access"
            type="radio"
            :value="true"
            data-testid="share_writable"
          />
          <span>
            <strong>{{ t.shareWritable }}</strong>
            <small>{{ t.shareWritableHint }}</small>
          </span>
        </label>
      </fieldset>

      <label class="share_modal_protection">
        <span>
          <strong>{{ t.shareProtect }}</strong>
          <small>
            {{
              isProtected
                ? t.shareProtectHint.replace('{user}', overview.user ?? '-')
                : t.shareOpenHint
            }}
          </small>
        </span>
        <input
          v-model="isProtected"
          name="share_protected"
          type="checkbox"
          data-testid="share_protected"
        />
      </label>

      <label v-if="needsPassword" class="share_modal_password">
        <span>{{ t.sharePassword }}</span>
        <input
          v-model="password"
          name="share_password"
          type="password"
          autocomplete="current-password"
          required
          data-testid="share_password"
        />
        <small>{{ t.sharePasswordHint }}</small>
      </label>

      <p v-if="error" class="share_modal_error" role="alert">{{ error }}</p>

      <div class="share_modal_actions">
        <button
          v-if="current"
          class="button secondary share_modal_stop"
          type="button"
          :disabled="busy"
          data-testid="share_stop"
          @click="stopSharing"
        >
          {{ t.shareStop }}
        </button>
        <button class="button secondary" type="button" @click="emit('close')">
          {{ t.cancel }}
        </button>
        <button class="button primary" type="submit" :disabled="busy" data-testid="share_submit">
          {{ current ? t.save : t.shareConfirm }}
        </button>
      </div>
    </form>
  </BaseModal>
</template>

<style scoped lang="scss">

// Through the backdrop, the root of BaseModal, as FileNameModal does: PurgeCSS keeps the rule.
.modal_backdrop :deep(.share_modal) {
  width: min(540px, calc(100vw - 48px));
  padding: 22px;
}

.share_modal_heading {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;

  h2 {
    margin: 0;
    font-size: 18px;
  }
}

.share_modal_symbol {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--accent-soft);

  img {
    width: 22px;
    height: 22px;
  }
}

.share_modal_folder {
  @extend %text_ellipsis;
  margin: 2px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.share_modal_close {
  font-size: 22px;
}

.share_modal_intro {
  margin: 0 0 14px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
}

.share_modal_addresses {
  display: grid;
  gap: 6px;
  margin: 0 0 16px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--surface-soft);
  list-style: none;

  code {
    font-size: 12px;
    word-break: break-all;
  }
}

.share_modal_group {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 0 0 14px;
  padding: 0;
  border: 0;

  legend {
    margin-bottom: 8px;
    color: var(--muted);
    font-size: 12px;
    font-weight: 650;
  }
}

.share_modal_choice {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-soft);
  cursor: pointer;

  &.chosen {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  input {
    margin-top: 3px;
    accent-color: var(--accent);
  }

  span {
    display: grid;
    gap: 3px;
  }

  strong {
    font-size: 13px;
  }

  small {
    color: var(--muted);
    font-size: 11px;
    line-height: 1.4;
  }
}

.share_modal_protection {
  @extend %fx_between;
  gap: 16px;
  padding: 12px 0;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  cursor: pointer;

  span {
    display: grid;
    gap: 3px;
  }

  strong {
    font-size: 13px;
  }

  small {
    color: var(--muted);
    font-size: 11px;
    line-height: 1.4;
  }
}

.share_modal_password {
  display: grid;
  gap: 6px;
  margin-top: 14px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 650;

  input {
    width: 100%;
    min-height: 40px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 9px;
    color: var(--text);
    background: var(--surface-soft);
    outline: 0;

    &:focus {
      border-color: var(--accent);
    }
  }

  small {
    font-weight: 400;
    font-size: 11px;
  }
}

.share_modal_error {
  margin: 12px 0 0;
  color: #db5965;
  font-size: 12px;
}

.share_modal_actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 22px;
}

.share_modal_stop {
  margin-right: auto;
  color: #db5965;
}

@media (max-width: 560px) {
  .share_modal_group {
    grid-template-columns: minmax(0, 1fr);
  }
}

</style>
