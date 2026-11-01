import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmSharePassword, readShares, shareFolder, unshareFolder } from '@/services/shares';

function answer(body: unknown, status = 200) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

const entry = { name: 'Foto', path: 'disk/Foto', kind: 'folder', size: null, modified: null };

describe('shares service', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/');
    vi.stubGlobal('fetch', vi.fn());
  });

  it('reads the shares with the paths the interface writes', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      answer({
        available: true,
        user: 'valerio',
        shares: [
          { path: 'disk/Foto', name: 'Foto', writable: false, protected: true, entry },
          { path: 'disk/Via', name: 'Via', writable: true, protected: false, entry: null },
        ],
      }),
    );

    const overview = await readShares();

    expect(fetch).toHaveBeenCalledWith('api/shares', expect.anything());
    expect(overview.user).toBe('valerio');
    expect(overview.shares[0]?.path).toBe('/disk/Foto');
    expect(overview.shares[0]?.entry?.path).toBe('/disk/Foto');
    expect(overview.shares[1]?.entry).toBeNull();
  });

  it('shares and stops sharing, saying what the backend refused', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        answer({ path: 'disk/Foto', name: 'Foto', writable: true, protected: false, entry }),
      )
      .mockResolvedValueOnce(answer(undefined, 204))
      .mockResolvedValueOnce(answer({ error: 'the folder is not shared' }, 404))
      .mockResolvedValueOnce(new Response('not json', { status: 503 }));

    const saved = await shareFolder('/disk/Foto', { writable: true, protected: false });
    expect(saved.path).toBe('/disk/Foto');
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toEqual({
      path: '/disk/Foto',
      writable: true,
      protected: false,
    });
    await unshareFolder('/disk/Foto');
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toBe('api/shares?path=%2Fdisk%2FFoto');
    await expect(unshareFolder('/disk/Foto')).rejects.toThrow('the folder is not shared');
    await expect(unshareFolder('/disk/Foto')).rejects.toThrow('Request failed: 503');
  });

  it('hands the password to the gateway and tells its answers apart', async () => {
    for (const [status, outcome] of [
      [204, 'ok'],
      [403, 'wrong'],
      [400, 'wrong'],
      [429, 'throttled'],
      [503, 'unavailable'],
      [502, 'failed'],
    ] as const) {
      vi.mocked(fetch).mockResolvedValueOnce(answer(undefined, status));
      expect(await confirmSharePassword('long enough')).toBe(outcome);
    }
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/auth/account/share-password');
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({
      method: 'PUT',
      credentials: 'same-origin',
      body: JSON.stringify({ password: 'long enough' }),
    });
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    expect(await confirmSharePassword('long enough')).toBe('failed');
  });
});
