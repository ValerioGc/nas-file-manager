import { inject, provide, type ComputedRef, type InjectionKey, type Ref } from 'vue';
import type { FileAction } from '@/composables/useFileOperations';
import type { FileSort } from '@/composables/useFileSorting';
import type { FileEntry } from '@/types/files';
import type { VolumeInfo } from '@/types/storage';

export type Breadcrumb = { label: string; path: string };
export type DesktopContextAction =
  | 'open-drive'
  | FileAction
  | 'copy-to-clipboard'
  | 'cut-to-clipboard'
  | 'favorite'
  | 'paste'
  | 'share'
  | 'shortcut';
export type DesktopNavigation = 'all-files' | 'favorites' | 'shared' | 'trash';

export interface DesktopExplorerContext {
  breadcrumbs: ComputedRef<Breadcrumb[]>;
  canMutateCurrentPath: ComputedRef<boolean>;
  files: ComputedRef<FileEntry[]>;
  isListLoading: ComputedRef<boolean>;
  isComputerRoot: ComputedRef<boolean>;
  isMutating: Ref<boolean>;
  isNarrowDesktop: Ref<boolean>;
  /** A phone: the side menu slides in over the files, opened from the header. */
  isMobileSidebar: Ref<boolean>;
  isSidebarCollapsed: Ref<boolean>;
  search: Ref<string>;
  searchSummary: ComputedRef<string>;
  selectedFolderName: Ref<string>;
  sortBy: Ref<FileSort>;
  viewMode: Ref<'grid' | 'list'>;
  volumes: Ref<VolumeInfo[]>;
  createFolder: () => void | Promise<void>;
  createFile: () => void | Promise<void>;
  copyToClipboard: (files: FileEntry[]) => void;
  cutToClipboard: (files: FileEntry[]) => void;
  activeNavigation: Ref<DesktopNavigation>;
  fileAction: (action: FileAction, file: FileEntry) => void | Promise<void>;
  fileActions: (action: FileAction, files: FileEntry[]) => void | Promise<void>;
  navigate: (path: string, name?: string) => void;
  openArchive: (file: FileEntry) => void | Promise<void>;
  selectNavigation: (navigation: DesktopNavigation) => void | Promise<void>;
  openSettings: () => void;
  /** The folders and the free space read again: after a restore from the trash. */
  refreshFolders: () => void | Promise<void>;
  openSidebar: () => void;
  pasteClipboard: () => void | Promise<void>;
  moveFilesToDestination: (files: FileEntry[], destination: string) => void | Promise<void>;
  requestMove: (files: FileEntry[]) => void;
  upload: (files: FileList) => void | Promise<void>;
}

export const desktopExplorerContextKey: InjectionKey<DesktopExplorerContext> =
  Symbol('desktopExplorerContext');

export function provideDesktopExplorerContext(context: DesktopExplorerContext) {
  provide(desktopExplorerContextKey, context);
}

export function useDesktopExplorerContext() {
  const context = inject(desktopExplorerContextKey);
  if (!context) {
    throw new Error('Desktop explorer context is unavailable');
  }

  return context;
}
