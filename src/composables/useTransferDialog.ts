import { ref } from 'vue';
import type { ConfirmationResolver, ConflictResolver } from '@/composables/useFileOperations';
import type { FileEntry } from '@/types/files';

export type TransferAction = 'copy' | 'move';

export interface TransferDialogActions {
  transfer: (
    action: TransferAction,
    files: FileEntry[],
    destination: string,
    resolveConflicts?: ConflictResolver,
    confirmOperation?: ConfirmationResolver,
  ) => Promise<string | null>;
  resolveConflicts: ConflictResolver;
  confirmOperation: ConfirmationResolver;
  /** What the transfer says when it is done. */
  done: (message: string) => void;
  /** Why it failed. */
  failed: (reason: unknown) => void;
}

/**
 * The window that sends entries to another folder, by copy or by move: the same in the desktop and
 * in the mobile layouts. Nothing asks the browser for a destination.
 */
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
