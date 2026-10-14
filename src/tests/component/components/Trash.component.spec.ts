import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import TrashView from '@/components/desktop/trash/TrashView.vue';
import SettingsModal from '@/components/desktop/settings/SettingsModal.vue';
import MainView from '@/components/desktop/layout/MainView.vue';
import { desktopExplorerContextKey } from '@/composables/useDesktopExplorerContext';
import { loadTrashSettings, useTrash } from '@/composables/useTrash';
import { setLocale } from '@/i18n';
import * as trashApi from '@/services/trash';
import type { TrashEntry } from '@/types/trash';
import { desktopContext } from '../../helpers/desktopContext';

vi.mock('@/services/trash', async (original) => ({
  ...(await original<typeof import('@/services/trash')>()),
  readTrashSettings: vi.fn(),
  saveTrashSettings: vi.fn(),
  listTrashDisks: vi.fn(),
  listTrash: vi.fn(),
  restoreFromTrash: vi.fn(),
  purgeFromTrash: vi.fn(),
  emptyTrash: vi.fn(),
}));

const entry = (name: string, path: string, kind: TrashEntry['kind'] = 'file'): TrashEntry => ({
  name,
  path,
  kind,
  size: 2048,
  deletedAt: Date.UTC(2026, 9, 10, 8, 0) / 1000,
});

beforeEach(() => {
  setLocale('en');
  vi.mocked(trashApi.listTrashDisks).mockResolvedValue([
    { id: 'v-a', name: 'Disk A', bytes: 4096, items: 1 },
    { id: 'v-b', name: 'Disk B', bytes: 0, items: 0 },
  ]);
  vi.mocked(trashApi.listTrash).mockImplementation(async (path) => {
    if (path === 'v-a') {
      return [entry('docs', 'v-a/docs', 'folder')];
    }
    if (path === 'v-a/docs') {
      return [entry('a.pdf', 'v-a/docs/a.pdf')];
    }
    return [];
  });
  vi.mocked(trashApi.restoreFromTrash).mockResolvedValue({
    name: 'a.pdf',
    path: 'v-a/docs/a.pdf',
    kind: 'document',
    size: 2048,
    modified: null,
  });
  vi.mocked(trashApi.purgeFromTrash).mockResolvedValue(undefined);
  vi.mocked(trashApi.emptyTrash).mockResolvedValue(undefined);
  useTrash().settings.value = { enabled: true, days: 30 };
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

async function view() {
  const wrapper = mount(TrashView, { attachTo: document.body });
  await flushPromises();
  return wrapper;
}

const confirm = () =>
  [...document.querySelectorAll<HTMLButtonElement>('.confirm_dialog button')].at(-1)!;

it('lists the trash of each disk with its tree, size and date', async () => {
  const wrapper = await view();
  expect(wrapper.text()).toContain('Items stay here 30 days');
  expect(wrapper.get('[data-testid="trash_disk_v-a"]').text()).toContain('Disk A');
  expect(wrapper.find('[data-testid="trash_disk_v-b"]').exists()).toBe(false);
  expect(wrapper.find('[data-testid="trash_entry_v-a/docs/a.pdf"]').exists()).toBe(false);
  await wrapper.get('[data-testid="trash_entry_v-a/docs"] button').trigger('click');
  await flushPromises();
  const file = wrapper.get('[data-testid="trash_entry_v-a/docs/a.pdf"]');
  expect(file.text()).toContain('a.pdf');
  expect(file.text()).toContain('2 KB');
  await wrapper.get('[data-testid="trash_entry_v-a/docs"] button').trigger('click');
  expect(wrapper.find('[data-testid="trash_entry_v-a/docs/a.pdf"]').exists()).toBe(false);
});

it('restores an entry, and asks before replacing what is already there', async () => {
  const wrapper = await view();
  await wrapper.get('[data-testid="trash_restore_v-a/docs"]').trigger('click');
  await flushPromises();
  expect(trashApi.restoreFromTrash).toHaveBeenCalledWith('v-a/docs', false);
  expect(wrapper.emitted('restored')).toHaveLength(1);

  vi.mocked(trashApi.restoreFromTrash).mockRejectedValueOnce(
    new trashApi.TrashFailure('destination already exists', 409),
  );
  await wrapper.get('[data-testid="trash_restore_v-a/docs"]').trigger('click');
  await flushPromises();
  expect(document.body.textContent).toContain('The original path already holds “docs”.');
  confirm().click();
  await flushPromises();
  expect(trashApi.restoreFromTrash).toHaveBeenLastCalledWith('v-a/docs', true);

  vi.mocked(trashApi.restoreFromTrash).mockRejectedValueOnce(new Error('disk unplugged'));
  await wrapper.get('[data-testid="trash_restore_v-a/docs"]').trigger('click');
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe('disk unplugged');
});

it('deletes an entry for good and empties the whole trash after asking', async () => {
  const wrapper = await view();
  await wrapper.get('[data-testid="trash_purge_v-a/docs"]').trigger('click');
  expect(document.body.textContent).toContain('“docs” will be deleted permanently');
  confirm().click();
  await flushPromises();
  expect(trashApi.purgeFromTrash).toHaveBeenCalledWith('v-a/docs');

  await wrapper.get('[data-testid="trash_empty"]').trigger('click');
  expect(document.body.textContent).toContain('The content of the trash of every disk');
  confirm().click();
  await flushPromises();
  expect(trashApi.emptyTrash).toHaveBeenCalled();
});

it('says when the trash is empty, off or cannot be read', async () => {
  vi.mocked(trashApi.listTrashDisks).mockResolvedValueOnce([
    { id: '', name: '', bytes: 0, items: 0 },
  ]);
  useTrash().settings.value = { enabled: false, days: 30 };
  const empty = await view();
  expect(empty.get('[data-testid="trash_nothing"]').text()).toBe('The trash is empty');
  expect(empty.text()).toContain('Trash off');
  expect(empty.get('[data-testid="trash_empty"]').attributes('disabled')).toBeDefined();
  empty.unmount();
  vi.mocked(trashApi.listTrashDisks).mockRejectedValueOnce('offline');
  const failed = await view();
  expect(failed.get('[role="alert"]').text()).toBe('The trash is not available.');
});

it('shows the trash in place of the files when the trash is chosen', async () => {
  const { context } = desktopContext();
  context.activeNavigation.value = 'trash';
  const wrapper = mount(MainView, {
    global: { provide: { [desktopExplorerContextKey as symbol]: context } },
    attachTo: document.body,
  });
  await flushPromises();
  expect(wrapper.find('[data-testid="trash_view"]').exists()).toBe(true);
  await wrapper.get('[data-testid="trash_restore_v-a/docs"]').trigger('click');
  await flushPromises();
  expect(context.refreshFolders).toHaveBeenCalled();
});

it('turns the trash on and off, sets its days and empties it from the settings', async () => {
  vi.mocked(trashApi.readTrashSettings).mockResolvedValue({ enabled: true, days: 30 });
  vi.mocked(trashApi.saveTrashSettings).mockImplementation(async (saved) => saved);
  await loadTrashSettings();
  const wrapper = mount(SettingsModal, { props: { open: true }, attachTo: document.body });
  await flushPromises();
  await wrapper.get('[data-testid="settings_trash"]').setValue(false);
  await flushPromises();
  expect(trashApi.saveTrashSettings).toHaveBeenLastCalledWith({ enabled: false, days: 30 });
  const days = wrapper.get('[data-testid="settings_trash_days"]');
  await days.setValue('7');
  await days.trigger('change');
  await flushPromises();
  expect(trashApi.saveTrashSettings).toHaveBeenLastCalledWith({ enabled: false, days: 7 });
  await wrapper.get('[data-testid="settings_trash_days_increase"]').trigger('click');
  await flushPromises();
  expect(trashApi.saveTrashSettings).toHaveBeenLastCalledWith({ enabled: false, days: 8 });
  await days.setValue('0');
  await days.trigger('change');
  expect(trashApi.saveTrashSettings).toHaveBeenCalledTimes(3);
  const empty = wrapper.get('[data-testid="settings_trash_empty"]');
  await empty.trigger('click');
  expect(empty.text()).toBe('Confirm emptying');
  expect(trashApi.emptyTrash).not.toHaveBeenCalled();
  await empty.trigger('click');
  await flushPromises();
  expect(trashApi.emptyTrash).toHaveBeenCalled();
  vi.mocked(trashApi.saveTrashSettings).mockRejectedValueOnce(new Error('offline'));
  await wrapper.get('[data-testid="settings_trash"]').setValue(true);
  await flushPromises();
  expect(wrapper.text()).toContain('The trash is not available.');

  vi.mocked(trashApi.readTrashSettings).mockRejectedValueOnce(new Error('offline'));
  await loadTrashSettings();
  expect(useTrash().loaded.value).toBe(false);
  wrapper.unmount();
});
