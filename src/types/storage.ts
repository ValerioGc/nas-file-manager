export interface StorageInfo {
  availableBytes: number;
  totalBytes: number;
  usedBytes: number;
}

// Where a volume of the NAS comes from: a data disk inside it, a removable one plugged in, or a
// share of the network.
export type VolumeKind = 'device' | 'external' | 'network';

export interface VolumeInfo {
  id: string;
  name: string;
  kind: VolumeKind;
}
