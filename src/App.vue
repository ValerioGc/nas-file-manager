<script setup lang="ts">

import { computed } from 'vue';
import WebApp from '@/apps/web/WebApp.vue';
import FilePickerView from '@/apps/web/FilePickerView.vue';
import { useNasLauncherContext } from '@/composables/useNasLauncherContext';

useNasLauncherContext();

const appShell = computed(() =>
  window.parent !== window && new URL(window.location.href).searchParams.has('nasPicker')
    ? FilePickerView
    : WebApp,
);

</script>

<template>
  <component :is="appShell" />
</template>
