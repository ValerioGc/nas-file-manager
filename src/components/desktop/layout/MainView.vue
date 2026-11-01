<script setup lang="ts">

import DesktopHeader from '@/components/desktop/header/DesktopHeader.vue';
import ExplorerView from '@/components/desktop/explorer/ExplorerView.vue';
import TrashView from '@/components/desktop/trash/TrashView.vue';
import { useDesktopExplorerContext } from '@/composables/useDesktopExplorerContext';

const { activeNavigation, refreshFolders } = useDesktopExplorerContext();

</script>

<template>
  <section class="workspace">
    <DesktopHeader />
    <TrashView v-if="activeNavigation === 'trash'" @restored="refreshFolders" />
    <ExplorerView v-else />
  </section>
</template>

<style scoped lang="scss">

.workspace {
  @extend %fx_column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  padding: 38px 34px 34px;

  @media (max-width: 900px) {
    padding: 38px 24px 24px;
  }

  @media (max-width: 720px) {
    padding: 38px 16px 24px;
  }
}

</style>
