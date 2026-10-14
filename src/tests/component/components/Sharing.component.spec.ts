import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import ShareModal from '@/components/common/ShareModal.vue';
import EmptyPlaceholder from '@/components/common/EmptyPlaceholder.vue';
import ContextMenu from '@/components/common/ContextMenu.vue';
import FileThumbnail from '@/components/common/FileThumbnail.vue';
import FileBrowser from '@/components/desktop/explorer/FileBrowser.vue';
import AsideMenu from '@/components/desktop/navigation/AsideMenu.vue';
import { desktopExplorerContextKey } from '@/composables/useDesktopExplorerContext';
import { useShares } from '@/composables/useShares';
import { notifyNasShell } from '@/services/nasShell';
import { confirmSharePassword, shareFolder, unshareFolder } from '@/services/shares';
import type { SharedFolder } from '@/types/shares';
import { folder } from '../../helpers/fixtures';
import { desktopContext } from '../../helpers/desktopContext';

vi.mock('@/services/shares', () => ({
  readShares: vi.fn(),
  shareFolder: vi.fn(),
  unshareFolder: vi.fn(),
  confirmSharePassword: vi.fn(),
}));
vi.mock('@/services/nasShell', async (original) => ({
  ...(await original<typeof import('@/services/nasShell')>()),
  notifyNasShell: vi.fn(() => false),
}));

const shared: SharedFolder = {
  path: folder.path,
  name: 'docs',
  writable: false,
  protected: true,
  entry: folder,
};

beforeEach(() => {
  vi.mocked(shareFolder).mockReset();
  vi.mocked(unshareFolder).mockReset();
  vi.mocked(confirmSharePassword).mockReset();
  useShares().overview.value = { available: true, user: 'valerio', shares: [] };
});

afterEach(() => {
  document.body.innerHTML = '';
});

function modal() {
  return mount(ShareModal, { props: { open: true, folder }, attachTo: document.body });
}

it('shares a folder protected by the account, asking its password once', async () => {
  vi.mocked(confirmSharePassword).mockResolvedValueOnce('wrong').mockResolvedValueOnce('ok');
  vi.mocked(shareFolder).mockResolvedValue(shared);
  const wrapper = modal();

  expect(wrapper.text()).toContain('Access with the user valerio');
  expect(wrapper.find('[data-testid="share_stop"]').exists()).toBe(false);
  await wrapper.get('[data-testid="share_password"]').setValue('not it');
  await wrapper.get('form').trigger('submit');
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe('Wrong password.');
  expect(shareFolder).not.toHaveBeenCalled();

  await wrapper.get('[data-testid="share_password"]').setValue('long enough');
  await wrapper.get('form').trigger('submit');
  await flushPromises();
  expect(confirmSharePassword).toHaveBeenLastCalledWith('long enough');
  expect(shareFolder).toHaveBeenCalledWith(folder.path, { writable: false, protected: true });
  expect(wrapper.emitted('done')?.[0]).toEqual(['Folder shared as docs']);
  expect(wrapper.emitted('close')).toHaveLength(1);
});

it('shares an open folder written from the network without a password', async () => {
  vi.mocked(shareFolder).mockResolvedValue({ ...shared, writable: true, protected: false });
  const wrapper = modal();

  await wrapper.get('[data-testid="share_writable"]').setValue(true);
  await wrapper.get('[data-testid="share_protected"]').setValue(false);
  expect(wrapper.find('[data-testid="share_password"]').exists()).toBe(false);
  expect(wrapper.text()).toContain('Accessible from the whole local network');
  await wrapper.get('form').trigger('submit');
  await flushPromises();
  expect(confirmSharePassword).not.toHaveBeenCalled();
  expect(shareFolder).toHaveBeenCalledWith(folder.path, { writable: true, protected: false });
});

it('shows the addresses of a share and stops it', async () => {
  useShares().overview.value.shares = [shared];
  vi.mocked(unshareFolder).mockResolvedValueOnce();
  const wrapper = modal();

  expect(wrapper.text()).toMatch(/\\\\.+\\docs/);
  expect(wrapper.text()).toContain('smb://');
  // Samba has the password already: the change does not ask for it.
  expect(wrapper.find('[data-testid="share_password"]').exists()).toBe(false);
  expect(wrapper.get('[data-testid="share_submit"]').text()).toBe('Save');
  await wrapper.get('[data-testid="share_stop"]').trigger('click');
  await flushPromises();
  expect(unshareFolder).toHaveBeenCalledWith(folder.path);
  expect(wrapper.emitted('done')?.[0]).toEqual(['docs is no longer shared']);
});

it('says what the backend or the gateway refused, and closes from its cross', async () => {
  vi.mocked(confirmSharePassword).mockResolvedValueOnce('unavailable').mockResolvedValueOnce('ok');
  vi.mocked(shareFolder).mockRejectedValueOnce(new Error('docs is not a folder of the data disks'));
  const wrapper = modal();
  await wrapper.get('[data-testid="share_password"]').setValue('long enough');
  await wrapper.get('form').trigger('submit');
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain('not available');
  await wrapper.get('form').trigger('submit');
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe('docs is not a folder of the data disks');

  useShares().overview.value.shares = [shared];
  vi.mocked(unshareFolder).mockRejectedValueOnce(new Error('the folder is not shared'));
  await wrapper.setProps({ open: false });
  await wrapper.setProps({ open: true });
  await wrapper.get('[data-testid="share_stop"]').trigger('click');
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe('the folder is not shared');
  await wrapper.get('.share_modal_close').trigger('click');
  expect(wrapper.emitted('close')).toHaveLength(1);
});

it('draws a placeholder with its symbol, or a spinner while it reads', () => {
  const empty = mount(EmptyPlaceholder, {
    props: { title: 'Nothing', text: 'Add something', icon: '/folder.svg', testid: 'probe' },
  });
  expect(empty.get('[data-testid="probe"]').text()).toContain('Add something');
  expect(empty.find('img').attributes('src')).toBe('/folder.svg');
  const loading = mount(EmptyPlaceholder, { props: { title: 'Reading', loading: true } });
  expect(loading.attributes('role')).toBe('status');
  expect(loading.find('img').exists()).toBe(false);
});

it('offers sharing for one folder only, where Samba is there', async () => {
  const labels = (wrapper: ReturnType<typeof mount>) =>
    wrapper.findAll('[role="menuitem"]').map((item) => item.text());
  const menu = mount(ContextMenu, { props: { file: folder, files: [folder], x: 0, y: 0 } });
  expect(labels(menu)).toContain('Share on the network');
  await menu
    .findAll('[role="menuitem"]')
    .find((item) => item.text() === 'Share on the network')!
    .trigger('click');
  expect(menu.emitted('action')?.[0]).toEqual(['share']);

  useShares().overview.value.shares = [shared];
  expect(
    labels(mount(ContextMenu, { props: { file: folder, files: [folder], x: 0, y: 0 } })),
  ).toContain('Network sharing');
  useShares().overview.value.available = false;
  expect(
    labels(mount(ContextMenu, { props: { file: folder, files: [folder], x: 0, y: 0 } })),
  ).not.toContain('Network sharing');
});

it('marks a shared folder over its icon', async () => {
  const thumbnail = mount(FileThumbnail, { props: { file: folder } });
  expect(thumbnail.find('[data-testid="shared_badge"]').exists()).toBe(false);
  useShares().overview.value.shares = [shared];
  await flushPromises();
  expect(thumbnail.get('[data-testid="shared_badge"]').attributes('aria-label')).toBe(
    'Shared on the network',
  );
});

it('lists the shared folders after the favorites', async () => {
  const state = desktopContext();
  const aside = mount(AsideMenu, {
    props: {
      folderNodes: [],
      isCollapsed: false,
      isOpen: false,
      selectedFolderPath: '/',
      activeNavigation: 'shared',
    },
    global: {
      provide: { [desktopExplorerContextKey as symbol]: state.context },
      stubs: { StorageUsage: true },
    },
  });
  expect(aside.findAll('.nav_item').map((item) => item.text())).toEqual([
    'All files',
    'Favorites',
    'Shared',
    'Trash',
  ]);
  expect(aside.get('[data-testid="nav_shared"]').classes()).toContain('active');
  await aside.get('[data-testid="nav_shared"]').trigger('click');
  expect(aside.emitted('select-navigation')?.[0]).toEqual(['shared']);
});

it('opens the sharing of a folder from its menu and tells what happened', async () => {
  const state = desktopContext();
  vi.mocked(shareFolder).mockResolvedValue({ ...shared, protected: false });
  const wrapper = mount(FileBrowser, {
    props: { selectedFiles: [] },
    global: {
      provide: { [desktopExplorerContextKey as symbol]: state.context },
      stubs: { FileThumbnail: true, ContextMenu: true },
    },
    attachTo: document.body,
  });
  await wrapper.findAll('.file_row')[1].trigger('contextmenu');
  wrapper.getComponent(ContextMenu).vm.$emit('action', 'share');
  await flushPromises();
  const share = wrapper.getComponent(ShareModal);
  expect(share.props('folder')).toEqual(folder);
  share.vm.$emit('done', 'Folder shared as docs');
  await flushPromises();
  expect(notifyNasShell).toHaveBeenCalledWith('Folder shared as docs', '', 'success');
  expect(wrapper.get('output').text()).toBe('Folder shared as docs');
  share.vm.$emit('close');
  await flushPromises();
  expect(wrapper.getComponent(ShareModal).props('open')).toBe(false);
  wrapper.unmount();
});

it('closes from its buttons and from Escape, and shows nothing without a folder', async () => {
  const wrapper = modal();
  await wrapper
    .findAll('button')
    .find((button) => button.text() === 'Cancel')!
    .trigger('click');
  await wrapper.get('dialog').trigger('keydown', { key: 'Escape' });
  expect(wrapper.emitted('close')).toHaveLength(2);
  await wrapper.setProps({ folder: null });
  expect(wrapper.find('[data-testid="share_modal"]').exists()).toBe(false);
});
