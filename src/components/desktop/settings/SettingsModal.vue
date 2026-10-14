<script setup lang="ts">

import { computed, ref, watch } from 'vue';
import englishFlag from '@/assets/icons/flag-en.svg?url';
import italianFlag from '@/assets/icons/flag-it.svg?url';
import moonIcon from '@/assets/icons/moon.svg?url';
import closeIcon from '@/assets/icons/close.svg?url';
import sunIcon from '@/assets/icons/sun.svg?url';
import BaseModal from '@/components/common/BaseModal.vue';
import SettingsRow from '@/components/common/SettingsRow.vue';
import SettingsSection from '@/components/common/SettingsSection.vue';
import { NasNumberStepper, NasSwitch } from '@valeriogc/nas-base-app';
import { usePreferences } from '@/composables/usePreferences';
import { nasContextActive } from '@/composables/useNasLauncherContext';
import { useI18n } from '@/i18n';
import {
  emptyPreviewCache,
  previewCacheUsage,
  setPreviewCacheLimit,
  type PreviewCacheUsage,
} from '@/services/filesystem';
import formatSize from '@/utils/fileUtils';
import { useTrash } from '@/composables/useTrash';
import { emptyTrash } from '@/services/trash';

const { preferences, setTheme, themeMode } = usePreferences();
const { locale, t, setLocale } = useI18n();
const languageFlag = computed(() => {
  if (locale.value === 'it') {
    return italianFlag;
  }
  return englishFlag;
});

const emit = defineEmits<{ close: [] }>();
defineProps<{ open: boolean }>();

const MB = 1024 * 1024;
/** The room the previews may take on the NAS: from 100 MB to 2 GB. */
const PREVIEW_LIMITS = [100, 250, 500, 1024, 1536, 2048].map((megabytes) => megabytes * MB);
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

const { settings: trash, loaded: trashLoaded, save: saveTrash } = useTrash();
const trashError = ref('');
const trashBusy = ref(false);
// Emptying asks once more, on the same button.
const confirmingEmpty = ref(false);

async function changeTrash(change: () => Promise<unknown>) {
  trashBusy.value = true;
  trashError.value = '';
  try {
    await change();
  } catch {
    trashError.value = t.value.trashUnavailable;
  } finally {
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

type SettingsTab = 'general' | 'previews' | 'file-list' | 'appearance';
const activeTab = ref<SettingsTab>('general');
const settingsTabs = computed(() => [
  { id: 'general' as const, label: t.value.general },
  { id: 'previews' as const, label: t.value.filePreviewSettings },
  { id: 'file-list' as const, label: t.value.fileList },
  // Inside the launcher theme and language follow it: the tab would be empty.
  ...(nasContextActive.value ? [] : [{ id: 'appearance' as const, label: t.value.appearance }]),
]);
watch(settingsTabs, (tabs) => {
  if (!tabs.some((tab) => tab.id === activeTab.value)) {
    activeTab.value = 'general';
  }
});

function selectTab(tab: SettingsTab) {
  activeTab.value = tab;
  if (tab === 'previews') {
    void updatePreviewCache(previewCacheUsage);
  }
}

function handleTabKeydown(event: KeyboardEvent, tabIndex: number) {
  const tabs = settingsTabs.value;
  let nextIndex: number;
  if (event.key === 'ArrowRight') {
    nextIndex = (tabIndex + 1) % tabs.length;
  } else if (event.key === 'ArrowLeft') {
    nextIndex = (tabIndex - 1 + tabs.length) % tabs.length;
  } else {
    return;
  }
  event.preventDefault();
  selectTab(tabs[nextIndex].id);
  document.getElementById(`settings-tab-${tabs[nextIndex].id}`)?.focus();
}

</script>

<template>
  <BaseModal
    :open="open"
    :aria-label="t.settings"
    content-class="settings_modal"
    @close="emit('close')"
  >
    <template #header>
      <div class="modal_heading">
        <div>
          <p class="eyebrow">{{ t.appName }}</p>
          <h2>{{ t.settings }}</h2>
        </div>
        <button
          class="icon_button modal_close"
          :aria-label="t.close"
          :title="t.close"
          @click="emit('close')"
        >
          <img class="icon_asset" :src="closeIcon" alt="" aria-hidden="true" />
        </button>
      </div>
    </template>

    <div class="settings_content">
      <div class="settings_tabs" role="tablist" :aria-label="t.settings">
        <button
          v-for="(tab, index) in settingsTabs"
          :id="`settings-tab-${tab.id}`"
          :key="tab.id"
          class="settings_tab"
          :class="{ active: activeTab === tab.id }"
          role="tab"
          :aria-selected="activeTab === tab.id"
          :aria-controls="`settings-panel-${tab.id}`"
          type="button"
          @click="selectTab(tab.id)"
          @keydown="handleTabKeydown($event, index)"
        >
          {{ tab.label }}
        </button>
      </div>

      <div
        v-if="activeTab === 'general'"
        id="settings-panel-general"
        class="settings_panel"
        role="tabpanel"
        aria-labelledby="settings-tab-general"
      >
        <SettingsSection :title="t.general">
          <SettingsRow
            class="preference_row"
            :title="t.confirmDelete"
            :description="t.confirmDeleteDescription"
          >
            <NasSwitch
              v-model="preferences.confirmBeforeDelete"
              :label="t.confirmDelete"
              testid="settings_confirm_before_delete"
            />
          </SettingsRow>
          <SettingsRow
            class="preference_row"
            :title="t.showFreeSpace"
            :description="t.freeSpaceDescription"
          >
            <NasSwitch
              v-model="preferences.showFreeSpace"
              :label="t.showFreeSpace"
              testid="settings_show_free_space"
            />
          </SettingsRow>
        </SettingsSection>
        <SettingsSection :title="t.trash">
          <SettingsRow
            class="preference_row"
            :title="t.trashEnabled"
            :description="t.trashEnabledDescription"
          >
            <NasSwitch
              :model-value="trash.enabled"
              :label="t.trashEnabled"
              :disabled="!trashLoaded || trashBusy"
              testid="settings_trash"
              @update:model-value="(enabled) => changeTrash(() => saveTrash({ enabled }))"
            />
          </SettingsRow>
          <SettingsRow class="preference_row" :description="t.trashDaysDescription">
            <template #title>
              <label for="settings-trash-days" class="settings_row_label">{{ t.trashDays }}</label>
            </template>
            <NasNumberStepper
              id="settings-trash-days"
              :model-value="trash.days"
              :min="1"
              :max="3650"
              :disabled="!trashLoaded || trashBusy"
              :increase-label="t.increase"
              :decrease-label="t.decrease"
              testid="settings_trash_days"
              @update:model-value="(days) => changeTrash(() => saveTrash({ days }))"
            />
          </SettingsRow>
          <SettingsRow class="preference_row" :description="trashError">
            <template #title>
              <span class="settings_row_label">{{ t.trashEmpty }}</span>
            </template>
            <button
              class="button secondary"
              type="button"
              :disabled="!trashLoaded || trashBusy"
              data-testid="settings_trash_empty"
              @click="emptyTheTrash"
            >
              {{ confirmingEmpty ? t.trashEmptyConfirm : t.trashEmpty }}
            </button>
          </SettingsRow>
        </SettingsSection>
      </div>

      <div
        v-else-if="activeTab === 'previews'"
        id="settings-panel-previews"
        class="settings_panel"
        role="tabpanel"
        aria-labelledby="settings-tab-previews"
      >
        <SettingsSection :title="t.filePreviewSettings">
          <SettingsRow
            class="preference_row"
            :title="t.generatePreviews"
            :description="t.generatePreviewsDescription"
          >
            <NasSwitch
              v-model="preferences.generatePreviews"
              :label="t.generatePreviews"
              testid="settings_generate_previews"
            />
          </SettingsRow>
          <SettingsRow
            class="preference_row"
            :title="t.animatedPreviews"
            :description="t.animatedPreviewsDescription"
          >
            <NasSwitch
              v-model="preferences.animatedPreviews"
              :label="t.animatedPreviews"
              testid="settings_animated_previews"
            />
          </SettingsRow>
          <SettingsRow class="preference_row" :description="t.previewCacheLimitDescription">
            <template #title>
              <label for="settings-preview-cache" class="settings_row_label">{{
                t.previewCacheLimit
              }}</label>
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
          <SettingsRow class="preference_row" :description="previewCacheError">
            <template #title>
              <span class="settings_row_label" data-testid="settings_preview_cache_used">{{
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
              {{ t.previewCacheEmpty }}
            </button>
          </SettingsRow>
        </SettingsSection>
      </div>

      <div
        v-else-if="activeTab === 'file-list'"
        id="settings-panel-file-list"
        class="settings_panel"
        role="tabpanel"
        aria-labelledby="settings-tab-file-list"
      >
        <SettingsSection :title="t.fileList">
          <SettingsRow
            class="preference_row"
            :title="t.coloredNavigation"
            :description="t.coloredNavigationDescription"
          >
            <NasSwitch
              v-model="preferences.coloredNavigation"
              :label="t.coloredNavigation"
              testid="settings_colored_navigation"
            />
          </SettingsRow>
          <SettingsRow
            class="preference_row"
            :title="t.compactView"
            :description="t.compactViewDescription"
          >
            <NasSwitch
              v-model="preferences.compactList"
              :label="t.compactView"
              testid="settings_compact_list"
            />
          </SettingsRow>
          <SettingsRow
            class="preference_row"
            :title="t.showFileExtensions"
            :description="t.showFileExtensionsDescription"
          >
            <NasSwitch
              v-model="preferences.showFileExtensions"
              :label="t.showFileExtensions"
              testid="settings_show_file_extensions"
            />
          </SettingsRow>
          <SettingsRow
            class="preference_row"
            :title="t.showHiddenFiles"
            :description="t.showHiddenFilesDescription"
          >
            <NasSwitch
              v-model="preferences.showHiddenFiles"
              :label="t.showHiddenFiles"
              testid="settings_show_hidden_files"
            />
          </SettingsRow>
        </SettingsSection>
        <SettingsSection :title="t.details">
          <SettingsRow
            class="preference_row"
            :title="t.detailsPanel"
            :description="t.detailsPanelDescription"
          >
            <NasSwitch
              v-model="preferences.detailsPanel"
              :label="t.detailsPanel"
              testid="settings_details_panel"
            />
          </SettingsRow>
          <SettingsRow class="preference_row" :title="t.detailsInGrid">
            <NasSwitch
              v-model="preferences.detailsInGrid"
              :label="t.detailsInGrid"
              :disabled="!preferences.detailsPanel"
              testid="settings_details_in_grid"
            />
          </SettingsRow>
          <SettingsRow class="preference_row" :title="t.detailsInList">
            <NasSwitch
              v-model="preferences.detailsInList"
              :label="t.detailsInList"
              :disabled="!preferences.detailsPanel"
              testid="settings_details_in_list"
            />
          </SettingsRow>
        </SettingsSection>
      </div>

      <div
        v-else
        id="settings-panel-appearance"
        class="settings_panel"
        role="tabpanel"
        aria-labelledby="settings-tab-appearance"
      >
        <fieldset class="setting_group">
          <legend class="setting_group_title">{{ t.appearance }}</legend>
          <div class="segmented theme_options">
            <button
              class="theme_option"
              :class="{ active: themeMode === 'light' }"
              @click="setTheme('light')"
            >
              <img class="icon_asset theme_icon" :src="sunIcon" alt="" aria-hidden="true" />
              <span>{{ t.light }}</span>
            </button>
            <button
              class="theme_option"
              :class="{ active: themeMode === 'dark' }"
              @click="setTheme('dark')"
            >
              <img class="icon_asset theme_icon" :src="moonIcon" alt="" aria-hidden="true" />
              <span>{{ t.dark }}</span>
            </button>
            <button
              class="theme_option"
              :class="{ active: themeMode === 'auto' }"
              @click="setTheme('auto')"
            >
              <span>{{ t.automatic }}</span>
            </button>
          </div>
        </fieldset>

        <fieldset class="setting_group">
          <legend class="setting_group_title language_label">
            <img class="language_flag" :src="languageFlag" alt="" aria-hidden="true" />
            <span>{{ t.language }}</span>
          </legend>
          <div class="segmented">
            <button
              class="language_option"
              :class="{ active: locale === 'it' }"
              @click="setLocale('it')"
            >
              <img class="language_flag" :src="italianFlag" alt="" aria-hidden="true" />
              <span>{{ t.italian }}</span>
            </button>
            <button
              class="language_option"
              :class="{ active: locale === 'en' }"
              @click="setLocale('en')"
            >
              <img class="language_flag" :src="englishFlag" alt="" aria-hidden="true" />
              <span>{{ t.english }}</span>
            </button>
          </div>
        </fieldset>
      </div>
    </div>
  </BaseModal>
</template>

<style scoped lang="scss">

/*
 * Through the backdrop, the root of BaseModal, which carries this component's scope: a rule that
 * starts with a bare :deep() compiles to an attribute selector alone, and PurgeCSS drops it from
 * the production build, so the dialog lost its width and padding.
 */
.modal_backdrop :deep(.settings_modal) {
  padding: 26px;
}

.modal_heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 30px;
}

.eyebrow {
  margin: 0 0 8px;
  text-transform: uppercase;
  color: var(--muted);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.16em;
}

h2 {
  margin: 0;
  font-size: 20px;
  letter-spacing: -0.03em;
}

.setting_group {
  min-width: 0;
  margin: 0 0 22px;
  padding: 0;
  border: 0;

  &_title {
    display: block;
    padding: 0;
    margin-bottom: 9px;
    color: var(--muted);
    font-size: 12px;
    font-weight: 650;
  }
}

.settings_tabs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: 6px;
  margin-bottom: 26px;
  padding: 5px;
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-soft);
}

.settings_tab {
  min-width: 0;
  min-height: 38px;
  padding: 9px 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--muted);
  background: transparent;
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
  transition:
    color 0.2s ease,
    background-color 0.2s ease,
    border-color 0.2s ease;

  &:hover {
    color: var(--text);
    background: var(--surface-soft);
  }

  &.active {
    color: #fff;
    border-color: var(--accent);
    background: var(--accent);
    box-shadow: 0 3px 10px color-mix(in srgb, var(--accent) 28%, transparent);
  }
}

.segmented {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 4px;
  border-radius: 10px;
  background: var(--surface-soft);

  & button {
    padding: 9px;
    border-radius: 7px;
    color: var(--muted);
    background: transparent;
    font-size: 12px;

    &.active {
      color: var(--text);
      background: var(--surface);
      box-shadow: 0 2px 7px rgba(0, 0, 0, 0.06);
    }
  }
}

.theme_options {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.theme_option,
.language_option {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  line-height: 1.2;
}

.theme_icon {
  display: block;
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
}

.language_label {
  display: flex !important;
  align-items: center;
  gap: 8px;
}

.language_flag {
  display: block;
  width: 18px;
  height: 14px;
  flex: 0 0 18px;
  object-fit: cover;
  border-radius: 2px;
}

.preference_row {
  padding: 11px 0;
  border-bottom: 1px solid var(--border);
}

// The title of the row names the switch: its own label is there for the screen readers.
.preference_row :deep(.app_switch_label) {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

</style>
