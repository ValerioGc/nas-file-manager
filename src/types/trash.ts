import type { FileKind } from '@/types/files';

/** Trash toggle and retention period in days. */
export interface TrashSettings {
  enabled: boolean;
  days: number;
}

export interface TrashDisk {
  id: string;
  name: string;
  bytes: number;
  items: number;
}

/** A trashed item, identified by its original path. */
export interface TrashEntry {
  name: string;
  path: string;
  kind: FileKind;
  size: number;
  /** Unix timestamp in seconds. */
  deletedAt: number;
}

/** The trash operation waiting for the user to confirm it. */
export type PendingTrashAction =
  { kind: 'purge'; entry: TrashEntry } | { kind: 'replace'; entry: TrashEntry } | { kind: 'empty' };
