<script setup lang="ts">

import { computed, onMounted, ref } from 'vue';
import chevronRightIcon from '@/assets/icons/chevron-right.svg?url';
import deleteIcon from '@/assets/icons/delete.svg?url';
import backIcon from '@/assets/icons/back.svg?url';
import infoIcon from '@/assets/icons/info.svg?url';
import ConfirmDialog from '@/components/common/ConfirmDialog.vue';
import EmptyPlaceholder from '@/components/common/EmptyPlaceholder.vue';
import { nasName } from '@/composables/useNasLauncherContext';
import { useTrash } from '@/composables/useTrash';
import { useI18n } from '@/i18n';
import {
  TrashFailure,
  emptyTrash,
  listTrash,
  listTrashDisks,
  purgeFromTrash,
  restoreFromTrash,
} from '@/services/trash';
import type { TrashDisk, TrashEntry } from '@/types/trash';
import formatSize from '@/utils/fileUtils';

/**
 * The trash of every disk: what was deleted, with the tree of the folders it came from, its size
 * and when it went in. An entry goes back where it was, or goes for good; a whole trash is emptied.
 */
const emit = defineEmits<{ restored: [] }>();
const { locale, t } = useI18n();
const { settings, disks, usageLoaded } = useTrash();
// The entries of each opened folder, and of each disk, by their path.
const children = ref<Record<string, TrashEntry[]>>({});
const opened = ref<string[]>([]);
const loading = ref(true);
const error = ref('');
const busy = ref(false);
type Pending =
  { kind: 'purge'; entry: TrashEntry } | { kind: 'replace'; entry: TrashEntry } | { kind: 'empty' };
const pending = ref<Pending | null>(null);

const totalItems = computed(() => disks.value.reduce((sum, disk) => sum + disk.items, 0));
const dates = computed(
  () => new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'short' }),
);
const confirmation = computed(() => {
  const asked = pending.value;
  if (!asked) {
    return { title: '', message: '', label: '' };
  }
  if (asked.kind === 'empty') {
    return {
      title: t.value.trashEmptyTitle,
      message: t.value.trashEmptyMessage,
      label: t.value.trashEmpty,
    };
  }
  if (asked.kind === 'replace') {
    return {
      title: t.value.trashReplaceTitle,
      message: t.value.trashReplaceMessage.replace('{name}', asked.entry.name),
      label: t.value.trashReplace,
    };
  }
  return {
    title: t.value.trashPurgeTitle,
    message: t.value.trashPurgeMessage.replace('{name}', asked.entry.name),
    label: t.value.trashPurge,
  };
});

function diskName(disk: TrashDisk) {
  return disk.name || nasName.value || t.value.thisPc;
}

function reason(failure: unknown) {
  return failure instanceof Error ? failure.message : t.value.trashUnavailable;
}

async function load() {
  loading.value = true;
  try {
    disks.value = await listTrashDisks();
    usageLoaded.value = true;
    const listed = await Promise.all(disks.value.map((disk) => listTrash(disk.id)));
    const next: Record<string, TrashEntry[]> = {};
    disks.value.forEach((disk, index) => (next[disk.id] = listed[index] ?? []));
    for (const path of opened.value) {
      next[path] = await listTrash(path).catch(() => []);
    }
    children.value = next;
    opened.value = opened.value.filter((path) => (next[path] ?? []).length > 0);
  } catch (error_) {
    error.value = reason(error_);
  } finally {
    loading.value = false;
  }
}

async function toggle(entry: TrashEntry) {
  if (opened.value.includes(entry.path)) {
    opened.value = opened.value.filter((path) => path !== entry.path);
    return;
  }
  try {
    children.value = { ...children.value, [entry.path]: await listTrash(entry.path) };
    opened.value = [...opened.value, entry.path];
  } catch (error_) {
    error.value = reason(error_);
  }
}

/** The rows of the tree as they show: each opened folder followed by what it holds. */
const rows = computed(() =>
  disks.value.map((disk) => {
    const shown: { entry: TrashEntry; depth: number }[] = [];
    const walk = (path: string, depth: number) => {
      for (const entry of children.value[path] ?? []) {
        shown.push({ entry, depth });
        if (opened.value.includes(entry.path)) {
          walk(entry.path, depth + 1);
        }
      }
    };
    walk(disk.id, 0);
    return { disk, shown };
  }),
);

async function act(work: () => Promise<unknown>) {
  busy.value = true;
  error.value = '';
  try {
    await work();
  } catch (error_) {
    error.value = reason(error_);
  } finally {
    busy.value = false;
  }
  await load();
}

async function restore(entry: TrashEntry, replace = false) {
  busy.value = true;
  error.value = '';
  try {
    await restoreFromTrash(entry.path, replace);
    emit('restored');
  } catch (error_) {
    if (error_ instanceof TrashFailure && error_.status === 409) {
      pending.value = { kind: 'replace', entry };
      busy.value = false;
      return;
    }
    error.value = reason(error_);
  } finally {
    busy.value = false;
  }
  await load();
}

function confirmed() {
  const asked = pending.value;
  pending.value = null;
  if (asked?.kind === 'replace') {
    void restore(asked.entry, true);
  } else if (asked?.kind === 'purge') {
    void act(() => purgeFromTrash(asked.entry.path));
  } else if (asked?.kind === 'empty') {
    void act(() => emptyTrash());
  }
}

onMounted(load);

</script>

<template>
  <section class="trash_view" :aria-label="t.trash" data-testid="trash_view">
    <header class="trash_header">
      <p class="trash_banner" data-testid="trash_note">
        <img class="icon_asset" :src="infoIcon" alt="" aria-hidden="true" />
        <span>{{
          settings.enabled
            ? t.trashNote.replace('{days}', String(settings.days))
            : t.trashOffNote.replace('{days}', String(settings.days))
        }}</span>
      </p>
      <button
        class="icon_button trash_empty"
        type="button"
        :aria-label="t.trashEmpty"
        :title="t.trashEmpty"
        :disabled="busy || totalItems === 0"
        data-testid="trash_empty"
        @click="pending = { kind: 'empty' }"
      >
        <img class="icon_asset" :src="deleteIcon" alt="" aria-hidden="true" />
      </button>
    </header>

    <p v-if="error" class="trash_error" role="alert">{{ error }}</p>
    <EmptyPlaceholder v-if="loading" :title="t.trashReading" loading />
    <EmptyPlaceholder
      v-else-if="totalItems === 0"
      :title="t.trashNothing"
      :icon="deleteIcon"
      testid="trash_nothing"
    />

    <template v-for="{ disk, shown } in rows" :key="disk.id">
      <section v-if="shown.length" class="trash_disk" :data-testid="`trash_disk_${disk.id}`">
        <h3>
          {{ diskName(disk) }}
          <small>{{ formatSize(disk.bytes) }}</small>
        </h3>
        <ul class="trash_rows">
          <li
            v-for="{ entry, depth } in shown"
            :key="entry.path"
            class="trash_row"
            :style="{ '--depth': depth }"
            :data-testid="`trash_entry_${entry.path}`"
          >
            <button
              v-if="entry.kind === 'folder'"
              class="icon_button trash_toggle"
              type="button"
              :aria-expanded="opened.includes(entry.path)"
              :aria-label="entry.name"
              @click="toggle(entry)"
            >
              <img
                class="icon_asset"
                :class="{ trash_toggle_open: opened.includes(entry.path) }"
                :src="chevronRightIcon"
                alt=""
                aria-hidden="true"
              />
            </button>
            <span v-else class="trash_toggle"></span>
            <span class="trash_name" :title="entry.path">{{ entry.name }}</span>
            <span class="trash_size">{{ formatSize(entry.size) }}</span>
            <span class="trash_date">{{ dates.format(entry.deletedAt * 1000) }}</span>
            <span class="trash_actions">
              <button
                class="icon_button"
                type="button"
                :disabled="busy"
                :aria-label="t.trashRestore.replace('{name}', entry.name)"
                :title="t.trashRestore.replace('{name}', entry.name)"
                :data-testid="`trash_restore_${entry.path}`"
                @click="restore(entry)"
              >
                <img class="icon_asset" :src="backIcon" alt="" aria-hidden="true" />
              </button>
              <button
                class="icon_button"
                type="button"
                :disabled="busy"
                :aria-label="t.trashPurgeOne.replace('{name}', entry.name)"
                :title="t.trashPurgeOne.replace('{name}', entry.name)"
                :data-testid="`trash_purge_${entry.path}`"
                @click="pending = { kind: 'purge', entry }"
              >
                <img class="icon_asset" :src="deleteIcon" alt="" aria-hidden="true" />
              </button>
            </span>
          </li>
        </ul>
      </section>
    </template>

    <ConfirmDialog
      :open="Boolean(pending)"
      :title="confirmation.title"
      :message="confirmation.message"
      :confirm-label="confirmation.label"
      :cancel-label="t.cancel"
      @close="pending = null"
      @confirm="confirmed"
    />
  </section>
</template>

<style scoped lang="scss">

.trash_view {
  display: grid;
  align-content: start;
  gap: 16px;
  min-height: 0;
  overflow: auto;
}

.trash_header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.trash_banner {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 10px;
  margin: 0;
  padding: 10px 14px;
  border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  color: var(--text);
  font-size: 13px;

  .icon_asset {
    flex: none;
    width: 20px;
    height: 20px;
  }
}

.trash_empty {
  flex: none;

  .icon_asset {
    width: 20px;
    height: 20px;
  }

  &:disabled {
    opacity: 0.45;
    cursor: default;
  }
}

.trash_error {
  margin: 0;
  color: var(--danger, #b12838);
}

.trash_disk {
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);

  h3 {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin: 0;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    font-size: 15px;
  }

  small {
    color: var(--muted);
    font-weight: 400;
  }
}

.trash_rows {
  @extend %reset_list;
}

.trash_row {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 90px 130px auto;
  align-items: center;
  gap: 8px;
  padding: 4px 12px 4px calc(12px + var(--depth) * 22px);

  &:hover {
    background: var(--surface-soft);
  }
}

.trash_toggle {
  width: 32px;
  height: 32px;
}

.trash_toggle_open {
  transform: rotate(90deg);
}

.trash_name {
  @extend %text_ellipsis;
}

.trash_size,
.trash_date {
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.trash_actions {
  display: inline-flex;
  gap: 4px;
}

@media (max-width: 720px) {
  .trash_row {
    grid-template-columns: 32px minmax(0, 1fr) auto;
  }

  .trash_size,
  .trash_date {
    display: none;
  }
}

</style>
