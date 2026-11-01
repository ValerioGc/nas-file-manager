import { expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import DesktopHeader from '@/components/desktop/header/DesktopHeader.vue';
import { desktopExplorerContextKey } from '@/composables/useDesktopExplorerContext';
import { desktopContext } from '../../helpers/desktopContext';

it('opens the side menu from the header on a phone only, and the settings on every screen', async () => {
  const { context } = desktopContext();
  const wrapper = mount(DesktopHeader, {
    global: {
      provide: { [desktopExplorerContextKey as symbol]: context },
      stubs: { FolderBreadcrumb: true },
    },
  });

  expect(wrapper.find('.header_menu_button').exists()).toBe(false);
  await wrapper.get('.web_settings_button').trigger('click');
  expect(context.openSettings).toHaveBeenCalledTimes(1);

  context.isMobileSidebar.value = true;
  await wrapper.vm.$nextTick();
  await wrapper.get('.header_menu_button').trigger('click');
  expect(context.openSidebar).toHaveBeenCalledTimes(1);
});
