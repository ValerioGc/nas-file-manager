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
