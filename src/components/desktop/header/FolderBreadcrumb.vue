<script lang="ts" setup>

import backIcon from '@/assets/icons/back.svg?url';
import chevronRightIcon from '@/assets/icons/chevron-right.svg?url';
import folderUpIcon from '@/assets/icons/folder-up.svg?url';
import homeIcon from '@/assets/icons/home.svg?url';
import { useDesktopExplorerContext } from '@/composables/useDesktopExplorerContext';
import { useI18n } from '@/i18n';

const { t } = useI18n();
const { breadcrumbs, canGoBack, canGoUp, goBack, goHome, goUp, isComputerRoot, navigate } =
  useDesktopExplorerContext();

</script>

<template>
  <div class="location_bar">
    <div class="location_actions">
      <button
        class="icon_button"
        type="button"
        :aria-label="t.back"
        :title="t.back"
        :disabled="!canGoBack"
        data-testid="location_back"
        @click="goBack"
      >
        <img class="icon_asset" :src="backIcon" alt="" aria-hidden="true" />
      </button>
      <button
        class="icon_button"
        type="button"
        :aria-label="t.parentFolder"
        :title="t.parentFolder"
        :disabled="!canGoUp"
        data-testid="location_up"
        @click="goUp"
      >
        <img class="icon_asset" :src="folderUpIcon" alt="" aria-hidden="true" />
      </button>
      <button
        class="icon_button"
        type="button"
        :aria-label="t.home"
        :title="t.home"
        :disabled="isComputerRoot"
        data-testid="location_home"
        @click="goHome"
      >
        <img class="icon_asset" :src="homeIcon" alt="" aria-hidden="true" />
      </button>
    </div>

    <nav class="breadcrumbs" :aria-label="t.breadcrumbs">
      <template v-for="(breadcrumb, index) in breadcrumbs" :key="breadcrumb.path">
        <img
          v-if="index > 0"
          class="breadcrumb_separator"
          :src="chevronRightIcon"
          alt=""
          aria-hidden="true"
        />
        <button
          class="breadcrumb"
          :class="{ current: index === breadcrumbs.length - 1 }"
          type="button"
          :title="breadcrumb.label"
          :aria-current="index === breadcrumbs.length - 1 ? 'location' : undefined"
          @click="navigate(breadcrumb.path)"
        >
          {{ breadcrumb.label }}
        </button>
      </template>
    </nav>
  </div>
</template>

<style scoped lang="scss">

// The way back and up, then the path as a trail, in one bar.
.location_bar {
  @extend %fx_row_center;
  min-width: 0;
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-soft);
}

.location_actions {
  @extend %fx_row_center;
  flex: none;
  gap: 2px;
  padding-right: 6px;
  border-right: 1px solid var(--border);

  .icon_button {
    width: 32px;
    height: 32px;
    font-size: 17px;

    &:hover:not(:disabled) {
      background: var(--navigation-hover);
    }

    &:disabled {
      opacity: 0.4;
      cursor: default;
      background: transparent;
    }
  }
}

.breadcrumbs {
  @extend %fx_row_center;
  min-width: 0;
  gap: 2px;
  overflow-x: auto;
  font-size: 13px;
  scrollbar-width: thin;

  .breadcrumb {
    flex: 0 0 auto;
    max-width: 220px;
    padding: 5px 8px;
    overflow: hidden;
    border-radius: 7px;
    color: var(--muted);
    background: transparent;
    text-overflow: ellipsis;
    white-space: nowrap;

    &:hover {
      color: var(--text);
      background: var(--navigation-hover);
    }

    &.current {
      color: var(--accent);
      font-weight: 650;
    }

    &_separator {
      flex: none;
      width: 14px;
      height: 14px;
      opacity: 0.7;
    }
  }
}

</style>
