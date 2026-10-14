import { expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import WebApp from '@/apps/web/WebApp.vue';
import DesktopApp from '@/apps/desktop/DesktopApp.vue';

it('shows the one layout of the explorer, on every screen', () => {
  const wrapper = mount(WebApp, { shallow: true });
  expect(wrapper.findComponent(DesktopApp).exists()).toBe(true);
});
