import { afterEach, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import FilePickerView from '@/apps/web/FilePickerView.vue';
import {
  createDirectory,
  createFile,
  listDirectory,
  listVolumes,
  searchFilesystem,
} from '@/services/filesystem';
import { sendPickedFiles } from '@/services/nasShell';
import type { FileEntry } from '@/types/files';
import { deferred, file } from '../../helpers/fixtures';

vi.mock('@/services/filesystem', () => ({
  createDirectory: vi.fn(),
  createFile: vi.fn(),
  listDirectory: vi.fn(),
  listVolumes: vi.fn(() => Promise.resolve([])),
  searchFilesystem: vi.fn(),
  previewUrl: vi.fn(() => 'api/previews/test'),
  getPreview: vi.fn(() => Promise.resolve(null)),
  getVideoFramePreview: vi.fn(() => Promise.resolve(null)),
  downloadFile: vi.fn(),
}));
vi.mock('@/services/nasShell', () => ({ sendPickedFiles: vi.fn() }));

afterEach(() => {
  window.history.replaceState({}, '', '/');
  vi.mocked(listDirectory).mockReset();
  vi.mocked(searchFilesystem).mockReset();
  vi.mocked(createDirectory).mockReset();
  vi.mocked(createFile).mockReset();
  vi.mocked(listVolumes).mockReset().mockResolvedValue([]);
  vi.mocked(sendPickedFiles).mockReset();
});

it('uses shared app styles for the picker controls', async () => {
  window.history.replaceState({}, '', '/?nasPicker=token');
  vi.mocked(listDirectory).mockResolvedValue([]);
  const wrapper = mount(FilePickerView);
  await flushPromises();
  expect(wrapper.element.classList.contains('app_surface')).toBe(true);
  // The title and its cross on one row; no bar of buttons for the path.
  expect(wrapper.get('header h1').text()).toBe('Select files');
  expect(wrapper.get('header [data-testid="file_picker_close"]').classes()).toContain(
    'icon_button',
  );
  expect(wrapper.find('header nav').exists()).toBe(false);
  expect(wrapper.get('form').classes()).toContain('search_box');
  const searchButton = wrapper.get('form button');
  expect(searchButton.classes()).toContain('icon_button');
  expect(searchButton.text()).toBe('');
  expect(searchButton.attributes('aria-label')).toBe('Search files and folders');
  expect(wrapper.find('.file_picker_toolbar .toolbar_divider').exists()).toBe(true);
  expect(wrapper.get('footer button:last-child').classes()).toEqual(
    expect.arrayContaining(['button', 'primary']),
  );
  wrapper.unmount();
});

it('browses a folder and returns the selected file with its download path', async () => {
  window.history.replaceState({}, '', '/apps/nas-file-manager/?nasPicker=token-1');
  vi.mocked(listDirectory)
    .mockResolvedValueOnce([
      { name: 'docs', path: '/docs', kind: 'folder', size: null, modified: null },
    ])
    .mockResolvedValueOnce([
      { name: 'report.pdf', path: '/docs/report.pdf', kind: 'document', size: 10, modified: null },
    ]);
  const wrapper = mount(FilePickerView);
  await flushPromises();
  await wrapper.find('.file_picker_list button').trigger('click');
  await flushPromises();
  await wrapper.find('.file_picker_list button').trigger('click');
  await wrapper.find('footer button:last-child').trigger('click');
  expect(sendPickedFiles).toHaveBeenCalledWith(
    'token-1',
    [
      {
        name: 'report.pdf',
        path: '/docs/report.pdf',
        download: 'api/downloads?path=docs%2Freport.pdf',
      },
    ],
    false,
  );
  wrapper.unmount();
});

it('filters image files, starts in the requested folder and navigates with breadcrumbs', async () => {
  window.history.replaceState({}, '', '/?nasPicker=token&extensions=.png,.JPG&directory=%2Fphotos');
  vi.mocked(listDirectory).mockResolvedValue([
    { ...file, name: 'subfolder', kind: 'folder', path: '/photos/subfolder' },
    { ...file, name: 'photo.PNG', path: '/photos/photo.PNG' },
    { ...file, name: 'other.jpg', path: '/photos/other.jpg' },
    { ...file, name: 'report.pdf', path: '/photos/report.pdf' },
  ]);
  const wrapper = mount(FilePickerView);
  await flushPromises();
  expect(listDirectory).toHaveBeenCalledWith('/photos');
  expect(wrapper.findAll('.file_picker_list button').map((button) => button.text())).toEqual([
    'subfolder',
    'photo.PNG',
    'other.jpg',
  ]);
  expect(wrapper.findAll('nav button').map((button) => button.text())).toEqual(['photos']);
  expect(wrapper.get('nav button').attributes('aria-current')).toBe('location');
  await wrapper.get('[data-testid="file_picker_home"]').trigger('click');
  expect(listDirectory).toHaveBeenLastCalledWith('/');
  wrapper.unmount();
});

it('searches the NAS with the same file filter and clears search when browsing a folder', async () => {
  window.history.replaceState({}, '', '/?nasPicker=token&extensions=.pdf');
  vi.mocked(listDirectory).mockResolvedValue([]);
  vi.mocked(searchFilesystem).mockResolvedValue([
    { ...file, name: 'report.pdf', path: '/docs/report.pdf' },
    { ...file, name: 'photo.png', path: '/photos/photo.png' },
    { ...file, name: 'docs', path: '/docs', kind: 'folder' },
  ]);
  const wrapper = mount(FilePickerView);
  await flushPromises();
  await wrapper.get('input[type="search"]').setValue(' report ');
  await wrapper.get('form').trigger('submit');
  await flushPromises();
  expect(searchFilesystem).toHaveBeenCalledWith('report');
  expect(wrapper.findAll('.file_picker_list button')).toHaveLength(2);
  await wrapper.findAll('.file_picker_list button')[1]!.trigger('click');
  await flushPromises();
  expect(wrapper.get('input').element).toHaveProperty('value', '');
  expect(listDirectory).toHaveBeenLastCalledWith('/docs');
  await wrapper.get('form').trigger('submit');
  expect(listDirectory).toHaveBeenLastCalledWith('/docs');
  vi.mocked(searchFilesystem).mockRejectedValue(new Error('offline'));
  await wrapper.get('input').setValue('missing');
  await wrapper.get('form').trigger('submit');
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe('Unable to run the search');
  wrapper.unmount();
});

it('selects several files, goes back to the parent folder and cancels', async () => {
  window.history.replaceState({}, '', '/?nasPicker=token-2&multiple=1');
  const first: FileEntry = {
    name: 'a.txt',
    path: '/docs/a.txt',
    kind: 'document',
    size: 1,
    modified: null,
  };
  const second = { ...first, name: 'b.txt', path: '/docs/b.txt' };
  vi.mocked(listDirectory)
    .mockResolvedValueOnce([
      { name: 'docs', path: '/docs', kind: 'folder', size: null, modified: null },
    ])
    .mockResolvedValueOnce([first, second])
    .mockResolvedValueOnce([]);
  const wrapper = mount(FilePickerView);
  await flushPromises();
  await wrapper.find('.file_picker_list button').trigger('click');
  await flushPromises();
  const [firstButton, secondButton] = wrapper.findAll('.file_picker_list button');
  await firstButton.trigger('click');
  await secondButton.trigger('click');
  expect(wrapper.find('footer span').text()).toBe('2 files');
  await firstButton.trigger('click');
  expect(firstButton.attributes('aria-pressed')).toBe('false');
  expect(secondButton.attributes('aria-pressed')).toBe('true');
  await wrapper.find('.file_picker_toolbar button').trigger('click');
  await flushPromises();
  expect(listDirectory).toHaveBeenLastCalledWith('/');
  expect(wrapper.get('nav').text()).toBe('/');
  await wrapper.find('footer button').trigger('click');
  expect(sendPickedFiles).toHaveBeenCalledWith('token-2', [], true);
  // The cross of the title and Escape cancel too.
  await wrapper.get('[data-testid="file_picker_close"]').trigger('click');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  expect(sendPickedFiles).toHaveBeenCalledTimes(3);
  wrapper.unmount();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(sendPickedFiles).toHaveBeenCalledTimes(3);
});

it('reports failed listings and ignores the ones that arrive too late', async () => {
  const staleFailure = deferred<FileEntry[]>();
  const staleListing = deferred<FileEntry[]>();
  vi.mocked(listDirectory)
    .mockReturnValueOnce(staleFailure.promise)
    .mockRejectedValueOnce('offline')
    .mockReturnValueOnce(staleListing.promise)
    .mockResolvedValueOnce([file])
    .mockRejectedValueOnce(new Error('Forbidden'));
  const wrapper = mount(FilePickerView);
  const picker = wrapper.vm as unknown as { openFolder: (path: string) => Promise<void> };
  await flushPromises();
  expect(wrapper.get('[role="status"]').text()).toBe('Loading file list');
  await picker.openFolder('/offline');
  expect(wrapper.get('[role="alert"]').text()).toBe('Unable to read the files');
  staleFailure.reject(new Error('Stale'));
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe('Unable to read the files');
  void picker.openFolder('/stale');
  await picker.openFolder('/docs');
  staleListing.resolve([]);
  await flushPromises();
  expect(wrapper.get('nav').text()).toBe('/docs');
  expect(wrapper.findAll('.file_picker_list li')).toHaveLength(1);
  await picker.openFolder('/private');
  expect(wrapper.get('[role="alert"]').text()).toBe('Forbidden');
});

it('lists only folders in folder mode and returns the folder being browsed', async () => {
  window.history.replaceState({}, '', '/?nasPicker=token-3&folder=1&extensions=.pdf');
  vi.mocked(listDirectory)
    .mockResolvedValueOnce([
      { ...file, name: 'docs', kind: 'folder', path: '/docs' },
      { ...file, name: 'report.pdf', path: '/report.pdf' },
    ])
    .mockResolvedValueOnce([]);
  const wrapper = mount(FilePickerView);
  await flushPromises();
  expect(wrapper.get('h1').text()).toBe('Select folder');
  expect(wrapper.find('footer span').exists()).toBe(false);
  expect(wrapper.findAll('.file_picker_list button').map((button) => button.text())).toEqual([
    'docs',
  ]);
  await wrapper.get('.file_picker_list button').trigger('click');
  await flushPromises();
  const choose = wrapper.get('footer button:last-child');
  expect(choose.text()).toBe('Select');
  await choose.trigger('click');
  expect(sendPickedFiles).toHaveBeenCalledWith('token-3', [{ name: 'docs', path: '/docs' }], false);
  wrapper.unmount();
});

it('creates a folder or a file in the folder being browsed and lists it', async () => {
  window.history.replaceState({}, '', '/?nasPicker=token-4&directory=%2Fdocs');
  vi.mocked(listDirectory)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ ...file, name: 'new', kind: 'folder', path: '/docs/new' }])
    .mockResolvedValueOnce([]);
  vi.mocked(createDirectory).mockResolvedValue({ ...file, kind: 'folder', path: '/docs/new' });
  vi.mocked(createFile)
    .mockRejectedValueOnce(new Error('Already exists'))
    .mockResolvedValueOnce({ ...file, path: '/docs/note.txt' });
  const wrapper = mount(FilePickerView);
  await flushPromises();

  await wrapper.get('[aria-label="New folder"]').trigger('click');
  await wrapper.get('#file-name-input').setValue('new');
  await wrapper.get('.modal_backdrop form').trigger('submit');
  await flushPromises();
  expect(createDirectory).toHaveBeenCalledWith('/docs/new');
  expect(wrapper.find('.modal_backdrop').exists()).toBe(false);
  expect(wrapper.findAll('.file_picker_list button').map((button) => button.text())).toEqual([
    'new',
  ]);

  await wrapper.get('[aria-label="New file"]').trigger('click');
  await wrapper.get('#file-name-input').setValue('note.txt');
  await wrapper.get('.modal_backdrop form').trigger('submit');
  await flushPromises();
  expect(wrapper.get('.modal_backdrop').text()).toContain('Already exists');
  await wrapper.get('.modal_backdrop form').trigger('submit');
  await flushPromises();
  expect(createFile).toHaveBeenLastCalledWith('/docs/note.txt');
  expect(wrapper.find('.modal_backdrop').exists()).toBe(false);
  wrapper.unmount();
});

it('creates nothing at the root of the NAS, and no file while choosing a folder', async () => {
  window.history.replaceState({}, '', '/?nasPicker=token-5&folder=1');
  vi.mocked(listDirectory).mockResolvedValue([]);
  const wrapper = mount(FilePickerView);
  await flushPromises();
  expect(wrapper.get('[aria-label="New folder"]').attributes('disabled')).toBeDefined();
  expect(wrapper.find('[aria-label="New file"]').exists()).toBe(false);
  await wrapper.get('[aria-label="New folder"]').trigger('click');
  expect(wrapper.find('.modal_backdrop').exists()).toBe(false);
  wrapper.unmount();
});

it('names a disk by its name, not its id, in the path, the breadcrumbs and the choice', async () => {
  window.history.replaceState({}, '', '/?nasPicker=token-6&folder=1&directory=%2Fa1b2-c3d4');
  vi.mocked(listVolumes).mockResolvedValue([{ id: 'a1b2-c3d4', name: 'Data-sdb', kind: 'device' }]);
  vi.mocked(listDirectory).mockResolvedValue([]);
  const wrapper = mount(FilePickerView);
  await flushPromises();
  expect(wrapper.get('nav').attributes('title')).toBe('/Data-sdb');
  expect(wrapper.findAll('nav button').map((button) => button.text())).toEqual(['Data-sdb']);
  await wrapper.get('footer button:last-child').trigger('click');
  expect(sendPickedFiles).toHaveBeenCalledWith(
    'token-6',
    [{ name: 'Data-sdb', path: '/a1b2-c3d4' }],
    false,
  );
  wrapper.unmount();
});

it('keeps the ids when the disks cannot be read, and says when a folder is empty', async () => {
  window.history.replaceState({}, '', '/?nasPicker=token-7&directory=%2Fa1b2-c3d4');
  vi.mocked(listVolumes).mockRejectedValue(new Error('offline'));
  vi.mocked(listDirectory).mockResolvedValue([]);
  const wrapper = mount(FilePickerView);
  await flushPromises();
  expect(wrapper.get('nav').text()).toBe('/a1b2-c3d4');
  const empty = wrapper.get('[data-testid="file_picker_empty"]');
  expect(empty.get('strong').text()).toBe('Empty folder');
  expect(empty.get('p').text()).toContain('creates a folder');
  expect(wrapper.find('.file_picker_list').exists()).toBe(false);
  wrapper.unmount();
});

it('shows the list by default and switches to the grid of previews and back', async () => {
  window.history.replaceState({}, '', '/?nasPicker=token-8&directory=%2Fdocs');
  vi.mocked(listDirectory).mockResolvedValue([
    { ...file, name: 'photos', kind: 'folder', path: '/docs/photos' },
    { ...file, name: 'notes.txt', path: '/docs/notes.txt' },
  ]);
  const wrapper = mount(FilePickerView);
  await flushPromises();
  const list = wrapper.get('[aria-label="List view"]');
  const grid = wrapper.get('[aria-label="Grid view"]');
  expect(list.attributes('aria-pressed')).toBe('true');
  expect(wrapper.get('.file_picker_list').classes()).not.toContain('file_picker_grid');
  expect(wrapper.findAll('.file_picker_thumbnail')).toHaveLength(0);

  await grid.trigger('click');
  expect(grid.attributes('aria-pressed')).toBe('true');
  expect(wrapper.get('.file_picker_list').classes()).toContain('file_picker_grid');
  expect(wrapper.findAll('.file_picker_thumbnail')).toHaveLength(2);

  await list.trigger('click');
  expect(wrapper.findAll('.file_picker_thumbnail')).toHaveLength(0);
  wrapper.unmount();
});

it('says when a search finds nothing, and when a folder has no subfolder to choose', async () => {
  window.history.replaceState({}, '', '/?nasPicker=token-9&folder=1&directory=%2Fdocs');
  vi.mocked(listDirectory).mockResolvedValue([]);
  vi.mocked(searchFilesystem).mockResolvedValue([]);
  const wrapper = mount(FilePickerView);
  await flushPromises();
  expect(wrapper.get('[data-testid="file_picker_empty"] p').text()).toContain(
    'This folder can be selected',
  );
  await wrapper.get('input[type="search"]').setValue('nothing');
  await wrapper.get('form').trigger('submit');
  await flushPromises();
  expect(wrapper.get('[data-testid="file_picker_empty"] strong').text()).toBe('No results');
  wrapper.unmount();
});
