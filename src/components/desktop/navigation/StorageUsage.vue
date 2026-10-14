<script lang="ts" setup>

import { computed } from 'vue';
import chevronDownIcon from '@/assets/icons/chevron-down.svg?url';
import { usePersistentRef } from '@/composables/usePreferences';
import { useStorage } from '@/composables/useStorage';
import { useI18n } from '@/i18n';
import { calculateUsagePercentage, formatStorageBytes } from '@/utils/storage';

const { t } = useI18n();

const props = withDefaults(defineProps<{ compact?: boolean }>(), {
  compact: false,
});

const { storage } = useStorage();
const isStorageCollapsed = usePersistentRef('fs-explorer-desktop-storage-collapsed', false);

const storageUsagePercentage = computed(() => {
  if (!storage.value) {
    return 0;
  }

  return calculateUsagePercentage(storage.value.usedBytes, storage.value.totalBytes);
});

</script>

<template>
  <div class="storage" :class="{ compact: props.compact }">
    <section
      class="storage_card"
      :class="{ collapsed: isStorageCollapsed, compact: props.compact }"
    >
      <div v-if="!props.compact" class="storage_heading">
        <span>{{ t.storage }}</span>
        <button
          class="icon_button storage_toggle"
          :aria-label="isStorageCollapsed ? t.expandStorage : t.collapseStorage"
          :title="isStorageCollapsed ? t.expandStorage : t.collapseStorage"
          type="button"
          @click="isStorageCollapsed = !isStorageCollapsed"
        >
          <img
            class="icon_asset storage_toggle_icon"
            :class="{ collapsed: !isStorageCollapsed }"
            :src="chevronDownIcon"
            alt=""
            aria-hidden="true"
          />
        </button>
      </div>

      <div v-if="!props.compact" class="progress_row">
        <div class="progress"><span :style="{ width: `${storageUsagePercentage}%` }"></span></div>
        <strong>{{ storageUsagePercentage }}%</strong>
      </div>
      <div v-if="!props.compact && !isStorageCollapsed && storage" class="storage_caption">
        {{ formatStorageBytes(storage.usedBytes) }} / {{ formatStorageBytes(storage.totalBytes) }}
      </div>
      <div v-else-if="!props.compact && !isStorageCollapsed" class="storage_caption">
        {{ t.storageUsage }}
      </div>
      <div v-if="props.compact" class="storage_compact_indicator" :title="t.storageUsage">
        <strong class="storage_compact_percentage">{{ storageUsagePercentage }}%</strong>
        <span class="storage_compact_bar">
          <span :style="{ width: `${storageUsagePercentage}%` }"></span>
        </span>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">

.storage {
  position: sticky;
  bottom: 0;
  flex: 0 0 auto;
  padding-bottom: 12px;

  &_card {
    margin: 0 8px;
    padding: 18px;
    border: 1px solid var(--border);
    border-radius: 13px;
    background: var(--surface-soft);
    font-size: 13px;

    &.collapsed {
      padding-bottom: 14px;
    }

    &.compact {
      display: grid;
      min-height: 36px;
      margin: 0;
      padding: 8px 0;
      place-items: center;
      border: 0;
      background: transparent;
    }
  }

  &_heading {
    @extend %fx_between;
    color: var(--text);
    font-weight: 650;
  }

  &_toggle {
    width: 26px;
    height: 26px;
    font-size: 17px;
  }

  &_toggle_icon {
    transition: transform 0.2s ease;

    &.collapsed {
      transform: rotate(180deg);
    }
  }

  &_caption {
    margin-top: 4px;
    color: var(--muted);
  }

  .progress_row {
    @extend %fx_row_center;
    gap: 8px;

    & > strong {
      min-width: 31px;
      color: var(--muted);
      font-size: 12px;
      text-align: right;
    }
  }

  .progress {
    min-width: 0;
    flex: 1;
    height: 6px;
    margin: 13px 0 8px;
    overflow: hidden;
    border-radius: 99px;
    background: var(--border);

    & span {
      display: block;
      width: 100%;
      height: 100%;
      border-radius: inherit;
      background: var(--accent);
    }
  }

  &_compact_percentage {
    color: var(--muted);
    font-size: 11px;
    font-weight: 700;
  }

  &_compact_indicator {
    display: grid;
    width: 48px;
    gap: 4px;
    padding: 5px 4px 4px;
    border: 1px solid var(--border);
    border-radius: 7px 7px 2px 2px;
    background: var(--surface-soft);
    text-align: center;
  }

  &_compact_bar {
    display: block;
    width: 100%;
    height: 3px;
    overflow: hidden;
    border-radius: 99px;
    background: var(--border);

    & > span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--accent);
    }
  }
}

</style>
