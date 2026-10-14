import folderIcon from '@/assets/icons/thumbnail-folder.svg?url';
import documentIcon from '@/assets/icons/thumbnail-document.svg?url';
import { expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import FilePreview from '@/components/common/FilePreview.vue';
import FileThumbnail from '@/components/common/FileThumbnail.vue';
import LoadingSkeleton from '@/components/common/LoadingSkeleton.vue';
import SettingsRow from '@/components/common/SettingsRow.vue';
import SettingsSection from '@/components/common/SettingsSection.vue';
import TransferProgress from '@/components/common/TransferProgress.vue';
import SettingsModal from '@/components/desktop/settings/SettingsModal.vue';
import BaseModal from '@/components/common/BaseModal.vue';
import { usePreferences } from '@/composables/usePreferences';
import { useFavorites } from '@/composables/useFavorites';
import { nasContextActive } from '@/composables/useNasLauncherContext';
import { setLocale } from '@/i18n';
import {
  downloadFile,
  emptyPreviewCache,
  getVideoFramePreview,
  previewCacheUsage,
  setPreviewCacheLimit,
} from '@/services/filesystem';
import { file, folder, deferred } from '../../helpers/fixtures';

vi.mock('@/services/filesystem', async (original) => ({
  ...(await original<typeof import('@/services/filesystem')>()),
  previewCacheUsage: vi.fn(async () => ({ usedBytes: 5 * 1024 * 1024, limitBytes: 2 ** 31 })),
  setPreviewCacheLimit: vi.fn(async (limitBytes: number) => ({ usedBytes: 0, limitBytes })),
  emptyPreviewCache: vi.fn(async () => ({ usedBytes: 0, limitBytes: 2 ** 31 })),
  getVideoFramePreview: vi.fn(async () => ({ src: '/frame.png' })),
  downloadFile: vi.fn(async () => ({ blob: new Blob(['video']), name: 'video.mp4' })),
}));

it('renders skeleton variants, settings slots and transfer progress', async () => {
  const skeleton = mount(LoadingSkeleton);
  expect(skeleton.findAll('.skeleton_row')).toHaveLength(5);
  await skeleton.setProps({ variant: 'preview' });
  expect(skeleton.find('.skeleton_media').exists()).toBe(true);
  const row = mount(SettingsRow, { props: { title: 'Title' }, slots: { default: 'Control' } });
  expect(row.text()).toBe('TitleControl');
  await row.setProps({ as: 'label', description: 'Description' });
  expect(row.element.tagName).toBe('LABEL');
  expect(row.text()).toContain('Description');
  const section = mount(SettingsSection, {
    props: { title: 'Options' },
    slots: { default: 'Fields' },
  });
  expect(section.text()).toContain('Fields');
  const progress = mount(TransferProgress, { props: { transfer: null } });
  expect(progress.find('output').exists()).toBe(false);
  await progress.setProps({ transfer: { kind: 'upload', label: 'Uploading', progress: 50 } });
  expect(progress.text()).toContain('Uploading');
  expect(progress.html()).toContain('50%');
});

it('shows empty, single and multiple selections and emits preview actions', async () => {
  const wrapper = mount(FilePreview, {
    props: { title: 'Details', showActions: true, showClose: true, showCollapse: true },
    global: { stubs: { FileThumbnail: true } },
  });
  expect(wrapper.find('.empty_preview').exists()).toBe(true);
  await wrapper.setProps({ file });
  expect(wrapper.text()).toContain(file.path);
  for (const button of wrapper.findAll('.preview_file_actions button')) {
    await button.trigger('click');
  }
  expect(wrapper.emitted('action')).toEqual([
    ['copy'],
    ['move'],
    ['delete'],
    ['rename'],
    ['favorite'],
  ]);
  await wrapper.get('.preview_close').trigger('click');
  await wrapper.get('.preview_collapse').trigger('click');
  expect(wrapper.emitted('close')).toHaveLength(1);
  expect(wrapper.emitted('collapse')).toHaveLength(1);
  useFavorites().addFavorite(file);
  await wrapper.setProps({ files: [file] });
  expect(wrapper.text()).toContain('Remove from favorites');
  await wrapper.setProps({ files: [folder] });
  expect(wrapper.text()).toContain('Folders');
  await wrapper.setProps({ files: [file, folder] });
  expect(wrapper.find('.preview_selection_summary').exists()).toBe(true);
  expect(wrapper.findAll('.preview_file_actions button')).toHaveLength(4);
});

it('loads thumbnails and video previews, revoking animated resources on errors and unmount', async () => {
  const { preferences } = usePreferences();
  preferences.value.generatePreviews = true;
  preferences.value.animatedPreviews = true;
  const wrapper = mount(FileThumbnail, { props: { file: folder } });
  await wrapper.trigger('mouseenter');
  expect(wrapper.get('img').attributes('src')).toBe(folderIcon);
  await wrapper.setProps({ file });
  await flushPromises();
  // The browser fetches the small preview, named after the file; a skeleton until it is there.
  const preview = wrapper.get('img');
  expect(preview.attributes('src')).toBe(
    'api/previews?path=docs%2Freport.txt&size=small&v=1000-1024',
  );
  expect(wrapper.find('.file_thumbnail_loading').exists()).toBe(true);
  await preview.trigger('load');
  expect(wrapper.find('.file_thumbnail_loading').exists()).toBe(false);
  const video = { ...file, path: '/film.mp4', kind: 'video' as const };
  await wrapper.setProps({ file: video });
  await flushPromises();
  expect(getVideoFramePreview).toHaveBeenCalledWith(video);
  expect(wrapper.get('img').attributes('src')).toBe('/frame.png');
  await wrapper.trigger('mouseenter');
  await flushPromises();
  expect(wrapper.get('video').attributes('src')).toBe('blob:preview');
  await wrapper.trigger('focusin');
  await wrapper.get('video').trigger('error');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  await wrapper.trigger('focusin');
  await flushPromises();
  await wrapper.trigger('focusout');
  vi.mocked(downloadFile).mockRejectedValueOnce(new Error('Unavailable'));
  await wrapper.trigger('mouseenter');
  await flushPromises();
  expect(wrapper.find('video').exists()).toBe(false);
  await wrapper.trigger('mouseleave');
  await wrapper.trigger('mouseenter');
  await flushPromises();
  wrapper.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalled();
});

it('ignores stale frames and falls back to icons when disabled or failed', async () => {
  const { preferences } = usePreferences();
  preferences.value.generatePreviews = true;
  const video = { ...file, path: '/film.mp4', kind: 'video' as const };
  const old = deferred<{ src: string; mimeType: string }>();
  vi.mocked(getVideoFramePreview).mockReturnValueOnce(old.promise);
  const wrapper = mount(FileThumbnail, { props: { file: video } });
  expect(wrapper.find('.file_thumbnail_loading').exists()).toBe(true);
  await wrapper.setProps({ file: folder });
  old.resolve({ src: '/old.png', mimeType: 'image/png' });
  await flushPromises();
  expect(wrapper.get('img').attributes('src')).toBe(folderIcon);
  vi.mocked(getVideoFramePreview).mockRejectedValueOnce(new Error('No frame'));
  await wrapper.setProps({ file: { ...video, path: '/other.mp4' } });
  await flushPromises();
  expect(wrapper.find('.file_thumbnail_loading').exists()).toBe(false);
  // A preview the NAS cannot make: the icon of the kind.
  await wrapper.setProps({ file });
  await wrapper.get('img').trigger('error');
  expect(wrapper.get('img').attributes('src')).toBe(documentIcon);
  preferences.value.generatePreviews = false;
  await flushPromises();
  await wrapper.trigger('mouseenter');
  expect(wrapper.find('video').exists()).toBe(false);
  preferences.value.generatePreviews = true;
});

it('asks for a preview only once the thumbnail comes into view', async () => {
  const { preferences } = usePreferences();
  preferences.value.generatePreviews = true;
  let reveal: IntersectionObserverCallback = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        reveal = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const wrapper = mount(FileThumbnail, { props: { file } });
  await flushPromises();
  expect(wrapper.get('img').attributes('src')).toBe(documentIcon);
  reveal([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
  await flushPromises();
  expect(wrapper.get('img').attributes('src')).toBe(documentIcon);
  reveal([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
  await flushPromises();
  expect(wrapper.get('img').attributes('src')).toContain('api/previews?');
  expect(disconnect).toHaveBeenCalled();
  wrapper.unmount();
  vi.unstubAllGlobals();
});

it('shows the room of the previews, changes its limit and empties it', async () => {
  setLocale('en');
  const wrapper = mount(SettingsModal, { props: { open: true }, attachTo: document.body });
  await wrapper.get('#settings-tab-previews').trigger('click');
  await flushPromises();
  expect(previewCacheUsage).toHaveBeenCalled();
  expect(wrapper.get('[data-testid="settings_preview_cache_used"]').text()).toBe(
    'Previews kept 5 MB',
  );
  const limit = wrapper.get('[data-testid="settings_preview_cache_limit"]');
  expect(limit.findAll('option').map((option) => option.text())).toEqual([
    '100 MB',
    '250 MB',
    '500 MB',
    '1 GB',
    '1.5 GB',
    '2 GB',
  ]);
  vi.mocked(setPreviewCacheLimit).mockResolvedValueOnce({
    usedBytes: 1024 * 1024,
    limitBytes: 500 * 1024 * 1024,
  });
  await limit.setValue(String(500 * 1024 * 1024));
  await flushPromises();
  expect(setPreviewCacheLimit).toHaveBeenCalledWith(500 * 1024 * 1024);
  vi.mocked(emptyPreviewCache).mockRejectedValueOnce(new Error('offline'));
  await wrapper.get('[data-testid="settings_preview_cache_empty"]').trigger('click');
  await flushPromises();
  expect(wrapper.text()).toContain('Space of the previews not available.');
  wrapper.unmount();
  setLocale('it');
});

it('updates each settings panel and supports keyboard tab navigation', async () => {
  nasContextActive.value = false;
  setLocale('en');
  const wrapper = mount(SettingsModal, { props: { open: true }, attachTo: document.body });
  expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toEqual([
    'General',
    'Previews',
    'File list',
    'Appearance',
  ]);
  await wrapper.get('#settings-tab-appearance').trigger('click');
  for (const button of wrapper.findAll('.theme_option')) {
    await button.trigger('click');
  }
  for (const button of wrapper.findAll('.language_option')) {
    await button.trigger('click');
  }
  for (const tab of wrapper.findAll('[role="tab"]')) {
    await tab.trigger('click');
    for (const input of wrapper.findAll('input[type="checkbox"]')) {
      await input.setValue(!(input.element as HTMLInputElement).checked);
    }
  }
  await wrapper.get('#settings-tab-file-list').trigger('keydown', { key: 'ArrowRight' });
  expect(wrapper.get('#settings-tab-appearance').attributes('aria-selected')).toBe('true');
  await wrapper.get('#settings-tab-appearance').trigger('keydown', { key: 'ArrowLeft' });
  expect(wrapper.get('#settings-tab-file-list').attributes('aria-selected')).toBe('true');
  await wrapper.get('#settings-tab-file-list').trigger('keydown', { key: 'Enter' });
  setLocale('it');
  await wrapper.get('#settings-tab-appearance').trigger('click');
  nasContextActive.value = true;
  await flushPromises();
  // Inside the launcher theme and language follow it: no empty tab, back to the first one.
  expect(wrapper.find('.theme_option').exists()).toBe(false);
  expect(wrapper.find('#settings-tab-appearance').exists()).toBe(false);
  expect(wrapper.get('#settings-tab-general').attributes('aria-selected')).toBe('true');
  await wrapper.get('.modal_close').trigger('click');
  wrapper.getComponent(BaseModal).vm.$emit('close');
  expect(wrapper.emitted('close')).toHaveLength(2);
  nasContextActive.value = false;
  setLocale('en');
});
