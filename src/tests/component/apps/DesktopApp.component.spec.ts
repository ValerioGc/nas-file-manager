import { beforeEach, expect, it, onTestFinished, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import DesktopApp from '@/apps/desktop/DesktopApp.vue';
import AsideMenu from '@/components/desktop/navigation/AsideMenu.vue';
import FileNameModal from '@/components/common/FileNameModal.vue';
import MoveDialog from '@/components/common/MoveDialog.vue';
import ArchiveDialog from '@/components/common/ArchiveDialog.vue';
import SettingsModal from '@/components/desktop/settings/SettingsModal.vue';
import ConfirmDialog from '@/components/common/ConfirmDialog.vue';
import ConflictDialog from '@/components/common/ConflictDialog.vue';
import {
  useDesktopExplorerContext,
  type DesktopExplorerContext,
} from '@/composables/useDesktopExplorerContext';
import { useFileOperations } from '@/composables/useFileOperations';
import { useFilesystem } from '@/composables/useFilesystem';
import { useFileClipboard } from '@/composables/useFileClipboard';
import { useFavorites } from '@/composables/useFavorites';
import { useShares } from '@/composables/useShares';
import { readShares } from '@/services/shares';
import { usePreferences } from '@/composables/usePreferences';
import { nasName } from '@/composables/useNasLauncherContext';
import { listArchive, listDirectory, listVolumes } from '@/services/filesystem';
import { notifyNasShell } from '@/services/nasShell';
import { setLocale } from '@/i18n';
import { file, folder, archive, deferred } from '../../helpers/fixtures';
import { appState } from '../../helpers/appState';
vi.mock('@/composables/useFileOperations', () => ({ useFileOperations: vi.fn() }));
vi.mock('@/composables/useFilesystem', () => ({ useFilesystem: vi.fn() }));
vi.mock('@/services/filesystem', () => ({
  listArchive: vi.fn(),
  listDirectory: vi.fn(),
  listVolumes: vi.fn(),
}));
vi.mock('@/services/nasShell', () => ({ notifyNasShell: vi.fn(() => false) }));
vi.mock('@/services/shares', () => ({ readShares: vi.fn() }));
vi.mock('@/composables/useStorage', () => ({ refreshStorage: vi.fn() }));
let state: ReturnType<typeof appState>;
let context: DesktopExplorerContext;
beforeEach(() => {
  state = appState();
  vi.mocked(useFileOperations).mockReturnValue(state.operations);
  vi.mocked(useFilesystem).mockReturnValue(state.filesystem as ReturnType<typeof useFilesystem>);
  vi.mocked(listDirectory).mockReset().mockResolvedValue([folder]);
  vi.mocked(listVolumes).mockReset().mockResolvedValue([]);
  vi.mocked(listArchive).mockReset().mockResolvedValue([file]);
  useFileClipboard().clearClipboard();
  useFavorites().favorites.value = [];
  useShares().overview.value = { available: true, user: 'valerio', shares: [] };
  vi.mocked(readShares).mockReset().mockResolvedValue(useShares().overview.value);
  nasName.value = 'nas';
  setLocale('en');
});
function desktop() {
  const wrapper = mount(DesktopApp, {
    shallow: true,
    global: {
      stubs: {
        MainView: defineComponent({
          setup() {
            context = useDesktopExplorerContext();
            return () => h('p', context.selectedFolderName.value);
          },
        }),
      },
    },
  });
  return wrapper;
}

it('loads grouped volumes, navigates, searches, filters and updates localized labels', async () => {
  vi.mocked(listDirectory).mockResolvedValue([
    folder,
    { ...folder, name: 'USB', path: '/usb' },
    { ...folder, name: 'Share', path: '/share' },
  ]);
  vi.mocked(listVolumes).mockResolvedValue([
    { id: 'docs', name: 'Documents', kind: 'device' },
    { id: 'usb', name: 'USB', kind: 'external' },
    { id: 'share', name: 'Share', kind: 'network' },
  ]);
  const wrapper = desktop();
  await flushPromises();
  expect(wrapper.getComponent(AsideMenu).props('folderNodes')).toHaveLength(3);
  expect(context.isComputerRoot.value).toBe(true);
  expect(context.canMutateCurrentPath.value).toBe(false);
  expect(context.files.value).toHaveLength(3);
  expect(context.isListLoading.value).toBe(false);
  expect(context.breadcrumbs.value).toHaveLength(1);
  expect(context.searchSummary.value).toBe('');
  context.navigate('/docs');
  expect(context.selectedFolderName.value).toBe('Documents');
  expect(context.breadcrumbs.value[1].label).toBe('Documents');
  context.navigate('/other/deeper');
  expect(context.breadcrumbs.value[1].label).toBe('other');
  setLocale('it');
  await flushPromises();
  expect(context.selectedFolderName.value).toBe('deeper');
  context.search.value = 'report';
  await flushPromises();
  expect(state.filesystem.search).toHaveBeenCalledWith('report');
  expect(context.searchSummary.value).toContain('1');
  useFavorites().addFavorite(file);
  context.selectNavigation('favorites');
  await flushPromises();
  expect(context.files.value).toEqual([file]);
  expect(context.breadcrumbs.value).toHaveLength(1);
  setLocale('en');
  await flushPromises();
  expect(context.selectedFolderName.value).toBe('Favorites');
  // Back to all the files, at the folder they were left at; once more, at the top.
  context.selectNavigation('all-files');
  expect(context.activeNavigation.value).toBe('all-files');
  expect(context.selectedFolderName.value).toBe('deeper');
  expect(context.breadcrumbs.value.at(-1)?.path).toBe('/other/deeper');
  context.selectNavigation('all-files');
  nasName.value = ' Office ';
  await flushPromises();
  expect(context.selectedFolderName.value).toBe('Office');
  setLocale('it');
  await flushPromises();
  expect(context.selectedFolderName.value).toBe('Office');
  wrapper.getComponent(AsideMenu).vm.$emit('select-folder', folder);
  await flushPromises();
  expect(state.filesystem.load).toHaveBeenCalledWith('/docs');
  usePreferences().preferences.value.showHiddenFiles = true;
  await flushPromises();
  expect(listDirectory).toHaveBeenCalled();
  vi.mocked(listDirectory).mockRejectedValueOnce(new Error('Offline'));
  nasName.value = '';
  await flushPromises();
  expect(wrapper.getComponent(AsideMenu).props('folderNodes')).toEqual([]);
  const completed = vi.mocked(useFileOperations).mock.calls.at(-1)?.[0];
  await completed?.();
  expect(state.filesystem.load).toHaveBeenCalled();
});

it('handles sidebar, settings, keyboard and notices', async () => {
  const queries: ReturnType<typeof window.matchMedia>[] = [];
  // matchMedia is already a mock from browserSetup: wrap its implementation, not the mock itself.
  const matchMedia = vi.mocked(window.matchMedia);
  const original = matchMedia.getMockImplementation()!;
  onTestFinished(() => {
    matchMedia.mockImplementation(original);
  });
  matchMedia.mockImplementation((query) => {
    const media = original(query);
    Object.defineProperty(media, 'matches', { value: true, writable: true });
    queries.push(media);
    return media;
  });
  const wrapper = desktop();
  await flushPromises();
  const aside = wrapper.getComponent(AsideMenu);
  aside.vm.$emit('toggle');
  await flushPromises();
  expect(aside.props('isOpen')).toBe(true);
  await wrapper.get('.overlay').trigger('click');
  expect(aside.props('isOpen')).toBe(false);
  aside.vm.$emit('toggle');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await flushPromises();
  expect(aside.props('isOpen')).toBe(false);
  context.openSettings();
  await flushPromises();
  expect(wrapper.getComponent(SettingsModal).props('open')).toBe(true);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await flushPromises();
  expect(wrapper.getComponent(SettingsModal).props('open')).toBe(false);
  context.openSettings();
  wrapper.getComponent(SettingsModal).vm.$emit('close');
  const mobile = queries.find((media) => media.media.includes('680'))!;
  Object.defineProperty(mobile, 'matches', { value: false });
  (vi.mocked(mobile.addEventListener).mock.calls[0][1] as () => void)();
  await flushPromises();
  aside.vm.$emit('toggle');
  await flushPromises();
  expect(aside.props('isCollapsed')).toBe(true);
  aside.vm.$emit('close');
  state.filesystem.error.value = 'Offline';
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe('Offline');
  context.copyToClipboard([file]);
  await flushPromises();
  await wrapper.findAll('.toast').at(-1)!.trigger('click');
  expect(wrapper.findAll('.toast')).toHaveLength(1);
});

it('creates folders/files, renames and keeps submission errors available for retry', async () => {
  window.history.replaceState({}, '', '/?path=/docs');
  const wrapper = desktop();
  await flushPromises();
  const modal = wrapper.getComponent(FileNameModal);
  modal.vm.$emit('submit', 'ignored');
  await flushPromises();
  expect(state.operations.create).not.toHaveBeenCalled();
  for (const mode of ['folder', 'file', 'rename'] as const) {
    if (mode === 'folder') {
      context.createFolder();
    } else if (mode === 'file') {
      context.createFile();
    } else {
      await context.fileAction('rename', file);
    }
    await flushPromises();
    expect(modal.props('open')).toBe(true);
    expect(modal.props('requireExtension')).toBe(mode === 'file');
    modal.vm.$emit('submit', 'new.txt');
    await flushPromises();
    expect(modal.props('open')).toBe(false);
  }
  expect(state.operations.create).toHaveBeenCalledWith('/docs', 'new.txt');
  expect(state.operations.createFile).toHaveBeenCalledWith('/docs', 'new.txt');
  expect(state.operations.rename).toHaveBeenCalledWith(file, 'new.txt');
  for (const error of [new Error('Exists'), null]) {
    state.operations.create.mockRejectedValueOnce(error);
    context.createFolder();
    await flushPromises();
    modal.vm.$emit('submit', 'new');
    await flushPromises();
    expect(modal.props('error')).toBeTruthy();
    modal.vm.$emit('clear-error');
    await flushPromises();
    expect(modal.props('error')).toBe('');
    modal.vm.$emit('close');
    await flushPromises();
    expect(modal.props('open')).toBe(false);
  }
  const pending = deferred<string | null>();
  state.operations.create.mockReturnValueOnce(pending.promise);
  context.createFolder();
  await flushPromises();
  modal.vm.$emit('submit', 'new');
  modal.vm.$emit('close');
  await flushPromises();
  expect(modal.props('open')).toBe(true);
  pending.resolve(null);
  await flushPromises();
  expect(modal.props('open')).toBe(false);
});

it('dispatches single/multiple operations, propagates confirmations and reports failures', async () => {
  const wrapper = desktop();
  await flushPromises();
  await context.fileActions('rename', []);
  expect(wrapper.getComponent(FileNameModal).props('open')).toBe(false);
  await context.fileActions('rename', [file]);
  await flushPromises();
  expect(wrapper.getComponent(FileNameModal).props('initialName')).toBe(file.name);
  await context.fileAction('delete', file);
  await context.fileActions('download', [file]);
  expect(state.operations.perform).toHaveBeenCalledWith('delete', file, expect.any(Function));
  expect(state.operations.performMany).toHaveBeenCalledWith(
    'download',
    [file],
    expect.any(Function),
  );
  // Copy asks its folder in the window of the move, in its copy version: no browser prompt.
  await context.fileAction('copy', file);
  await flushPromises();
  const destination = wrapper.getComponent(MoveDialog);
  expect(destination.props('open')).toBe(true);
  expect(destination.props('action')).toBe('copy');
  destination.vm.$emit('confirm', '/target');
  await flushPromises();
  expect(state.operations.transferToDestination).toHaveBeenCalledWith(
    'copy',
    [file],
    '/target',
    expect.any(Function),
    expect.any(Function),
  );
  const [, , , resolve, confirm] = state.operations.transferToDestination.mock.calls[0];
  const pending = resolve!([{ file, existing: file, destination: '/target' }]);
  await flushPromises();
  expect(wrapper.getComponent(ConflictDialog).props('open')).toBe(true);
  wrapper.getComponent(ConflictDialog).vm.$emit('confirm', []);
  expect(await pending).toEqual([]);
  const confirmation = confirm!({
    title: 'Delete',
    message: '?',
    confirmLabel: 'Yes',
    cancelLabel: 'No',
  });
  await flushPromises();
  expect(wrapper.getComponent(ConfirmDialog).props('open')).toBe(true);
  wrapper.getComponent(ConfirmDialog).vm.$emit('confirm');
  expect(await confirmation).toBe(true);
  wrapper.getComponent(ConfirmDialog).vm.$emit('close');
  wrapper.getComponent(ConflictDialog).vm.$emit('close');
  for (const error of [new Error('Failed'), null]) {
    state.operations.perform.mockRejectedValueOnce(error);
    await context.fileAction('delete', file);
    state.operations.performMany.mockRejectedValueOnce(error);
    await context.fileActions('download', [file]);
    await flushPromises();
    expect(wrapper.text()).toContain(error instanceof Error ? 'Failed' : 'Operation failed');
  }
  state.operations.perform.mockResolvedValueOnce(null);
  await context.fileAction('delete', file);
  state.operations.performMany.mockResolvedValueOnce(null);
  await context.fileActions('delete', [file]);
  vi.mocked(notifyNasShell).mockReturnValueOnce(true);
  await context.fileAction('download', file);
});

it('copies, cuts, pastes and moves with cancellation, errors and empty selections', async () => {
  const wrapper = desktop();
  await flushPromises();
  const dialog = wrapper.getComponent(MoveDialog);
  await context.pasteClipboard();
  context.requestMove([]);
  dialog.vm.$emit('confirm', '/target');
  await flushPromises();
  expect(state.operations.transferToDestination).not.toHaveBeenCalled();
  context.copyToClipboard([file]);
  await context.pasteClipboard();
  expect(useFileClipboard().clipboard.value?.mode).toBe('copy');
  context.cutToClipboard([file]);
  await context.pasteClipboard();
  expect(useFileClipboard().clipboard.value).toBeNull();
  await context.moveFilesToDestination([], '/target');
  await context.moveFilesToDestination([file], '/target');
  await context.fileAction('move', file);
  await flushPromises();
  expect(dialog.props('open')).toBe(true);
  dialog.vm.$emit('close');
  await flushPromises();
  expect(dialog.props('open')).toBe(false);
  await context.fileActions('move', [file]);
  await flushPromises();
  dialog.vm.$emit('confirm', '/target');
  await flushPromises();
  expect(dialog.props('open')).toBe(false);
  for (const error of [new Error('Failed'), null]) {
    context.copyToClipboard([file]);
    state.operations.transferToDestination.mockRejectedValueOnce(error);
    await context.pasteClipboard();
    state.operations.transferToDestination.mockRejectedValueOnce(error);
    await context.moveFilesToDestination([file], '/target');
    context.requestMove([file]);
    await flushPromises();
    state.operations.transferToDestination.mockRejectedValueOnce(error);
    dialog.vm.$emit('confirm', '/target');
    await flushPromises();
    expect(wrapper.text()).toContain(error instanceof Error ? 'Failed' : 'Operation failed');
  }
  state.operations.transferToDestination.mockResolvedValue(null);
  await context.pasteClipboard();
  await context.moveFilesToDestination([file], '/target');
  context.requestMove([file]);
  await flushPromises();
  dialog.vm.$emit('confirm', '/target');
  await flushPromises();
});

it('loads and unlocks archives, handles errors and prevents closing an active request', async () => {
  const wrapper = desktop();
  await flushPromises();
  const dialog = wrapper.getComponent(ArchiveDialog);
  dialog.vm.$emit('submit', 'ignored');
  await flushPromises();
  expect(listArchive).not.toHaveBeenCalled();
  const pending = deferred<(typeof file)[]>();
  vi.mocked(listArchive).mockReturnValueOnce(pending.promise);
  const open = context.openArchive(archive);
  await flushPromises();
  dialog.vm.$emit('close');
  await flushPromises();
  expect(dialog.props('open')).toBe(true);
  pending.resolve([file]);
  await open;
  dialog.vm.$emit('submit', 'secret');
  await flushPromises();
  expect(listArchive).toHaveBeenCalledWith(archive.path, 'secret');
  expect(dialog.props('isLoaded')).toBe(true);
  for (const error of [new Error('Password'), null]) {
    vi.mocked(listArchive).mockRejectedValueOnce(error);
    await context.openArchive(archive);
    await flushPromises();
    expect(dialog.props('error')).toBeTruthy();
    vi.mocked(listArchive).mockRejectedValueOnce(error);
    dialog.vm.$emit('submit', 'wrong');
    await flushPromises();
    expect(dialog.props('isLoaded')).toBe(false);
  }
  dialog.vm.$emit('close');
  await flushPromises();
  expect(dialog.props('open')).toBe(false);
});

it('uploads files and reports success, cancellation and errors', async () => {
  const wrapper = desktop();
  await flushPromises();
  const files = [new File(['a'], 'a.txt')] as unknown as FileList;
  await context.upload(files);
  expect(state.operations.upload).toHaveBeenCalledWith('/', files);
  state.operations.upload.mockResolvedValueOnce(null);
  await context.upload(files);
  for (const error of [new Error('Upload failed'), null]) {
    state.operations.upload.mockRejectedValueOnce(error);
    await context.upload(files);
    await flushPromises();
    expect(wrapper.text()).toContain(error instanceof Error ? 'Upload failed' : 'Operation failed');
  }
});

it('asks before deleting only while the settings say so', async () => {
  const wrapper = desktop();
  await flushPromises();
  const { preferences } = usePreferences();
  const request = { title: 'Delete', message: '?', confirmLabel: 'Yes', cancelLabel: 'No' };

  preferences.value.confirmBeforeDelete = false;
  await context.fileAction('delete', file);
  const [, , skipping] = state.operations.perform.mock.lastCall!;
  await expect(skipping!(request)).resolves.toBe(true);
  expect(wrapper.getComponent(ConfirmDialog).props('open')).toBe(false);

  preferences.value.confirmBeforeDelete = true;
  await context.fileAction('delete', file);
  const [, , asking] = state.operations.perform.mock.lastCall!;
  const answer = asking!(request);
  await flushPromises();
  expect(wrapper.getComponent(ConfirmDialog).props('open')).toBe(true);
  wrapper.getComponent(ConfirmDialog).vm.$emit('confirm');
  await expect(answer).resolves.toBe(true);
});

it('lists the shared folders and keeps them in step after a change of the files', async () => {
  const shared = {
    available: true,
    user: 'valerio',
    shares: [{ path: folder.path, name: 'docs', writable: false, protected: true, entry: folder }],
  };
  vi.mocked(readShares).mockResolvedValue(shared);
  desktop();
  await flushPromises();
  context.navigate('/docs');
  context.selectNavigation('shared');
  await flushPromises();
  expect(readShares).toHaveBeenCalledTimes(1);
  expect(context.files.value).toEqual([folder]);
  expect(context.selectedFolderName.value).toBe('Shared');
  expect(context.breadcrumbs.value).toEqual([{ label: 'Shared', path: '/' }]);
  setLocale('it');
  await flushPromises();
  expect(context.selectedFolderName.value).toBe('Condivise');
  setLocale('en');

  context.selectNavigation('all-files');
  expect(context.selectedFolderName.value).toBe('docs');
  const completed = vi.mocked(useFileOperations).mock.calls.at(-1)?.[0];
  await completed?.();
  expect(readShares).toHaveBeenCalledTimes(2);
});
