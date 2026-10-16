import { expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { computed, ref } from 'vue';
import FolderBreadcrumb from '@/components/desktop/header/FolderBreadcrumb.vue';
import { desktopExplorerContextKey } from '@/composables/useDesktopExplorerContext';
import type { Breadcrumb } from '@/composables/useDesktopExplorerContext';
import { desktopContext } from '../../helpers/desktopContext';

it('marks the current folder and navigates from each breadcrumb', async () => {
  const { context } = desktopContext();
  const wrapper = mount(FolderBreadcrumb, {
    global: { provide: { [desktopExplorerContextKey as symbol]: context } },
  });

  const breadcrumbs = wrapper.findAll('.breadcrumb');
  expect(breadcrumbs.map((breadcrumb) => breadcrumb.text())).toEqual(['Home', 'Docs']);
  expect(breadcrumbs[0].attributes('aria-current')).toBeUndefined();
  expect(breadcrumbs[1].classes()).toContain('current');
  expect(breadcrumbs[1].attributes('aria-current')).toBe('location');
  expect(wrapper.get('nav').element.firstElementChild).toBe(breadcrumbs[0].element);
  const separators = wrapper.findAll('.breadcrumb_separator');
  expect(separators).toHaveLength(1);
  expect(separators[0].attributes('aria-hidden')).toBe('true');

  await breadcrumbs[0].trigger('click');
  await breadcrumbs[1].trigger('click');
  expect(context.navigate).toHaveBeenNthCalledWith(1, '/');
  expect(context.navigate).toHaveBeenNthCalledWith(2, '/docs');
});

it('goes back, up and home before the path, each only when it leads somewhere', async () => {
  const { context, root } = desktopContext();
  const wrapper = mount(FolderBreadcrumb, {
    global: { provide: { [desktopExplorerContextKey as symbol]: context } },
  });
  const button = (name: string) => wrapper.get(`[data-testid="location_${name}"]`);

  expect(wrapper.get('.location_bar').element.firstElementChild?.className).toBe(
    'location_actions',
  );
  await button('back').trigger('click');
  await button('up').trigger('click');
  await button('home').trigger('click');
  expect(context.goBack).toHaveBeenCalledOnce();
  expect(context.goUp).toHaveBeenCalledOnce();
  expect(context.goHome).toHaveBeenCalledOnce();

  root.value = true;
  await wrapper.vm.$nextTick();
  expect(button('up').attributes('disabled')).toBeDefined();
  expect(button('home').attributes('disabled')).toBeDefined();
  expect(button('back').attributes('disabled')).toBeUndefined();
});

it('shows no separator for an empty path and updates when a folder becomes available', async () => {
  const { context } = desktopContext();
  const breadcrumbs = ref<Breadcrumb[]>([]);
  context.breadcrumbs = computed(() => breadcrumbs.value);
  const wrapper = mount(FolderBreadcrumb, {
    global: { provide: { [desktopExplorerContextKey as symbol]: context } },
  });

  expect(wrapper.find('nav').exists()).toBe(true);
  expect(wrapper.find('.breadcrumb').exists()).toBe(false);
  expect(wrapper.find('.breadcrumb_separator').exists()).toBe(false);

  breadcrumbs.value = [{ label: 'Home', path: '/' }];
  await wrapper.vm.$nextTick();

  expect(wrapper.get('.breadcrumb').text()).toBe('Home');
  expect(wrapper.get('.breadcrumb').classes()).toContain('current');
  expect(wrapper.find('.breadcrumb_separator').exists()).toBe(false);
});
