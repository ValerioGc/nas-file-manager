import { appApiUrl } from '@/services/apiUrl';
import { toUiEntry } from '@/services/filesystem';
import type { PasswordOutcome, ShareSettings, SharedFolder, SharesOverview } from '@/types/shares';
import { toUiPath } from '@/utils/paths';

const SHARE_PASSWORD_URL = '/auth/account/share-password';

function toUiShare(share: SharedFolder): SharedFolder {
  return { ...share, path: toUiPath(share.path), entry: share.entry && toUiEntry(share.entry) };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(appApiUrl(url), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(
      typeof failure?.error === 'string' ? failure.error : `Request failed: ${response.status}`,
    );
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export async function readShares(): Promise<SharesOverview> {
  const overview = await request<SharesOverview>('api/shares');
  return { ...overview, shares: overview.shares.map(toUiShare) };
}

export async function shareFolder(path: string, settings: ShareSettings): Promise<SharedFolder> {
  const share = await request<SharedFolder>('api/shares', {
    method: 'PUT',
    body: JSON.stringify({ path, ...settings }),
  });
  return toUiShare(share);
}

export async function unshareFolder(path: string): Promise<void> {
  await request<void>(`api/shares?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
}

/** Sends the account password to the gateway, which verifies it and passes it to Samba. */
export async function confirmSharePassword(password: string): Promise<PasswordOutcome> {
  try {
    const response = await fetch(SHARE_PASSWORD_URL, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (response.ok) {
      return 'ok';
    }
    const outcomes: Record<number, PasswordOutcome> = {
      400: 'wrong',
      403: 'wrong',
      429: 'throttled',
      503: 'unavailable',
    };
    return outcomes[response.status] ?? 'failed';
  } catch {
    return 'failed';
  }
}
