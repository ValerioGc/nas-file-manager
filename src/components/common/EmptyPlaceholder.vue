<script setup lang="ts">

/**
 * What a list shows when it has nothing: a symbol in a circle (a spinner while it reads), a title
 * and a line that says what to do.
 */
defineProps<{
  title: string;
  text?: string;
  icon?: string;
  loading?: boolean;
  testid?: string;
}>();

</script>

<template>
  <div class="empty_placeholder" :role="loading ? 'status' : undefined" :data-testid="testid">
    <span v-if="loading" class="empty_placeholder_spinner" aria-hidden="true"></span>
    <span v-else-if="icon" class="empty_placeholder_icon" aria-hidden="true">
      <img :src="icon" alt="" />
    </span>
    <strong>{{ title }}</strong>
    <p v-if="text">{{ text }}</p>
  </div>
</template>

<style scoped lang="scss">

.empty_placeholder {
  display: grid;
  flex: 1;
  align-content: center;
  justify-items: center;
  gap: 8px;
  min-height: 220px;
  padding: 24px;
  border: 1px dashed var(--border);
  border-radius: 14px;
  text-align: center;

  strong {
    color: var(--text);
    font-size: 16px;
  }

  p {
    max-width: 30rem;
    margin: 0;
    color: var(--muted);
    font-size: 13px;
  }

  &_icon {
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
    margin-bottom: 6px;
    border-radius: 50%;
    background: var(--chosen-bg, var(--nas-hover));

    img {
      width: 32px;
      height: 32px;
    }
  }

  &_spinner {
    width: 32px;
    height: 32px;
    margin-bottom: 6px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: empty_placeholder_spin 0.9s linear infinite;
  }
}

@keyframes empty_placeholder_spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .empty_placeholder_spinner {
    animation-duration: 3s;
  }
}

</style>
