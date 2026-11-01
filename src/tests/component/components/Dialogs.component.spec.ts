import { expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import BaseModal from '@/components/common/BaseModal.vue';
import ConfirmDialog from '@/components/common/ConfirmDialog.vue';
import ConflictDialog from '@/components/common/ConflictDialog.vue';
import FileNameModal from '@/components/common/FileNameModal.vue';
import MoveDialog from '@/components/common/MoveDialog.vue';
import ArchiveDialog from '@/components/common/ArchiveDialog.vue';
import FolderTree from '@/components/common/FolderTree.vue';
import { listArchive } from '@/services/filesystem';
import type { FileEntry } from '@/types/files';
import { file, folder, archive, deferred } from '../../helpers/fixtures';

vi.mock('@/services/filesystem', async (original) => ({
  ...(await original<typeof import('@/services/filesystem')>()),
  listArchive: vi.fn(async () => []),
}));

it('closes a modal only on the backdrop or Escape, and renders slots', async () => {
  const wrapper = mount(BaseModal, {
    props: { open: false, 'aria-label': 'Dialog' },
    slots: { default: '<button>Inside</button>', header: 'Heading', footer: 'Footer' },
  });
  expect(wrapper.find('dialog').exists()).toBe(false);
  await wrapper.setProps({ open: true });
  expect(wrapper.text()).toContain('Heading');
  await wrapper.get('button').trigger('click');
  expect(wrapper.emitted('close')).toBeUndefined();
  await wrapper.get('dialog').trigger('keydown', { key: 'Escape' });
  await wrapper.get('.modal_backdrop').trigger('click');
  expect(wrapper.emitted('close')).toHaveLength(2);
});

it('emits confirmation and all cancellation paths', async () => {
  const wrapper = mount(ConfirmDialog, {
    props: {
      open: true,
      title: 'Delete',
      message: 'Really?',
      confirmLabel: 'Yes',
      cancelLabel: 'No',
    },
  });
  expect(wrapper.text()).toContain('Really?');
  await wrapper.get('.primary').trigger('click');
  await wrapper.get('.secondary').trigger('click');
  await wrapper.get('.confirm_dialog_close').trigger('click');
  wrapper.getComponent(BaseModal).vm.$emit('close');
  expect(wrapper.emitted('confirm')).toHaveLength(1);
  expect(wrapper.emitted('close')).toHaveLength(3);
});

it('validates names, clears server errors, resets on reopen and submits a valid name', async () => {
  const wrapper = mount(FileNameModal, {
    props: { open: false, title: 'New file', submitLabel: 'Create', requireExtension: true },
  });
  await wrapper.setProps({ open: true, initialName: 'bad/name' });
  await wrapper.get('form').trigger('submit');
  expect(wrapper.get('input').attributes('aria-invalid')).toBe('true');
  expect(wrapper.emitted('submit')).toBeUndefined();
  await wrapper.get('input').setValue('report.txt');
  expect(wrapper.emitted('clear-error')).toHaveLength(1);
  await wrapper.get('form').trigger('submit');
  expect(wrapper.emitted('submit')?.[0]).toEqual(['report.txt']);
  await wrapper.setProps({ error: 'Already exists', hint: 'Use an extension', isSubmitting: true });
  expect(wrapper.text()).toContain('Already exists');
  expect(wrapper.get('.primary').attributes('disabled')).toBeDefined();
  await wrapper.get('.secondary').trigger('click');
  await wrapper.get('.file_name_modal_close').trigger('click');
  wrapper.getComponent(BaseModal).vm.$emit('close');
  expect(wrapper.emitted('close')).toHaveLength(3);
  await wrapper.setProps({ open: false });
  await wrapper.setProps({ open: true, initialName: 'fresh.txt', error: '' });
  expect(wrapper.get<HTMLInputElement>('input').element.value).toBe('fresh.txt');
});

it('validates rename conflicts and preserves skip/overwrite decisions', async () => {
  const conflicts = [file, folder].map((entry) => ({
    file: entry,
    existing: entry,
    destination: '/target',
  }));
  const wrapper = mount(ConflictDialog, { props: { open: false, conflicts } });
  await wrapper.setProps({ open: true });
  await wrapper.findAll('select')[0].setValue('rename');
  expect(wrapper.get<HTMLInputElement>('input').element.value).toBe('report (copy).txt');
  await wrapper.get('input').setValue('bad/name');
  await wrapper.get('.primary').trigger('click');
  expect(wrapper.find('.conflict_item_error').exists()).toBe(true);
  expect(wrapper.emitted('confirm')).toBeUndefined();
  await wrapper.get('input').setValue('copy.txt');
  await wrapper.findAll('select')[1].setValue('overwrite');
  await wrapper.get('.primary').trigger('click');
  expect(wrapper.emitted('confirm')?.[0]).toEqual([
    [
      { sourcePath: file.path, action: 'rename', name: 'copy.txt' },
      { sourcePath: folder.path, action: 'overwrite', name: 'docs (copy)' },
    ],
  ]);
  await wrapper.get('.secondary').trigger('click');
  await wrapper.get('.conflict_dialog_close').trigger('click');
  wrapper.getComponent(BaseModal).vm.$emit('close');
  expect(wrapper.emitted('close')).toHaveLength(3);
});

it('filters nested move destinations and confirms the selected folder', async () => {
  const child = { name: 'Pictures', path: '/docs/pictures' };
  const nodes = [
    {
      name: 'NAS',
      path: '/',
      children: [
        { name: 'Docs', path: '/docs', children: [child] },
        { name: 'Other', path: '/other' },
      ],
    },
  ];
  const wrapper = mount(MoveDialog, {
    props: { open: false, files: [file], folderNodes: nodes, currentPath: '/docs' },
  });
  await wrapper.setProps({ open: true });
  await wrapper.get('input').setValue('pictures');
  expect(wrapper.getComponent(FolderTree).props('nodes')).toEqual([
    {
      ...nodes[0],
      children: [{ ...nodes[0].children[0], children: [{ ...child, children: [] }] }],
    },
  ]);
  wrapper.getComponent(FolderTree).vm.$emit('select', child);
  await wrapper.get('.primary').trigger('click');
  expect(wrapper.emitted('confirm')?.[0]).toEqual(['/docs/pictures']);
  await wrapper.get('input').setValue('missing');
  expect(wrapper.find('.move_dialog_empty').exists()).toBe(true);
  await wrapper.get('.secondary').trigger('click');
  await wrapper.get('.move_dialog_close').trigger('click');
  wrapper.getComponent(BaseModal).vm.$emit('close');
  expect(wrapper.emitted('close')).toHaveLength(3);
});

it('reads, unlocks and empties archives, staying open while one is being read', async () => {
  const pending = deferred<FileEntry[]>();
  vi.mocked(listArchive).mockReturnValueOnce(pending.promise);
  const wrapper = mount(ArchiveDialog, {
    props: { archive: null },
    global: { stubs: { FileThumbnail: true } },
  });
  expect(wrapper.find('dialog').exists()).toBe(false);
  expect(listArchive).not.toHaveBeenCalled();

  await wrapper.setProps({ archive });
  expect(listArchive).toHaveBeenCalledWith(archive.path, undefined);
  expect(wrapper.find('.archive_dialog_loading').exists()).toBe(true);
  await wrapper.get('.archive_dialog_close').trigger('click');
  expect(wrapper.emitted('close')).toBeUndefined();
  pending.resolve([file, folder]);
  await flushPromises();
  expect(wrapper.findAll('.archive_dialog_entry')).toHaveLength(2);

  for (const failure of [new Error('Password required'), null]) {
    vi.mocked(listArchive).mockRejectedValueOnce(failure);
    await wrapper.get('input').setValue('wrong');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(listArchive).toHaveBeenLastCalledWith(archive.path, 'wrong');
    expect(wrapper.get('[role="alert"]').text()).toBe(
      failure ? 'Password required' : 'Operation failed',
    );
  }
  vi.mocked(listArchive).mockResolvedValueOnce([]);
  await wrapper.get('form').trigger('submit');
  await flushPromises();
  expect(wrapper.find('.archive_dialog_empty').exists()).toBe(true);

  await wrapper.get('.archive_dialog_close').trigger('click');
  wrapper.getComponent(BaseModal).vm.$emit('close');
  expect(wrapper.emitted('close')).toHaveLength(2);
  await wrapper.setProps({ archive: null });
  await wrapper.setProps({ archive });
  expect(wrapper.get<HTMLInputElement>('input').element.value).toBe('');
});
