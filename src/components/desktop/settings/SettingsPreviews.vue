<script setup lang="ts">

import { onMounted, ref } from 'vue';
import deleteIcon from '@/assets/icons/delete.svg?url';
import SettingsRow from '@/components/common/SettingsRow.vue';
import SettingsSection from '@/components/common/SettingsSection.vue';
import { NasSwitch } from '@valeriogc/nas-base-app';
import { usePreferences } from '@/composables/usePreferences';
import { useI18n } from '@/i18n';
import { emptyPreviewCache, previewCacheUsage, setPreviewCacheLimit } from '@/services/filesystem';
import type { PreviewCacheUsage } from '@/types/previews';
import formatSize from '@/utils/fileUtils';

const { preferences } = usePreferences();
const { t } = useI18n();

const MB = 1024 * 1024;
const PREVIEW_LIMITS = [10, 25, 50, 100, 250, 500, 1024, 1536, 2048, 4096, 8192, 16384].map(
  (megabytes) => megabytes * MB,
);

const previewCache = ref<PreviewCacheUsage | null>(null);
const previewCacheError = ref('');
const previewCacheBusy = ref(false);

async function updatePreviewCache(change: () => Promise<PreviewCacheUsage>) {
  previewCacheBusy.value = true;
  previewCacheError.value = '';
  try {
    previewCache.value = await change();
  } catch {
    previewCacheError.value = t.value.previewCacheUnavailable;
  } finally {
    previewCacheBusy.value = false;
  }
}

function changePreviewLimit(event: Event) {
  const limitBytes = Number((event.target as HTMLSelectElement).value);
  void updatePreviewCache(() => setPreviewCacheLimit(limitBytes));
}

// Shown when its tab opens, so the space used is read again each time.
onMounted(() => void updatePreviewCache(previewCacheUsage));

</script>

<template>
  <SettingsSection :title="t.filePreviewSettings">
    <SettingsRow :title="t.generatePreviews" :description="t.generatePreviewsDescription">
      <NasSwitch
        v-model="preferences.generatePreviews"
        :label="t.generatePreviews"
        testid="settings_generate_previews"
      />
    </SettingsRow>
    <SettingsRow :title="t.animatedPreviews" :description="t.animatedPreviewsDescription">
      <NasSwitch
        v-model="preferences.animatedPreviews"
        :label="t.animatedPreviews"
        testid="settings_animated_previews"
      />
    </SettingsRow>
    <SettingsRow :description="t.previewCacheLimitDescription">
      <template #title>
        <label for="settings-preview-cache" class="settings_row_label">
          {{ t.previewCacheLimit }}</label
        >
      </template>
      <select
        id="settings-preview-cache"
        class="preview_cache_limit"
        :value="previewCache?.limitBytes"
        :disabled="!previewCache || previewCacheBusy"
        data-testid="settings_preview_cache_limit"
        @change="changePreviewLimit"
      >
        <option v-for="limit in PREVIEW_LIMITS" :key="limit" :value="limit">
          {{ limit >= 1024 * MB ? `${limit / (1024 * MB)} GB` : formatSize(limit) }}
        </option>
      </select>
    </SettingsRow>
    <SettingsRow :description="previewCacheError">
      <template #title>
        <span data-testid="settings_preview_cache_used">{{
          previewCache
            ? t.previewCacheUsed.replace('{size}', formatSize(previewCache.usedBytes))
            : t.previewCacheReading
        }}</span>
      </template>
      <button
        class="button secondary"
        type="button"
        :disabled="!previewCache || previewCacheBusy || previewCache.usedBytes === 0"
        data-testid="settings_preview_cache_empty"
        @click="updatePreviewCache(emptyPreviewCache)"
      >
        <img class="icon_asset" :src="deleteIcon" alt="" aria-hidden="true" />
        {{ t.previewCacheEmpty }}
      </button>
    </SettingsRow>
  </SettingsSection>
</template>

<style scoped lang="scss">

.preview_cache_limit {
  position: relative;
  z-index: 1;
  min-width: 120px;
  min-height: 38px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 9px;
  color: var(--text);
  background: var(--surface-soft);
  font: inherit;
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
}

</style>
