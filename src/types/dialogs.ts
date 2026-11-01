import type { ConfirmationResolver } from '@/types/confirmation';
import type { ConflictResolver } from '@/types/conflicts';
import type { FileEntry } from '@/types/files';
import type { TransferAction } from '@/types/transfers';

export type NameDialogMode = 'create' | 'create-file' | 'rename';

export interface NameDialogActions {
  directory: () => string;
  createFolder: (directory: string, name: string) => Promise<string | null>;
  createFile: (directory: string, name: string) => Promise<string | null>;
  rename: (file: FileEntry, name: string) => Promise<string | null>;
  done: (message: string) => void;
}

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
  done: (message: string) => void;
  failed: (reason: unknown) => void;
}
