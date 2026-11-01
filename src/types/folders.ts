export interface FolderNode {
  name: string;
  path: string;
  children?: FolderNode[];
  selectable?: boolean;
}
