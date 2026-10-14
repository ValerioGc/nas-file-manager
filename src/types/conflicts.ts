import type { FileEntry } from '@/types/files';

export type ConflictAction = 'overwrite' | 'rename' | 'skip';

export type FileConflict = {
  file: FileEntry;
  existing: FileEntry;
  destination: string;
};

export type ConflictDecision = {
  sourcePath: string;
  action: ConflictAction;
  name?: string;
};
