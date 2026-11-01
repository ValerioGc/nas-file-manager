<script setup lang="ts">

withDefaults(
  defineProps<{
    as?: 'div' | 'label' | 'button';
    title?: string;
    description?: string;
  }>(),
  {
    as: 'div',
    title: '',
    description: '',
  },
);

</script>

<template>
  <component :is="as" class="settings_row">
    <span class="settings_row_copy">
      <strong
        ><slot name="title">{{ title }}</slot></strong
      >
      <small v-if="description">{{ description }}</small>
    </span>
    <slot></slot>
  </component>
</template>

<style scoped lang="scss">

.settings_row {
  @extend %fx_between;
  position: relative;
  gap: 16px;
  min-width: 0;
  padding: 11px 0;
  border-bottom: 1px solid var(--border);

  &_copy {
    display: grid;
    min-width: 0;
    gap: 4px;

    strong {
      font-size: 12px;
    }

    small {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
    }
  }
}

// The row title labels the switch. Its own label is kept for screen readers.
.settings_row :deep(.app_switch_label) {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

</style>
