<script setup lang="ts">

withDefaults(
  defineProps<{
    title: string;
  }>(),
  {},
);

</script>

<template>
  <section class="settings_section">
    <h2 class="settings_section_title">{{ title }}</h2>
    <div class="settings_section_list">
      <slot></slot>
    </div>
  </section>
</template>

<style scoped lang="scss">

.settings_section {
  display: grid;
  gap: 8px;

  &_title {
    margin: 26px 0 0;
    color: var(--accent);
    font-size: 11px;
    font-weight: 750;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  &_list {
    display: grid;
    gap: 3px;
  }
}

</style>
