import { computed, ref } from 'vue';
import { readShares, shareFolder, unshareFolder } from '@/services/shares';
import type { ShareSettings, SharesOverview } from '@/types/shares';

// The shares of the NAS, the same for every view of the Explorer.
const overview = ref<SharesOverview>({ available: false, user: null, shares: [] });

/** Reads the shares again; a NAS where they cannot be read has none to offer. */
export async function loadShares() {
  try {
    overview.value = await readShares();
  } catch {
    overview.value = { available: false, user: null, shares: [] };
  }
}

export function useShares() {
  /** The shared folders that are there, as entries of a list. */
  const sharedEntries = computed(() =>
    overview.value.shares.flatMap((share) => (share.entry ? [share.entry] : [])),
  );

  function shareOf(path: string) {
    return overview.value.shares.find((share) => share.path === path) ?? null;
  }

  function isShared(path: string) {
    return shareOf(path) !== null;
  }

  /** Whether a protected share already has the password of the account in Samba. */
  const hasProtected = computed(() => overview.value.shares.some((share) => share.protected));

  async function share(path: string, settings: ShareSettings) {
    const saved = await shareFolder(path, settings);
    overview.value = {
      ...overview.value,
      shares: [...overview.value.shares.filter((item) => item.path !== saved.path), saved],
    };
    return saved;
  }

  async function unshare(path: string) {
    await unshareFolder(path);
    overview.value = {
      ...overview.value,
      shares: overview.value.shares.filter((item) => item.path !== path),
    };
  }

  return { overview, sharedEntries, hasProtected, shareOf, isShared, share, unshare };
}
