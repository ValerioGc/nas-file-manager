export interface StorageInfo {
  availableBytes: number;
  totalBytes: number;
  usedBytes: number;
}

export type VolumeKind = 'device' | 'external' | 'network';

export interface VolumeInfo {
  id: string;
  name: string;
  kind: VolumeKind;
}
