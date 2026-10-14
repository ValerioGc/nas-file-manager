import { appApiUrl } from '@/services/apiUrl';
import type { FileEntry } from '@/types/files';
import type { TrashDisk, TrashEntry, TrashSettings } from '@/types/trash';

/** A refusal of the backend, with the status it came with: 409 is a path already taken. */
export class TrashFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(appApiUrl(path), {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const reason =
      parsed && typeof parsed === 'object' && 'error' in parsed && typeof parsed.error === 'string'
        ? parsed.error
        : `Request failed: ${response.status}`;
    throw new TrashFailure(reason, response.status);
  }
  return parsed as T;
}

/** A path of the interface (`/v-a/docs`) as the backend reads it (`v-a/docs`). */
const backendPath = (path: string) => path.replace(/^[/\\]+/, '');
const query = (path: string) => `?path=${encodeURIComponent(backendPath(path))}`;

export const readTrashSettings = () => call<TrashSettings>('api/trash/settings');
export const saveTrashSettings = (settings: TrashSettings) =>
  call<TrashSettings>('api/trash/settings', 'PUT', settings);
export const listTrashDisks = () => call<TrashDisk[]>('api/trash/disks');
export const listTrash = (path: string) => call<TrashEntry[]>(`api/trash${query(path)}`);
export const restoreFromTrash = (path: string, replace = false) =>
  call<FileEntry>('api/trash/restore', 'POST', { path: backendPath(path), replace });
export const purgeFromTrash = (path: string) => call<void>(`api/trash${query(path)}`, 'DELETE');
export const emptyTrash = (disk?: string) =>
  call<void>('api/trash/empty', 'POST', disk === undefined ? {} : { disk });
