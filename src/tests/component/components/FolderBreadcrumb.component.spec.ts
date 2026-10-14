import { expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { computed, ref } from 'vue';
import FolderBreadcrumb from '@/components/desktop/header/FolderBreadcrumb.vue';
import { desktopExplorerContextKey } from '@/composables/useDesktopExplorerContext';
import type { Breadcrumb } from '@/composables/useDesktopExplorerContext';
import { desktopContext } from '../../helpers/desktopContext';

it('renders folder separators, marks the current folder and navigates from each breadcrumb', async () => {
  const { context } = desktopContext();
  const wrapper = mount(FolderBreadcrumb, {
    global: { provide: { [desktopExplorerContextKey as symbol]: context } },
  });

  const breadcrumbs = wrapper.findAll('.breadcrumb');
  expect(breadcrumbs.map((breadcrumb) => breadcrumb.text())).toEqual(['Home', 'Docs']);
  expect(breadcrumbs[0].classes()).not.toContain('current');
  expect(breadcrumbs[1].classes()).toContain('current');
  expect(wrapper.get('nav').element.firstElementChild).toBe(breadcrumbs[0].element);
  expect(Array.from(wrapper.get('nav').element.children, (child) => child.textContent)).toEqual([
    'Home',
    '/',
    'Docs',
    '/',
  ]);
  expect(
    wrapper
      .findAll('.breadcrumb_separator')
      .every((separator) => separator.attributes('aria-hidden') === 'true'),
  ).toBe(true);

  await breadcrumbs[0].trigger('click');
  await breadcrumbs[1].trigger('click');
  expect(context.navigate).toHaveBeenNthCalledWith(1, '/');
  expect(context.navigate).toHaveBeenNthCalledWith(2, '/docs');
});

it('omits separators for an empty path and updates when a folder becomes available', async () => {
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
  expect(wrapper.findAll('.breadcrumb_separator')).toHaveLength(1);
  expect(wrapper.get('nav').element.lastElementChild?.textContent).toBe('/');
});
