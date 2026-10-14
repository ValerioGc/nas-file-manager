<script setup lang="ts">

import type { TransferState } from '@/composables/useFileOperations';

defineProps<{ transfer: TransferState | null }>();

</script>

<template>
  <aside v-if="transfer" class="transfer_progress">
    <output class="transfer_progress_heading">
      <span>{{ transfer.label }}</span>
      <strong>{{ transfer.progress }}%</strong>
    </output>

    <progress
      class="transfer_progress_track"
      :aria-label="transfer.label"
      max="100"
      :value="transfer.progress"
    ></progress>
  </aside>
</template>

<style scoped lang="scss">

.transfer_progress {
  position: fixed;
  z-index: 40;
  right: 24px;
  bottom: 24px;
  width: min(360px, calc(100vw - 32px));
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 14px;
  color: var(--text);
  background: var(--surface);
  box-shadow: var(--shadow);

  &_heading {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 10px;
    font-size: 13px;
  }

  &_track {
    display: block;
    width: 100%;
    height: 8px;
    overflow: hidden;
    border: 0;
    border-radius: 999px;
    background: var(--surface-soft);
    appearance: none;

    &::-webkit-progress-bar {
      background: var(--surface-soft);
    }

    &::-webkit-progress-value {
      border-radius: inherit;
      background: var(--accent);
      transition: width 0.18s ease;
    }

    &::-moz-progress-bar {
      border-radius: inherit;
      background: var(--accent);
    }
  }
}

</style>
