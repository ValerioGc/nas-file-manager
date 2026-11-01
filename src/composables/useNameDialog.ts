import { computed, ref } from 'vue';
import { useI18n } from '@/i18n';
import type { NameDialogActions, NameDialogMode } from '@/types/dialogs';
import type { FileEntry } from '@/types/files';
import { messageOf } from '@/utils/errors';

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
      error.value = messageOf(reason, t.value.operationFailed);
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
