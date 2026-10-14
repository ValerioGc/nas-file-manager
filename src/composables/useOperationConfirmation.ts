import { ref } from 'vue';
import type { ConfirmationRequest } from '@/types/confirmation';

export function useOperationConfirmation() {
  const request = ref<ConfirmationRequest | null>(null);
  let pendingConfirmation: ((confirmed: boolean) => void) | null = null;

  function confirmOperation(nextRequest: ConfirmationRequest) {
    request.value = nextRequest;
    return new Promise<boolean>((resolve) => {
      pendingConfirmation = resolve;
    });
  }

  function resolveConfirmation(confirmed: boolean) {
    request.value = null;
    pendingConfirmation?.(confirmed);
    pendingConfirmation = null;
  }

  function cancelConfirmation() {
    resolveConfirmation(false);
  }

  return { cancelConfirmation, confirmOperation, request, resolveConfirmation };
}
