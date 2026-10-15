<script setup lang="ts">

import { computed, onMounted, onBeforeUnmount, toRefs } from 'vue';
import { refreshTrashUsage, useTrash } from '@/composables/useTrash';
import deleteIcon from '@/assets/icons/delete.svg?url';
import gridIcon from '@/assets/icons/grid.svg?url';
import shareIcon from '@/assets/icons/share.svg?url';
import starIcon from '@/assets/icons/star.svg?url';
import FolderTree from '@/components/FolderTree.vue';
import { useDesktopExplorerContext } from '@/composables/useDesktopExplorerContext';
import { usePreferences } from '@/composables/usePreferences';
import type { DesktopNavigation } from '@/composables/useDesktopExplorerContext';
import { useI18n } from '@/i18n';
import type { FileEntry } from '@/types/files';
import type { FolderNode } from '@/types/folders';
import StorageUsage from './StorageUsage.vue';

const props = defineProps<{
  folderNodes: FolderNode[];
  isCollapsed: boolean;
  isOpen: boolean;
  selectedFolderPath: string;
  activeNavigation: DesktopNavigation;
}>();

const { folderNodes, isCollapsed, isOpen, selectedFolderPath, activeNavigation } = toRefs(props);

const emit = defineEmits<{
  close: [];
  'select-folder': [folder: FolderNode];
  'select-navigation': [navigation: DesktopNavigation];
  toggle: [];
}>();

const { t } = useI18n();
const { preferences } = usePreferences();
const { items: trashItems } = useTrash();
let usageTimer: ReturnType<typeof setInterval>;
onMounted(() => {
  void refreshTrashUsage();
  usageTimer = setInterval(() => void refreshTrashUsage(), 60_000);
  window.addEventListener('focus', refreshTrashUsage);
});
onBeforeUnmount(() => {
  clearInterval(usageTimer);
  window.removeEventListener('focus', refreshTrashUsage);
});
const { moveFilesToDestination } = useDesktopExplorerContext();

const sidebarControlLabel = computed(() => {
  if (isOpen.value) {
    return t.value.close;
  }
  if (isCollapsed.value) {
    return t.value.expandSidebar;
  }
  return t.value.collapseSidebar;
});

function handleSidebarControl() {
  if (isOpen.value) {
    emit('close');
    return;
  }
  emit('toggle');
}

type NavigationItem = {
  id: DesktopNavigation;
  label: string;
  icon: string;
  active: boolean;
};

const navigationItems = computed<NavigationItem[]>(() =>
  (
    [
      {
        id: 'all-files',
        label: t.value.allFiles,
        icon: gridIcon,
        active: activeNavigation.value === 'all-files',
      },
      {
        id: 'favorites',
        label: t.value.favorites,
        icon: starIcon,
        active: activeNavigation.value === 'favorites',
      },
      {
        id: 'shared',
        label: t.value.shared,
        icon: shareIcon,
        active: activeNavigation.value === 'shared',
      },
      {
        id: 'trash',
        label: t.value.trash,
        icon: deleteIcon,
        active: activeNavigation.value === 'trash',
      },
    ] satisfies NavigationItem[]
  ).filter((item) => item.id !== 'trash' || trashItems.value > 0),
);

function handleNavigationClick(item: NavigationItem) {
  emit('select-navigation', item.id);
}

function handleFolderDrop(files: FileEntry[], destination: FolderNode) {
  void moveFilesToDestination(files, destination.path);
}

</script>

<template>
  <aside
    class="sidebar"
    :class="{
      collapsed: isCollapsed,
      open: isOpen,
      colored_navigation: preferences.coloredNavigation,
    }"
  >
    <button
      class="icon_button sidebar_toggle"
      :aria-label="sidebarControlLabel"
      :title="sidebarControlLabel"
      type="button"
      @click="handleSidebarControl"
    >
      <svg
        class="sidebar_toggle_icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="16" rx="2"></rect>
        <path d="M9 4v16"></path>
        <path v-if="isOpen || !isCollapsed" d="M19 12h-5M17 9l-3 3 3 3"></path>
        <path v-else d="M14 12h5M16 9l3 3-3 3"></path>
      </svg>
    </button>

    <div class="sidebar_scroll_area">
      <nav class="navigation" :aria-label="t.menu">
        <button
          v-for="item in navigationItems"
          :key="item.id"
          class="nav_item"
          :class="{ active: item.active }"
          type="button"
          :data-testid="`nav_${item.id}`"
          @click="handleNavigationClick(item)"
        >
          <img class="icon_asset nav_icon" :src="item.icon" alt="" aria-hidden="true" />
          <span class="sidebar_label">{{ item.label }}</span>
        </button>
      </nav>

      <section class="folder_tree_section" :aria-label="t.folders">
        <div class="sidebar_section_heading">
          <span class="sidebar_label">{{ t.folders }}</span>
          <span class="sidebar_section_line"></span>
        </div>

        <FolderTree
          :nodes="folderNodes"
          :selected-path="selectedFolderPath"
          :enable-drop="true"
          @select="emit('select-folder', $event)"
          @drop-files="handleFolderDrop"
        />
      </section>
    </div>

    <StorageUsage v-if="preferences.showFreeSpace" :compact="isCollapsed" />
  </aside>
</template>

<style scoped lang="scss">

@use '@/styles/partials/tokens' as *;

.sidebar {
  @extend %fx_column;
  position: relative;
  z-index: 11;
  width: clamp($desktop-sidebar-min, 20vw, $desktop-sidebar-max);
  min-width: $desktop-sidebar-min;
  max-width: $desktop-sidebar-max;
  flex: 0 0 clamp($desktop-sidebar-min, 20vw, $desktop-sidebar-max);
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid var(--border);
  background: var(--surface);
  transition:
    width 0.2s ease,
    flex-basis 0.2s ease,
    transform 0.2s ease;

  &.colored_navigation {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }

  &:not(.collapsed) .nav_item:first-child,
  &.open .nav_item:first-child {
    padding-right: $sidebar_toggle_space;
  }

  &.collapsed {
    width: $desktop-sidebar-collapsed;
    flex-basis: $desktop-sidebar-collapsed;

    .sidebar_scroll_area,
    .storage {
      padding-right: 8px;
      padding-left: 8px;
    }

    .sidebar_scroll_area {
      padding-top: $sidebar_collapsed_top_padding;
    }

    .sidebar_label,
    .folder_tree_section {
      display: none;
    }

    .nav_item {
      justify-content: center;
      padding-right: 8px;
      padding-left: 8px;
    }

    .sidebar_toggle {
      right: auto;
      left: 50%;
      width: 26px;
      transform: translateX(-50%);
    }

    .navigation {
      width: 100%;
    }
  }

  // On a phone it slides in over the files, above the overlay (z-index 20) that darkens them.
  @media (max-width: $mobile-breakpoint) {
    position: fixed;
    z-index: 25;
    inset: 0 auto 0 0;
    width: min(300px, 84vw);
    min-width: 0;
    max-width: none;
    flex-basis: auto;
    transform: translateX(-100%);
    box-shadow: var(--shadow);

    &.open {
      transform: translateX(0);
    }

    &.collapsed {
      width: 248px;
      flex-basis: 248px;

      .sidebar_scroll_area {
        padding: $sidebar_content_padding 0.65rem $sidebar_content_padding;
      }

      .storage {
        padding: 12px 18px 24px;
      }

      .sidebar_label,
      .folder_tree_section {
        display: block;
      }

      .sidebar_toggle {
        right: 0.65rem;
        left: auto;
        width: 34px;
        transform: none;
      }

      .nav_item {
        justify-content: initial;
        padding-right: initial;
        padding-left: initial;
      }
    }
  }

  &_scroll_area {
    min-height: 0;
    flex: 1;
    overflow-x: hidden;
    overflow-y: auto;
    padding: $sidebar_content_padding 0.65rem $sidebar_content_padding;
    scrollbar-width: thin;
  }
}

.sidebar_toggle {
  position: absolute;
  z-index: 1;
  top: 8px;
  right: 0.65rem;
  color: var(--muted);

  &:hover,
  &:focus-visible {
    color: var(--accent);
    background: var(--accent-soft);
  }
}

.sidebar_toggle_icon {
  display: block;
  width: 20px;
  height: 20px;
  color: currentColor;
}

.navigation {
  display: grid;
  gap: 2px;

  .nav_item {
    @extend %fx_row_center;
    gap: 13px;
    width: 100%;
    padding: 10px 14px;
    border-radius: 10px;
    color: var(--muted);
    background: transparent;
    text-align: left;
  }

  .nav_item.active {
    color: var(--accent);
    background: var(--navigation-selected, var(--accent-soft));
    box-shadow: var(--navigation-marker, none);
    font-weight: 650;
  }

  .nav_item:hover {
    background: var(--navigation-hover, var(--surface-soft));
  }

  .nav_item:focus-visible {
    outline: var(--navigation-focus, none);
    outline-offset: -2px;
  }

  .nav_icon {
    width: 18px;
    font-size: 18px;
    text-align: center;
  }
}

.folder_tree_section {
  min-height: 0;
  margin-top: 1rem;

  .sidebar_section_heading {
    @extend %fx_row_center;
    gap: 10px;
    margin: 0 12px 9px;
    color: var(--muted);
    font-size: 10px;
    font-weight: 750;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .sidebar_section_line {
    height: 1px;
    flex: 1;
    background: var(--border);
  }
}

</style>
