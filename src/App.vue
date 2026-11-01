<script setup lang="ts">

import DesktopApp from '@/components/desktop/layout/DesktopApp.vue';
import FilePickerView from '@/components/picker/FilePickerView.vue';
import { useNasLauncherContext } from '@/composables/useNasLauncherContext';

useNasLauncherContext();

const appShell =
  window.parent !== window && new URL(window.location.href).searchParams.has('nasPicker')
    ? FilePickerView
    : DesktopApp;

</script>

<template>
  <component :is="appShell" />
</template>
