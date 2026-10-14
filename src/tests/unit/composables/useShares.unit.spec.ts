import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadShares, useShares } from '@/composables/useShares';
import { readShares, shareFolder, unshareFolder } from '@/services/shares';
import type { SharedFolder } from '@/types/shares';

vi.mock('@/services/shares', () => ({
  readShares: vi.fn(),
  shareFolder: vi.fn(),
  unshareFolder: vi.fn(),
}));

const entry = {
  name: 'Foto',
  path: '/disk/Foto',
  kind: 'folder' as const,
  size: null,
  modified: null,
};
const foto: SharedFolder = {
  path: '/disk/Foto',
  name: 'Foto',
  writable: false,
  protected: true,
  entry,
};

describe('useShares', () => {
  beforeEach(() => {
    vi.mocked(readShares).mockReset();
    useShares().overview.value = { available: false, user: null, shares: [] };
  });

  it('reads the shares once for every view, and none when they cannot be read', async () => {
    vi.mocked(readShares).mockResolvedValueOnce({
      available: true,
      user: 'valerio',
      shares: [foto, { ...foto, path: '/disk/Via', name: 'Via', entry: null }],
    });
    await loadShares();
    const shares = useShares();

    expect(shares.isShared('/disk/Foto')).toBe(true);
    expect(shares.isShared('/disk/Altro')).toBe(false);
    expect(shares.shareOf('/disk/Via')?.name).toBe('Via');
    expect(shares.sharedEntries.value).toEqual([entry]);
    expect(shares.hasProtected.value).toBe(true);

    vi.mocked(readShares).mockRejectedValueOnce(new Error('offline'));
    await loadShares();
    expect(useShares().overview.value).toEqual({ available: false, user: null, shares: [] });
  });

  it('keeps the list in step with a share made, changed or stopped', async () => {
    const shares = useShares();
    vi.mocked(shareFolder)
      .mockResolvedValueOnce(foto)
      .mockResolvedValueOnce({ ...foto, writable: true });
    vi.mocked(unshareFolder).mockResolvedValueOnce();

    await shares.share('/disk/Foto', { writable: false, protected: true });
    await shares.share('/disk/Foto', { writable: true, protected: true });
    expect(shares.overview.value.shares).toEqual([{ ...foto, writable: true }]);
    await shares.unshare('/disk/Foto');
    expect(shares.overview.value.shares).toEqual([]);
    expect(unshareFolder).toHaveBeenCalledWith('/disk/Foto');
  });
});
