import { afterEach, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import App from '@/App.vue';
import DesktopApp from '@/components/desktop/layout/DesktopApp.vue';
import FilePickerView from '@/components/picker/FilePickerView.vue';

const parent = Object.getOwnPropertyDescriptor(window, 'parent')!;

afterEach(() => {
  Object.defineProperty(window, 'parent', parent);
});

it('shows the explorer when it is not framed as a file picker', () => {
  window.history.replaceState({}, '', '/?nasPicker=token-1');
  const wrapper = mount(App, { shallow: true });
  expect(wrapper.findComponent(DesktopApp).exists()).toBe(true);
  expect(wrapper.findComponent(FilePickerView).exists()).toBe(false);
});

it('shows the file picker inside a frame that asks for one', () => {
  window.history.replaceState({}, '', '/?nasPicker=token-1');
  Object.defineProperty(window, 'parent', {
    configurable: true,
    value: { postMessage: vi.fn() },
  });
  const wrapper = mount(App, { shallow: true });
  expect(wrapper.findComponent(FilePickerView).exists()).toBe(true);
  expect(wrapper.findComponent(DesktopApp).exists()).toBe(false);
});
