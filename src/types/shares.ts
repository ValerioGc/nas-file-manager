import type { FileEntry } from '@/types/files';

/** A folder shared on the local network, by its path in the Explorer. */
export interface SharedFolder {
  path: string;
  /** The name the computers of the network see. */
  name: string;
  writable: boolean;
  /** Opened with the user and the password of the account; otherwise by anyone. */
  protected: boolean;
  /** The folder as the lists show it, none while it is not there (a disk unplugged). */
  entry: FileEntry | null;
}

export interface SharesOverview {
  /** Samba is on the NAS and the launcher answers. */
  available: boolean;
  /** The user a computer signs in with to a protected share. */
  user: string | null;
  shares: SharedFolder[];
}

export interface ShareSettings {
  writable: boolean;
  protected: boolean;
}
