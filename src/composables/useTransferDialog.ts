import { ref } from 'vue';
import type { TransferDialogActions } from '@/types/dialogs';
import type { FileEntry } from '@/types/files';
import type { TransferAction } from '@/types/transfers';

/** Copy and move dialog, shared by every layout. */
export function useTransferDialog(actions: TransferDialogActions) {
  const action = ref<TransferAction>('move');
  const files = ref<FileEntry[]>([]);
  const isOpen = ref(false);
  const isSubmitting = ref(false);

  function request(kind: TransferAction, chosen: FileEntry[]) {
    if (chosen.length === 0) {
      return;
    }
    action.value = kind;
    files.value = [...chosen];
    isOpen.value = true;
  }

  function close() {
    if (isSubmitting.value) {
      return;
    }
    isOpen.value = false;
    files.value = [];
  }

  async function submit(destination: string) {
    if (files.value.length === 0) {
      return;
    }
    isSubmitting.value = true;
    isOpen.value = false;
    try {
      const message = await actions.transfer(
        action.value,
        files.value,
        destination,
        actions.resolveConflicts,
        actions.confirmOperation,
      );
      if (message) {
        actions.done(message);
      }
    } catch (reason) {
      actions.failed(reason);
    } finally {
      isSubmitting.value = false;
      files.value = [];
    }
  }

  return { action, files, isOpen, isSubmitting, request, close, submit };
}
