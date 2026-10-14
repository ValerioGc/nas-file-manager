import { ref } from 'vue';
import type { ConflictDecision, FileConflict } from '@/types/conflicts';

export function useConflictResolution() {
  const conflicts = ref<FileConflict[]>([]);
  const isConflictDialogOpen = ref(false);
  let pendingResolution: ((decisions: ConflictDecision[]) => void) | null = null;

  function requestConflictResolution(entries: FileConflict[]): Promise<ConflictDecision[]> {
    conflicts.value = entries;
    isConflictDialogOpen.value = true;
    return new Promise((resolve) => {
      pendingResolution = resolve;
    });
  }

  function resolveConflicts(decisions: ConflictDecision[]) {
    isConflictDialogOpen.value = false;
    conflicts.value = [];
    pendingResolution?.(decisions);
    pendingResolution = null;
  }

  function cancelConflictResolution() {
    resolveConflicts([]);
  }

  return {
    cancelConflictResolution,
    conflicts,
    isConflictDialogOpen,
    requestConflictResolution,
    resolveConflicts,
  };
}
