<script setup lang="ts">

import menuIcon from '@/assets/icons/menu.svg?url';
import settingsIcon from '@/assets/icons/settings.svg?url';
import { useDesktopExplorerContext } from '@/composables/useDesktopExplorerContext';
import { useI18n } from '@/i18n';
import FolderBreadcrumb from './FolderBreadcrumb.vue';

const { t } = useI18n();
const { isMobileSidebar, openSettings, openSidebar, selectedFolderName } =
  useDesktopExplorerContext();

</script>

<template>
  <header class="header">
    <div class="header_heading_row">
      <!-- On a phone the side menu is hidden: this brings it in. -->
      <button
        v-if="isMobileSidebar"
        class="icon_button header_menu_button"
        :aria-label="t.folders"
        :title="t.folders"
        type="button"
        @click="openSidebar"
      >
        <img class="icon_asset" :src="menuIcon" alt="" aria-hidden="true" />
      </button>
      <div class="workspace_heading">
        <p class="eyebrow">{{ t.allFiles }}</p>
        <h1>{{ selectedFolderName }}</h1>
      </div>

      <button
        class="icon_button web_settings_button"
        :aria-label="t.settings"
        :title="t.settings"
        type="button"
        @click="openSettings"
      >
        <img class="icon_asset" :src="settingsIcon" alt="" aria-hidden="true" />
      </button>
    </div>

    <FolderBreadcrumb />
  </header>
</template>

<style scoped lang="scss">

@use '@/styles/partials/tokens' as *;

.header_heading_row {
  @extend %fx_row_center;
}

.header {
  display: grid;
  gap: 20px;
  margin-bottom: 22px;

  .header_heading_row {
    @media (max-width: $mobile-breakpoint) {
      align-items: flex-start;
    }
  }
}

.workspace_heading {
  min-width: 0;
  flex: 1;

  .eyebrow {
    margin: 0 0 5px;
    color: var(--muted);
    font-size: 10px;
    font-weight: 750;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
}

.header_menu_button {
  flex: 0 0 auto;
  margin-right: 8px;
  color: var(--muted);

  .icon_asset {
    width: 22px;
    height: 22px;
  }
}

.web_settings_button {
  flex: 0 0 auto;
  width: 42px;
  height: 42px;
  color: var(--muted);

  .icon_asset {
    width: 26px;
    height: 26px;
  }
}

h1 {
  @extend %text_ellipsis;
  margin: 0;
  font-size: clamp(22px, 3vw, 32px);
  letter-spacing: -0.04em;
}

</style>
