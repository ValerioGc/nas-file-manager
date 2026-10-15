import { afterEach, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ContextMenu from '@/components/common/ContextMenu.vue';
import type { FileEntry } from '@/types/files';

const folder: FileEntry = {
  name: 'Documents',
  path: '/Documents',
  kind: 'folder',
  hidden: false,
  size: null,
  modified: null,
};
let originalParent: PropertyDescriptor | undefined;
afterEach(() => {
  if (originalParent) {
    Object.defineProperty(window, 'parent', originalParent);
  }
  vi.restoreAllMocks();
});

it('offers a desktop shortcut only for a folder inside the launcher', async () => {
  originalParent = Object.getOwnPropertyDescriptor(window, 'parent');
  Object.defineProperty(window, 'parent', { configurable: true, value: { postMessage: vi.fn() } });
  const wrapper = mount(ContextMenu, { props: { file: folder, files: [folder], x: 0, y: 0 } });
  const shortcut = wrapper
    .findAll('[role="menuitem"]')
    .find((button) => button.text() === 'Add desktop shortcut');
  expect(shortcut).toBeDefined();
  await shortcut!.trigger('click');
  expect(wrapper.emitted('action')?.[0]).toEqual(['shortcut']);
  wrapper.unmount();
});

it('limits drive actions to opening it, and switches between hide and unhide for files', async () => {
  const wrapper = mount(ContextMenu, {
    props: { file: folder, files: [folder], x: 0, y: 0, drive: true, canPaste: true },
  });
  expect(wrapper.findAll('[role="menuitem"]').map((item) => item.text())).toEqual(['Open drive']);
  await wrapper.get('[role="menuitem"]').trigger('click');
  expect(wrapper.emitted('action')?.at(-1)).toEqual(['open-drive']);
  await wrapper.setProps({ drive: false });
  expect(wrapper.text()).toContain('Hide');
  const hidden = { ...folder, name: '.Documents', hidden: true };
  await wrapper.setProps({ file: hidden, files: [hidden] });
  const show = wrapper.findAll('[role="menuitem"]').find((item) => item.text() === 'Unhide')!;
  await show.trigger('click');
  expect(wrapper.emitted('action')?.at(-1)).toEqual(['show']);
});
