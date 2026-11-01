import { appApiUrl } from '@/services/apiUrl';
import type { ArchiveRequest, CopyMoveRequest, FileEntry, RenameRequest } from '@/types/files';
import type { PreviewCacheUsage, PreviewResource, PreviewSize } from '@/types/previews';
import type { StorageInfo, VolumeInfo } from '@/types/storage';
import { toBackendPath, toUiPath } from '@/utils/paths';

// Video frames are rendered in the browser and only the most recent ones are kept.
const MAX_VIDEO_PREVIEWS = 60;
const videoPreviewCache = new Map<string, PreviewResource>();
const pendingVideoPreviews = new Map<string, Promise<PreviewResource>>();

/** Converts a backend entry to a UI path rooted at `/`. */
export function toUiEntry(entry: FileEntry): FileEntry {
  return { ...entry, path: toUiPath(entry.path) };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(appApiUrl(url), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    throw new Error((await response.text()) || `Request failed: ${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export async function listDirectory(path = ''): Promise<FileEntry[]> {
  const result = await request<FileEntry[]>(
    `api/files?path=${encodeURIComponent(toBackendPath(path))}`,
  );
  return result.map(toUiEntry);
}

export async function searchFilesystem(query: string): Promise<FileEntry[]> {
  const result = await request<FileEntry[]>(`api/search?query=${encodeURIComponent(query)}`);
  return result.map(toUiEntry);
}

export async function listArchive(path: string, password?: string): Promise<FileEntry[]> {
  const request: ArchiveRequest = {
    path: toBackendPath(path),
    password: password || null,
  };
  const result = await requestJson<FileEntry[]>('api/archives/list', 'POST', request);
  return result.map(toUiEntry);
}

export async function getStorageInfo(): Promise<StorageInfo> {
  return request<StorageInfo>('api/storage');
}

export async function listVolumes(): Promise<VolumeInfo[]> {
  return request<VolumeInfo[]>('api/volumes');
}

export async function createDirectory(path: string): Promise<FileEntry> {
  const request = { path: toBackendPath(path) };
  const result = await requestJson<FileEntry>('api/directories', 'POST', request);
  return toUiEntry(result);
}

export async function createFile(path: string): Promise<FileEntry> {
  const request = { path: toBackendPath(path) };
  const result = await requestJson<FileEntry>('api/files', 'POST', request);
  return toUiEntry(result);
}

export async function renameEntry(path: string, name: string): Promise<FileEntry> {
  const request: RenameRequest = { path: toBackendPath(path), name };
  const result = await requestJson<FileEntry>('api/files', 'PATCH', request);
  return toUiEntry(result);
}

export async function copyEntry(source: string, destination: string): Promise<FileEntry> {
  return copyOrMove('api/copy', source, destination);
}

export async function moveEntry(source: string, destination: string): Promise<FileEntry> {
  return copyOrMove('api/move', source, destination);
}

export async function deleteEntry(path: string): Promise<void> {
  await request<void>(`api/files?path=${encodeURIComponent(toBackendPath(path))}`, {
    method: 'DELETE',
  });
}

export async function uploadFile(path: string, file: File): Promise<FileEntry> {
  const result = await requestUpload<FileEntry>(
    `api/uploads?path=${encodeURIComponent(toBackendPath(path))}`,
    file,
  );
  return toUiEntry(result);
}

/**
 * Download URL the browser streams to disk, so the file size is not limited. A video played from it
 * reads only the parts it shows.
 */
export function downloadUrl(path: string) {
  return appApiUrl(`api/downloads?path=${encodeURIComponent(toBackendPath(path))}`);
}

/** Preview URL keyed on the file date and size, so the browser can cache it forever. */
export function previewUrl(file: Pick<FileEntry, 'path' | 'modified' | 'size'>, size: PreviewSize) {
  const query = new URLSearchParams({
    path: toBackendPath(file.path),
    size,
    v: `${file.modified ?? ''}-${file.size ?? ''}`,
  });
  return appApiUrl(`api/previews?${query}`);
}

export async function previewCacheUsage(): Promise<PreviewCacheUsage> {
  return request<PreviewCacheUsage>('api/previews/cache');
}

export async function setPreviewCacheLimit(limitBytes: number): Promise<PreviewCacheUsage> {
  return requestJson<PreviewCacheUsage>('api/previews/cache', 'PUT', { limitBytes });
}

export async function emptyPreviewCache(): Promise<PreviewCacheUsage> {
  return request<PreviewCacheUsage>('api/previews/cache', { method: 'DELETE' });
}

export function clearPreviewCache() {
  for (const preview of videoPreviewCache.values()) {
    if (preview.src.startsWith('blob:')) {
      URL.revokeObjectURL(preview.src);
    }
  }
  videoPreviewCache.clear();
  pendingVideoPreviews.clear();
}

export async function getVideoFramePreview(
  file: Pick<FileEntry, 'name' | 'path' | 'modified'>,
): Promise<PreviewResource> {
  const key = `${file.path}:${file.modified ?? ''}`;
  const cached = videoPreviewCache.get(key);
  if (cached) {
    return cached;
  }

  const pending = pendingVideoPreviews.get(key);
  if (pending) {
    return pending;
  }

  const preview = loadVideoFramePreview(file);
  pendingVideoPreviews.set(key, preview);
  try {
    const resource = await preview;
    videoPreviewCache.set(key, resource);
    for (const [oldest, frame] of videoPreviewCache) {
      if (videoPreviewCache.size <= MAX_VIDEO_PREVIEWS) {
        break;
      }
      URL.revokeObjectURL(frame.src);
      videoPreviewCache.delete(oldest);
    }
    return resource;
  } finally {
    pendingVideoPreviews.delete(key);
  }
}

async function copyOrMove(url: string, source: string, destination: string): Promise<FileEntry> {
  const request: CopyMoveRequest = {
    source: toBackendPath(source),
    destination: toBackendPath(destination),
  };
  return toUiEntry(await requestJson<FileEntry>(url, 'POST', request));
}

function requestJson<T>(url: string, method: string, body: unknown) {
  return request<T>(url, { method, body: JSON.stringify(body) });
}

async function requestUpload<T>(url: string, file: File): Promise<T> {
  const response = await fetch(appApiUrl(url), { method: 'POST', body: file });
  if (!response.ok) {
    throw new Error((await response.text()) || `Upload failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

/** First frame of a video, read from the NAS up to that frame only. */
async function loadVideoFramePreview(file: Pick<FileEntry, 'path'>): Promise<PreviewResource> {
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.src = downloadUrl(file.path);

  try {
    await waitForVideoData(video);
    const canvas = document.createElement('canvas');
    const dimensions = getPreviewDimensions(video.videoWidth, video.videoHeight);
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Video preview canvas is unavailable');
    }
    context.drawImage(video, 0, 0, dimensions.width, dimensions.height);
    const blob = await canvasToBlob(canvas);
    return {
      mimeType: 'image/jpeg',
      src: URL.createObjectURL(blob),
    };
  } finally {
    // Stops the download once the frame is drawn.
    video.removeAttribute('src');
    video.load();
  }
}

function waitForVideoData(video: HTMLVideoElement) {
  return new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('Video preview could not be decoded'));
    video.load();
  });
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error('Video preview could not be rendered'));
      },
      'image/jpeg',
      0.82,
    );
  });
}

function getPreviewDimensions(videoWidth: number, videoHeight: number) {
  const maxWidth = 640;
  const maxHeight = 400;
  const width = videoWidth || maxWidth;
  const height = videoHeight || maxHeight;
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

// Built once, since every row formats its date.
const modifiedDates = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatModified(modified: FileEntry['modified']) {
  if (typeof modified === 'string') {
    return modified;
  }
  if (!modified) {
    return '-';
  }
  return modifiedDates.format(modified * 1000);
}
