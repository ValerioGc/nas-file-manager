import type { FileEntry } from '@/types/files';

/** A folder shared over SMB on the local network. */
export interface SharedFolder {
  path: string;
  /** Share name seen by network clients. */
  name: string;
  writable: boolean;
  /** Requires the account credentials, otherwise guests can open it. */
  protected: boolean;
  /** Null while the folder is unavailable, for example on an unplugged disk. */
  entry: FileEntry | null;
}

export interface SharesOverview {
  /** True when Samba is installed and the launcher responds. */
  available: boolean;
  /** Account user name for protected shares. */
  user: string | null;
  shares: SharedFolder[];
}

export interface ShareSettings {
  writable: boolean;
  protected: boolean;
}

export type PasswordOutcome = 'ok' | 'wrong' | 'throttled' | 'unavailable' | 'failed';
