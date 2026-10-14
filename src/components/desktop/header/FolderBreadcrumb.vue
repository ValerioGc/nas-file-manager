<script lang="ts" setup>

import { useDesktopExplorerContext } from '@/composables/useDesktopExplorerContext';
import { useI18n } from '@/i18n';

const { t } = useI18n();
const { breadcrumbs, navigate } = useDesktopExplorerContext();

</script>

<template>
  <nav class="breadcrumbs" :aria-label="t.breadcrumbs">
    <template v-for="(breadcrumb, index) in breadcrumbs" :key="breadcrumb.path">
      <span v-if="index > 0" class="breadcrumb_separator" aria-hidden="true">/</span>
      <button
        class="breadcrumb"
        :class="{ current: index === breadcrumbs.length - 1 }"
        @click="navigate(breadcrumb.path)"
      >
        {{ breadcrumb.label }}
      </button>
    </template>
    <!-- Every crumb is a folder, the last one too: it ends with the separator. -->
    <span v-if="breadcrumbs.length" class="breadcrumb_separator" aria-hidden="true">/</span>
  </nav>
</template>

<style scoped lang="scss">

.breadcrumbs {
  @extend %fx_row_center;
  min-width: 0;
  gap: 8px;
  overflow-x: auto;
  color: var(--muted);
  font-size: 12px;
  scrollbar-width: thin;

  .breadcrumb {
    flex: 0 0 auto;
    padding: 0;
    color: var(--muted);
    background: transparent;

    &:hover,
    &.current {
      color: var(--accent);
    }

    &_separator {
      color: var(--border);
    }
  }
}

</style>
