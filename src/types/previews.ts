export interface PreviewResource {
  mimeType: string;
  src: string;
}

export type PreviewSize = 'small' | 'large';

export interface PreviewCacheUsage {
  usedBytes: number;
  limitBytes: number;
}
