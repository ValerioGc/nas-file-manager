export type FileKind = 'folder' | 'image' | 'video' | 'document' | 'archive' | 'file';

export interface FileEntry {
  name: string;
  path: string;
  kind: FileKind;
  hidden?: boolean;
  size: number | null;
  modified: number | string | null;
}

export type FileSort = 'modified' | 'name' | 'size' | 'type';

export type FileNameValidationError =
  'nameRequired' | 'invalidName' | 'reservedName' | 'nameTooLong' | 'fileExtensionRequired';

export type ClipboardMode = 'copy' | 'cut';

export interface FileClipboard {
  files: FileEntry[];
  mode: ClipboardMode;
}

export interface CopyMoveRequest {
  destination: string;
  source: string;
}

export interface RenameRequest {
  name: string;
  path: string;
}

export interface ArchiveRequest {
  path: string;
  password?: string | null;
}
