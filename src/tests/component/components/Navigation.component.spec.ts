import { expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import FolderTree from '@/components/FolderTree.vue';
import FolderTreeItem from '@/components/FolderTreeItem.vue';
import AsideMenu from '@/components/desktop/navigation/AsideMenu.vue';
import StorageUsage from '@/components/desktop/navigation/StorageUsage.vue';
import MainView from '@/components/desktop/layout/MainView.vue';
import DesktopHeader from '@/components/desktop/header/DesktopHeader.vue';
import ActionMenu from '@/components/desktop/header/ActionMenu.vue';
import { desktopExplorerContextKey } from '@/composables/useDesktopExplorerContext';
import { setDraggedFiles, clearDraggedFiles } from '@/composables/useFileDragAndDrop';
import { getStorageInfo } from '@/services/filesystem';
import { file } from '../../helpers/fixtures';
import { desktopContext, dataTransfer } from '../../helpers/desktopContext';
vi.mock('@/services/filesystem', async (original) => ({
  ...(await original<typeof import('@/services/filesystem')>()),
  getStorageInfo: vi.fn(),
}));

it('expands and selects nested folders, forwards drops and rejects invalid destinations', async () => {
  const node = {
    name: 'NAS',
    path: '/',
    selectable: false,
    children: [
      { name: 'Target', path: '/target', children: [{ name: 'Child', path: '/target/child' }] },
    ],
  };
  const wrapper = mount(FolderTree, {
    props: { nodes: [node], selectedPath: '/', enableDrop: true },
  });
  await wrapper.findAll('.tree_item_button')[0].trigger('click');
  expect(wrapper.emitted('select')).toBeUndefined();
  await wrapper.findAll('.tree_item_button')[1].trigger('click');
  expect(wrapper.emitted('select')?.[0]).toEqual([node.children[0]]);
  await wrapper.findAll('.tree_row_toggle')[1].trigger('click');
  await wrapper.findAll('.tree_row_toggle')[1].trigger('click');
  await wrapper.findAll('.tree_item_button')[2].trigger('click');
  expect(wrapper.emitted('select')).toHaveLength(2);
  const row = wrapper.findAll('.tree_row')[2];
  const transfer = dataTransfer();
  setDraggedFiles({ dataTransfer: transfer } as unknown as DragEvent, [file]);
  await row.trigger('dragover', { dataTransfer: transfer });
  expect(row.classes()).toContain('drop_target');
  expect(transfer.dropEffect).toBe('move');
  await row.trigger('dragleave', { relatedTarget: row.get('button').element });
  expect(row.classes()).toContain('drop_target');
  await row.trigger('dragleave');
  expect(row.classes()).not.toContain('drop_target');
  await row.trigger('drop', { dataTransfer: transfer });
  expect(wrapper.emitted('drop-files')?.[0]).toEqual([[file], node.children[0].children[0]]);
  clearDraggedFiles();
  await row.trigger('dragover', { dataTransfer: dataTransfer() });
  await row.trigger('drop');
  expect(wrapper.emitted('drop-files')).toHaveLength(1);
  await wrapper.setProps({ expandAll: true });
  expect(wrapper.findAll('.tree_item_button')).toHaveLength(3);
  const disabled = mount(FolderTreeItem, {
    props: { node, expandedPaths: new Set<string>(), selectedPath: '/', enableDrop: false },
  });
  await disabled.get('.tree_row').trigger('dragover');
  expect(disabled.get('.tree_row').classes()).not.toContain('drop_target');
});

it('toggles the sidebar and forwards navigation, folder and drop actions', async () => {
  const { context } = desktopContext();
  const wrapper = mount(AsideMenu, {
    props: {
      folderNodes: [],
      isCollapsed: false,
      isOpen: false,
      selectedFolderPath: '/',
      activeNavigation: 'all-files',
    },
    global: {
      provide: { [desktopExplorerContextKey as symbol]: context },
      stubs: { StorageUsage: true, FolderTree: true },
    },
  });
  await wrapper.get('.sidebar_toggle').trigger('click');
  expect(wrapper.emitted('toggle')).toHaveLength(1);
  await wrapper.setProps({ isCollapsed: true });
  expect(wrapper.get('.sidebar_toggle').attributes('aria-label')).toContain('Expand');
  await wrapper.setProps({ isOpen: true, activeNavigation: 'favorites' });
  await wrapper.get('.sidebar_toggle').trigger('click');
  expect(wrapper.emitted('close')).toHaveLength(1);
  await wrapper.findAll('.nav_item')[1].trigger('click');
  expect(wrapper.emitted('select-navigation')?.[0]).toEqual(['favorites']);
  const destination = { name: 'Target', path: '/target' };
  wrapper.getComponent(FolderTree).vm.$emit('select', destination);
  wrapper.getComponent(FolderTree).vm.$emit('drop-files', [file], destination);
  expect(wrapper.emitted('select-folder')?.[0]).toEqual([destination]);
  expect(context.moveFilesToDestination).toHaveBeenCalledWith([file], '/target');
});

it('renders storage placeholder, usage, collapsed and compact states', async () => {
  vi.mocked(getStorageInfo).mockResolvedValue({
    usedBytes: 25,
    totalBytes: 100,
    availableBytes: 75,
  });
  const wrapper = mount(StorageUsage);
  expect(wrapper.text()).toContain('0%');
  await flushPromises();
  expect(wrapper.text()).toContain('25%');
  await wrapper.get('button').trigger('click');
  expect(wrapper.find('.storage_caption').exists()).toBe(false);
  await wrapper.get('button').trigger('click');
  expect(wrapper.find('.storage_caption').exists()).toBe(true);
  await wrapper.setProps({ compact: true });
  expect(wrapper.find('.storage_compact_indicator').exists()).toBe(true);
});

it('wires the workspace header, breadcrumb and toolbar controls to context', async () => {
  const { context, root } = desktopContext();
  const global = {
    provide: { [desktopExplorerContextKey as symbol]: context },
    stubs: { ExplorerView: true },
  };
  const main = mount(MainView, { global });
  expect(main.getComponent(DesktopHeader).text()).toContain('Docs');
  await main.get('.web_settings_button').trigger('click');
  expect(context.openSettings).toHaveBeenCalled();
  await main.findAll('.breadcrumb')[0].trigger('click');
  expect(context.navigate).toHaveBeenCalledWith('/');
  const toolbar = mount(ActionMenu, { global });
  await toolbar.get('input[type="search"]').setValue('report');
  expect(context.search.value).toBe('report');
  for (const value of ['size', 'modified', 'type', 'name']) {
    await toolbar.get('select').setValue(value);
    expect(context.sortBy.value).toBe(value);
  }
  await toolbar.findAll('.view_switcher button')[1].trigger('click');
  expect(context.viewMode.value).toBe('grid');
  await toolbar.findAll('.view_switcher button')[0].trigger('click');
  expect(context.viewMode.value).toBe('list');
  await toolbar.findAll('.toolbar_action')[1].trigger('click');
  expect(context.createFolder).toHaveBeenCalled();
  await toolbar.findAll('.toolbar_action')[2].trigger('click');
  expect(context.createFile).toHaveBeenCalled();
  const input = toolbar.get<HTMLInputElement>('input[type="file"]');
  const click = vi.spyOn(input.element, 'click');
  await toolbar.findAll('.toolbar_action')[0].trigger('click');
  expect(click).toHaveBeenCalled();
  Object.defineProperty(input.element, 'files', { configurable: true, value: null });
  await input.trigger('change');
  const files = [new File(['data'], 'a.txt')];
  Object.defineProperty(input.element, 'files', { value: files });
  await input.trigger('change');
  expect(context.upload).toHaveBeenCalledWith(files);
  root.value = true;
  await toolbar.vm.$nextTick();
  expect(toolbar.find('.workspace_toolbar').exists()).toBe(false);
  root.value = false;
  await toolbar.vm.$nextTick();
  expect(toolbar.find('input[type="search"]').exists()).toBe(true);
  expect(toolbar.find('select').exists()).toBe(true);
  expect(toolbar.findAll('.toolbar_action')).toHaveLength(3);
});

it('disables view changes for an empty listing and restores controls when entries return', async () => {
  const { context, entries } = desktopContext();
  const wrapper = mount(ActionMenu, {
    global: { provide: { [desktopExplorerContextKey as symbol]: context } },
  });
  entries.value = [];
  await wrapper.vm.$nextTick();
  const buttons = wrapper.findAll<HTMLButtonElement>('.view_switcher button');
  expect(buttons.every((button) => button.element.disabled)).toBe(true);
  await buttons[1].trigger('click');
  expect(context.viewMode.value).toBe('list');
  entries.value = [file];
  await wrapper.vm.$nextTick();
  expect(buttons.every((button) => !button.element.disabled)).toBe(true);
  await buttons[1].trigger('click');
  expect(context.viewMode.value).toBe('grid');
});
