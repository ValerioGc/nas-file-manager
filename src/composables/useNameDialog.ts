import { computed, ref } from 'vue';
import { useI18n } from '@/i18n';
import type { FileEntry } from '@/types/files';

export type NameDialogMode = 'create' | 'create-file' | 'rename';

export interface NameDialogActions {
  /** The folder a new folder or file goes in. */
  directory: () => string;
  createFolder: (directory: string, name: string) => Promise<string | null>;
  createFile: (directory: string, name: string) => Promise<string | null>;
  rename: (file: FileEntry, name: string) => Promise<string | null>;
  /** What the operation says when it is done. */
  done: (message: string) => void;
}

/**
 * The window that names a new folder, a new file or an entry to rename: the same in the desktop and
 * in the mobile layouts. Nothing asks the browser for a name.
 */
export function useNameDialog(actions: NameDialogActions) {
  const { t } = useI18n();
  const request = ref<{ mode: NameDialogMode; file?: FileEntry } | null>(null);
  const error = ref('');
  const isSubmitting = ref(false);

  const title = computed(() => {
    if (request.value?.mode === 'create-file') {
      return t.value.newFileName;
    }
    return request.value?.mode === 'rename' ? t.value.newName : t.value.newFolderName;
  });
  const initialName = computed(() => request.value?.file?.name ?? '');
  const hint = computed(() =>
    request.value?.mode === 'create-file' ? t.value.fileExtensionHint : '',
  );
  const requireExtension = computed(() => request.value?.mode === 'create-file');
  const submitLabel = computed(() =>
    request.value?.mode === 'rename' ? t.value.rename : t.value.create,
  );

  function open(mode: NameDialogMode, file?: FileEntry) {
    error.value = '';
    request.value = { mode, file };
  }

  function close() {
    if (isSubmitting.value) {
      return;
    }
    request.value = null;
    error.value = '';
  }

  function clearError() {
    error.value = '';
  }

  async function submit(name: string) {
    const current = request.value;
    if (!current) {
      return;
    }
    isSubmitting.value = true;
    error.value = '';
    try {
      let message: string | null = null;
      if (current.mode === 'create') {
        message = await actions.createFolder(actions.directory(), name);
      } else if (current.mode === 'create-file') {
        message = await actions.createFile(actions.directory(), name);
      } else if (current.file) {
        message = await actions.rename(current.file, name);
      }
      if (message) {
        actions.done(message);
      }
      request.value = null;
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : t.value.operationFailed;
    } finally {
      isSubmitting.value = false;
    }
  }

  return {
    request,
    error,
    isSubmitting,
    title,
    initialName,
    hint,
    requireExtension,
    submitLabel,
    open,
    close,
    clearError,
    submit,
  };
}
