export type TransferAction = 'copy' | 'move';

export type TransferKind = 'copy' | 'download' | 'move' | 'upload';

export interface TransferState {
  kind: TransferKind;
  label: string;
  progress: number;
}
