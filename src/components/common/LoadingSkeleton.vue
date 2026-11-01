<script setup lang="ts">

import { useI18n } from '@/i18n';
const { t } = useI18n();

const rowCount = 5;

</script>

<template>
  <div class="skeleton_list" :aria-label="t.loadingList">
    <div v-for="index in rowCount" :key="index" class="skeleton_row">
      <span class="skeleton_block skeleton_icon"></span>
      <span class="skeleton_copy">
        <i class="skeleton_block skeleton_title"></i>
        <i class="skeleton_block skeleton_text"></i>
      </span>
      <span class="skeleton_block skeleton_meta"></span>
    </div>
  </div>
</template>

<style scoped lang="scss">

.skeleton {
  &_list {
    display: grid;
  }

  &_row {
    display: grid;
    grid-template-columns: 32px minmax(120px, 1fr) 105px;
    align-items: center;
    gap: 10px;
    min-height: 57px;
    padding: 12px 18px;
    border-bottom: 1px solid var(--border);
  }

  &_copy {
    display: grid;
    gap: 7px;
  }

  &_block {
    display: block;
    overflow: hidden;
    border-radius: 7px;
    background: linear-gradient(
      90deg,
      var(--surface-soft) 20%,
      var(--border) 38%,
      var(--surface-soft) 55%
    );
    background-size: 220% 100%;
    animation: skeleton-shimmer 1.2s linear infinite;

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  }

  &_icon {
    width: 28px;
    height: 28px;
  }

  &_title {
    width: min(170px, 82%);
    height: 12px;
  }

  &_text {
    width: min(115px, 60%);
    height: 9px;
  }

  &_meta {
    width: 72px;
    height: 10px;
    justify-self: end;
  }
}

@keyframes skeleton-shimmer {
  to {
    background-position: -220% 0;
  }
}

</style>
