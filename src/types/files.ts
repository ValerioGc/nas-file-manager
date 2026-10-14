export type FileKind = 'folder' | 'image' | 'video' | 'document' | 'archive' | 'file';

export interface FileEntry {
  name: string;
  path: string;
  kind: FileKind;
  hidden?: boolean;
  size: number | null;
  modified: number | string | null;
}
