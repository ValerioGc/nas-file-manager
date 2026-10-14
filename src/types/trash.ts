import type { FileKind } from '@/types/files';

/** Whether a deletion goes to the trash of its disk, and after how many days it leaves. */
export interface TrashSettings {
  enabled: boolean;
  days: number;
}

/** The trash of one disk. */
export interface TrashDisk {
  id: string;
  name: string;
  bytes: number;
  items: number;
}

/** An entry of the trash, by the path it had: where it goes back. */
export interface TrashEntry {
  name: string;
  path: string;
  kind: FileKind;
  size: number;
  /** Seconds since 1970. */
  deletedAt: number;
}
