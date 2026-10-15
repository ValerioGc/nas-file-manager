import { beforeEach, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import FileBrowser from '@/components/desktop/explorer/FileBrowser.vue';
import ExplorerView from '@/components/desktop/explorer/ExplorerView.vue';
import FilePreview from '@/components/common/FilePreview.vue';
import BaseModal from '@/components/common/BaseModal.vue';
import ContextMenu from '@/components/common/ContextMenu.vue';
import { desktopExplorerContextKey } from '@/composables/useDesktopExplorerContext';
import { useFavorites } from '@/composables/useFavorites';
import { clearDraggedFiles } from '@/composables/useFileDragAndDrop';
import { notifyNasShell, requestFolderShortcut } from '@/services/nasShell';
import { nasContextActive } from '@/composables/useNasLauncherContext';
import { file, folder, archive } from '../../helpers/fixtures';
import { desktopContext, dataTransfer } from '../../helpers/desktopContext';
vi.mock('@/services/nasShell', async (original) => ({
  ...(await original<typeof import('@/services/nasShell')>()),
  notifyNasShell: vi.fn(() => false),
  requestFolderShortcut: vi.fn(async () => ({ success: true })),
}));
beforeEach(() => {
  useFavorites().favorites.value = [];
  clearDraggedFiles();
});
function browser() {
  const state = desktopContext();
  const wrapper = mount(FileBrowser, {
    props: { selectedFiles: [] },
    global: {
      provide: { [desktopExplorerContextKey as symbol]: state.context },
      stubs: { FileThumbnail: true, ContextMenu: true },
    },
  });
  return { ...state, wrapper };
}
it('selects, toggles and extends ranges in list and grid views', async () => {
  const { wrapper, context } = browser();
  const rows = wrapper.findAll('.file_row');
  await rows[0].trigger('click');
  expect(wrapper.emitted('select-files')?.at(-1)).toEqual([[file]]);
  await wrapper.setProps({ selectedFiles: [file] });
  await rows[1].trigger('click', { ctrlKey: true });
  expect(wrapper.emitted('select-files')?.at(-1)).toEqual([[file, folder]]);
  await rows[0].trigger('click', { metaKey: true });
  expect(wrapper.emitted('select-files')?.at(-1)).toEqual([[]]);
  await rows[2].trigger('click', { shiftKey: true });
  expect(wrapper.emitted('select-files')?.at(-1)).toEqual([[file, folder, archive]]);
  await rows[1].trigger('click', { shiftKey: true, ctrlKey: true });
  expect(wrapper.emitted('select-files')?.at(-1)).toEqual([[file, folder, archive]]);
  await rows[0].trigger('dblclick');
  expect(context.navigate).not.toHaveBeenCalled();
  await rows[1].trigger('dblclick');
  expect(context.navigate).toHaveBeenCalledWith(folder.path, folder.name);
  await rows[2].trigger('dblclick');
  expect(context.openArchive).toHaveBeenCalledWith(archive);
  await rows[0].get('.favorite_badge').trigger('click');
  expect(useFavorites().isFavorite(file.path)).toBe(true);
  context.viewMode.value = 'grid';
  await flushPromises();
  const card = wrapper.get('.file_card');
  await card.trigger('click');
  await card.trigger('dblclick');
  await card.get('.favorite_badge').trigger('click');
  await card.get('.row_menu').trigger('click');
  expect(wrapper.getComponent(ContextMenu).props('file')).toEqual(file);
});

it('handles valid and invalid drag-and-drop in both file layouts', async () => {
  const { wrapper, context } = browser();
  for (const view of ['list', 'grid'] as const) {
    context.viewMode.value = view;
    await flushPromises();
    const rows = wrapper.findAll(view === 'list' ? '.file_row' : '.file_card');
    const transfer = dataTransfer();
    await wrapper.setProps({ selectedFiles: [file] });
    await rows[0].trigger('dragstart', { dataTransfer: transfer });
    await rows[0].trigger('dragover', { dataTransfer: transfer });
    expect(transfer.dropEffect).toBe('none');
    // Move into a sibling folder rather than the source parent.
    await rows[2].trigger('drop', { dataTransfer: transfer });
    expect(context.moveFilesToDestination).not.toHaveBeenCalled();
    await rows[0].trigger('dragend');
  }
  const { wrapper: target, context: targetContext, entries } = browser();
  entries.value = [file, { ...folder, path: '/target' }];
  await flushPromises();
  const rows = target.findAll('.file_row');
  const transfer = dataTransfer();
  await rows[0].trigger('dragstart', { dataTransfer: transfer });
  await rows[1].trigger('dragover', { dataTransfer: transfer });
  expect(rows[1].classes()).toContain('drop_target');
  await rows[1].trigger('dragleave', { relatedTarget: rows[1].get('strong').element });
  expect(rows[1].classes()).toContain('drop_target');
  await rows[1].trigger('dragleave');
  expect(rows[1].classes()).not.toContain('drop_target');
  await rows[1].trigger('drop', { dataTransfer: transfer });
  expect(targetContext.moveFilesToDestination).toHaveBeenCalledWith([file], '/target');
});

it('dispatches context actions including clipboard, favorites and shortcuts', async () => {
  const { wrapper, context } = browser();
  for (const action of [
    'copy-to-clipboard',
    'cut-to-clipboard',
    'paste',
    'favorite',
    'move',
    'delete',
  ] as const) {
    await wrapper.get('.file_row').trigger('contextmenu', { clientX: 9999, clientY: -2 });
    wrapper.getComponent(ContextMenu).vm.$emit('action', action);
    await flushPromises();
  }
  expect(context.copyToClipboard).toHaveBeenCalledWith([file]);
  expect(context.cutToClipboard).toHaveBeenCalledWith([file]);
  expect(context.pasteClipboard).toHaveBeenCalled();
  expect(context.requestMove).toHaveBeenCalledWith([file]);
  expect(context.fileActions).toHaveBeenCalledWith('delete', [file]);
  expect(useFavorites().isFavorite(file.path)).toBe(true);
  for (const success of [true, false]) {
    vi.mocked(requestFolderShortcut).mockResolvedValueOnce({ success });
    await wrapper.findAll('.file_row')[1].trigger('contextmenu');
    wrapper.getComponent(ContextMenu).vm.$emit('action', 'shortcut');
    await flushPromises();
    expect(wrapper.get('output').text()).toBeTruthy();
  }
  expect(notifyNasShell).toHaveBeenCalled();
  await wrapper.setProps({ selectedFiles: [file, folder] });
  await wrapper.get('.row_menu').trigger('click');
  expect(wrapper.getComponent(ContextMenu).props('files')).toEqual([file, folder]);
  wrapper.getComponent(ContextMenu).vm.$emit('close');
  await flushPromises();
  expect(wrapper.findComponent(ContextMenu).exists()).toBe(false);
  await wrapper.get('.file_browser').trigger('contextmenu');
  wrapper.getComponent(ContextMenu).vm.$emit('action', 'delete');
  await flushPromises();
  expect(context.fileActions).toHaveBeenCalledTimes(1);
});

it('renders loading, empty and grouped NAS volumes', async () => {
  const { wrapper, entries, loading, root, context } = browser();
  loading.value = true;
  await flushPromises();
  expect(wrapper.findComponent({ name: 'LoadingSkeleton' }).exists()).toBe(true);
  loading.value = false;
  entries.value = [];
  root.value = true;
  nasContextActive.value = true;
  await flushPromises();
  expect(wrapper.get('[data-testid="file_browser_empty"]').text()).toContain(
    'No data volume available',
  );
  // Each list says what it lacks: a folder, the favorites, the shares, a search.
  nasContextActive.value = false;
  root.value = false;
  await flushPromises();
  const empty = () => wrapper.get('[data-testid="file_browser_empty"]').text();
  expect(empty()).toContain('Empty folder');
  context.activeNavigation.value = 'favorites';
  await flushPromises();
  expect(empty()).toContain('No favorites');
  context.activeNavigation.value = 'shared';
  await flushPromises();
  expect(empty()).toContain('No shared folder');
  context.search.value = 'nothing';
  await flushPromises();
  expect(empty()).toContain('No results');
  context.search.value = '';
  context.activeNavigation.value = 'all-files';
  root.value = true;
  entries.value = [
    { ...folder, path: '/device' },
    { ...folder, path: '/usb' },
    { ...folder, path: '/share' },
  ];
  context.volumes.value = [
    { id: 'usb', name: 'USB', kind: 'external' },
    { id: 'share', name: 'Share', kind: 'network' },
  ];
  await flushPromises();
  expect(wrapper.findAll('.drive_group')).toHaveLength(3);
  const drive = wrapper.get('.computer_drive_card');
  await drive.get('.drive_open').trigger('click');
  await drive.trigger('contextmenu');
  const transfer = dataTransfer();
  await drive.trigger('dragstart', { dataTransfer: transfer });
  await drive.trigger('dragover', { dataTransfer: transfer });
  await drive.trigger('dragleave');
  await drive.trigger('drop', { dataTransfer: transfer });
  await drive.trigger('dragend');
  expect(context.navigate).toHaveBeenCalledWith('/device', 'docs');
  const icons = wrapper.findAll('.computer_drive_icon img').map((icon) => icon.attributes('src'));
  expect(new Set(icons).size).toBe(3);
  expect(wrapper.findAll('.computer_drive_card > button[title="Open drive"]')).toHaveLength(3);
  expect(wrapper.getComponent(ContextMenu).props('drive')).toBe(true);
  context.viewMode.value = 'grid';
  await flushPromises();
  expect(wrapper.findAll('.computer_drive_card > button[title="Open drive"]')).toHaveLength(0);
});

it('opens details, applies selection actions and uses a modal on narrow screens', async () => {
  const state = desktopContext();
  const wrapper = mount(ExplorerView, {
    global: {
      provide: { [desktopExplorerContextKey as symbol]: state.context },
      stubs: { FileBrowser: true, ActionMenu: true, FilePreview: true },
    },
  });
  await wrapper.get('.details_expand').trigger('click');
  wrapper.getComponent(FilePreview).vm.$emit('action', 'delete');
  await flushPromises();
  expect(state.context.fileActions).not.toHaveBeenCalled();
  wrapper.getComponent(FileBrowser).vm.$emit('select-files', [file]);
  await flushPromises();
  wrapper.getComponent(FilePreview).vm.$emit('action', 'favorite');
  await flushPromises();
  expect(useFavorites().isFavorite(file.path)).toBe(true);
  wrapper.getComponent(FilePreview).vm.$emit('action', 'delete');
  await flushPromises();
  expect(state.context.fileActions).toHaveBeenCalledWith('delete', [file]);
  wrapper.getComponent(FilePreview).vm.$emit('collapse');
  await flushPromises();
  expect(wrapper.find('.details_expand').exists()).toBe(true);
  state.context.isNarrowDesktop.value = true;
  wrapper.getComponent(FileBrowser).vm.$emit('select-files', [file]);
  await flushPromises();
  expect(wrapper.getComponent(BaseModal).props('open')).toBe(true);
  // On a narrow screen the details carry the actions too: there is no other panel to act from.
  expect(wrapper.getComponent(FilePreview).props('showActions')).toBe(true);
  wrapper.getComponent(FilePreview).vm.$emit('action', 'rename');
  await flushPromises();
  expect(state.context.fileActions).toHaveBeenLastCalledWith('rename', [file]);
  wrapper.getComponent(FileBrowser).vm.$emit('select-files', [file]);
  await flushPromises();
  wrapper.getComponent(FilePreview).vm.$emit('close');
  await flushPromises();
  expect(wrapper.getComponent(BaseModal).props('open')).toBe(false);
  wrapper.getComponent(BaseModal).vm.$emit('close');
});

it.each(['report.txt', 'missing.txt'])('resolves a requested selection: %s', async (name) => {
  window.history.replaceState({}, '', `/?select=${name}`);
  const state = desktopContext();
  state.loading.value = true;
  const wrapper = mount(ExplorerView, {
    global: {
      provide: { [desktopExplorerContextKey as symbol]: state.context },
      stubs: { FileBrowser: true, ActionMenu: true, FilePreview: true },
    },
  });
  state.entries.value = [file];
  await flushPromises();
  state.loading.value = false;
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(name === 'missing.txt');
  expect(wrapper.getComponent(FileBrowser).props('selectedFiles')).toEqual(
    name === file.name ? [file] : [],
  );
});

it('opens folders and archives with a tap, selects files, and drags nothing on a touch screen', async () => {
  vi.mocked(window.matchMedia).mockImplementationOnce((media: string) => ({
    media,
    matches: media === '(pointer: coarse)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  }));
  const { wrapper, context } = browser();
  await flushPromises();
  const row = (name: string) =>
    wrapper.findAll('.file_row').find((item) => item.text().includes(name))!;

  await row(folder.name).trigger('click');
  expect(context.navigate).toHaveBeenCalledWith(folder.path, folder.name);
  await row(archive.name).trigger('click');
  expect(context.openArchive).toHaveBeenCalledWith(archive);
  await row(file.name).trigger('click');
  expect(wrapper.emitted('select-files')?.at(-1)).toEqual([[file]]);
  expect(row(file.name).attributes('draggable')).toBe('false');
});

it('hides the details panel where the settings say so, and then opens a folder on a click', async () => {
  const { usePreferences } = await import('@/composables/usePreferences');
  const { preferences } = usePreferences();
  const saved = { ...preferences.value };
  const state = desktopContext();
  const view = mount(ExplorerView, {
    global: {
      provide: { [desktopExplorerContextKey as symbol]: state.context },
      stubs: { FileBrowser: true, ActionMenu: true, FilePreview: true },
    },
  });
  expect(view.find('.details_panel').exists()).toBe(true);
  state.root.value = true;
  await flushPromises();
  expect(view.find('.details_panel').exists()).toBe(false);
  expect(view.getComponent(BaseModal).props('open')).toBe(false);
  state.root.value = false;

  // Off in the list view only: the grid keeps it.
  preferences.value = { ...preferences.value, detailsInList: false };
  await flushPromises();
  expect(view.find('.details_panel').exists()).toBe(false);
  state.context.viewMode.value = 'grid';
  await flushPromises();
  expect(view.find('.details_panel').exists()).toBe(true);
  preferences.value = { ...preferences.value, detailsPanel: false };
  await flushPromises();
  expect(view.find('.details_panel').exists()).toBe(false);
  state.context.isNarrowDesktop.value = true;
  view.getComponent(FileBrowser).vm.$emit('select-files', [file]);
  await flushPromises();
  expect(view.getComponent(BaseModal).props('open')).toBe(false);
  view.unmount();

  const { wrapper, context } = browser();
  context.viewMode.value = 'list';
  await flushPromises();
  const rows = wrapper.findAll('.file_row');
  // A file is still only selected; a folder opens at once, unless a key extends the selection.
  await rows[0].trigger('click');
  expect(context.navigate).not.toHaveBeenCalled();
  await rows[1].trigger('click', { ctrlKey: true });
  expect(context.navigate).not.toHaveBeenCalled();
  await rows[1].trigger('click');
  expect(context.navigate).toHaveBeenCalledWith(folder.path, folder.name);
  preferences.value = saved;
});
