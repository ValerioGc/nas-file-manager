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

</style>
