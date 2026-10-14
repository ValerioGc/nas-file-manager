<script setup lang="ts">

import { computed, nextTick, onMounted, ref } from 'vue';
import copyIcon from '@/assets/icons/copy.svg?url';
import cutIcon from '@/assets/icons/cut.svg?url';
import deleteIcon from '@/assets/icons/delete.svg?url';
import downloadIcon from '@/assets/icons/download.svg?url';
import moveIcon from '@/assets/icons/move.svg?url';
import pasteIcon from '@/assets/icons/paste.svg?url';
import renameIcon from '@/assets/icons/rename.svg?url';
import shareIcon from '@/assets/icons/share.svg?url';
import starIcon from '@/assets/icons/star.svg?url';
import folderIcon from '@/assets/icons/thumbnail-folder.svg?url';
import { useFavorites } from '@/composables/useFavorites';
import { useShares } from '@/composables/useShares';
import { useI18n } from '@/i18n';
import type { FileEntry } from '@/types/files';

export type ContextAction =
  | 'copy'
  | 'copy-to-clipboard'
  | 'cut-to-clipboard'
  | 'delete'
  | 'download'
  | 'favorite'
  | 'move'
  | 'paste'
  | 'rename'
  | 'share'
  | 'shortcut';
type MenuAction = {
  type: ContextAction;
  label: string;
  icon: string;
  visible: boolean;
};

const props = defineProps<{
  file: FileEntry | null;
  files: FileEntry[];
  x: number;
  y: number;
  canPaste?: boolean;
}>();

const emit = defineEmits<{
  action: [action: ContextAction];
  close: [];
}>();

const { t } = useI18n();
const { isFavorite } = useFavorites();
const { overview, isShared } = useShares();
const firstAction = ref<HTMLButtonElement | null>(null);

const actions = computed<MenuAction[]>(() => {
  const labels = t.value;
  const hasSingleSelection = props.files.length === 1;
  const hasSelection = props.files.length > 0;
  const allFavorites = props.files.length > 0 && props.files.every((file) => isFavorite(file.path));

  return [
    { type: 'rename', label: labels.rename, icon: renameIcon, visible: hasSingleSelection },
    {
      type: 'favorite',
      label: allFavorites ? labels.removeFavorite : labels.addFavorite,
      icon: starIcon,
      visible: hasSelection,
    },
    {
      type: 'shortcut',
      label: labels.addDesktopShortcut,
      icon: folderIcon,
      visible: window.parent !== window && hasSingleSelection && props.file?.kind === 'folder',
    },
    {
      type: 'share',
      label: props.file && isShared(props.file.path) ? labels.shareSettings : labels.shareFolder,
      icon: shareIcon,
      visible: overview.value.available && hasSingleSelection && props.file?.kind === 'folder',
    },
    {
      type: 'copy-to-clipboard',
      label: labels.copy,
      icon: copyIcon,
      visible: hasSelection,
    },
    {
      type: 'cut-to-clipboard',
      label: labels.cut,
      icon: cutIcon,
      visible: hasSelection,
    },
    { type: 'paste', label: labels.paste, icon: pasteIcon, visible: props.canPaste === true },
    { type: 'move', label: labels.move, icon: moveIcon, visible: hasSelection },
    {
      type: 'download',
      label: labels.download,
      icon: downloadIcon,
      visible: hasSingleSelection && props.file?.kind !== 'folder',
    },
    { type: 'delete', label: labels.delete, icon: deleteIcon, visible: hasSelection },
  ];
});

const visibleActions = computed(() => actions.value.filter((action) => action.visible));
const selectionLabel = computed(() => {
  if (props.files.length > 1) {
    return t.value.selectedItems.replace('{count}', String(props.files.length));
  }
  return props.file?.name ?? '';
});

function setFirstAction(element: unknown) {
  if (element instanceof HTMLButtonElement) {
    firstAction.value = element;
  }
}

function manageAction(action: ContextAction) {
  emit('action', action);
  emit('close');
}

onMounted(() => void nextTick(() => firstAction.value?.focus()));

</script>

<template>
  <div class="context_menu_backdrop" @click="emit('close')"></div>

  <section
    class="context_menu"
    role="menu"
    :aria-label="t.fileActions"
    :style="{ left: `${x}px`, top: `${y}px` }"
    @click.stop
    @keydown.esc="emit('close')"
  >
    <strong v-if="selectionLabel" class="context_menu_file">{{ selectionLabel }}</strong>

    <button
      v-for="(action, index) in visibleActions"
      :key="action.type"
      :ref="index === 0 ? setFirstAction : undefined"
      role="menuitem"
      @click="manageAction(action.type)"
    >
      <img class="context_menu_icon" :src="action.icon" alt="" aria-hidden="true" />
      <span>{{ action.label }}</span>
    </button>
  </section>
</template>

<style scoped lang="scss">

.context_menu_backdrop {
  position: fixed;
  z-index: 19;
  inset: 0;
}

.context_menu {
  position: fixed;
  z-index: 20;
  display: grid;
  width: 210px;
  padding: 7px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  box-shadow: var(--shadow);

  button,
  button span {
    color: var(--text);
    -webkit-text-fill-color: var(--text);
  }

  &_icon {
    display: block;
    width: 16px;
    height: 16px;
    flex: 0 0 16px;
    object-fit: contain;
  }

  &_file {
    @extend %text_ellipsis;
    padding: 7px 9px 9px;
    border-bottom: 1px solid var(--border);
    color: var(--text);
    font-size: 11px;
  }

  button {
    @extend %fx_row_center;
    gap: 11px;
    padding: 9px;
    border-radius: 7px;
    color: var(--text);
    background: transparent;
    text-align: left;
    font-size: 12px;

    &:hover {
      background: var(--surface-soft);
    }
  }
}

</style>
