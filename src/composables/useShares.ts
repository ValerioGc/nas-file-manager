import { computed, ref } from 'vue';
import { readShares, shareFolder, unshareFolder } from '@/services/shares';
import type { ShareSettings, SharesOverview } from '@/types/shares';

const overview = ref<SharesOverview>({ available: false, user: null, shares: [] });

export async function loadShares() {
  try {
    overview.value = await readShares();
  } catch {
    overview.value = { available: false, user: null, shares: [] };
  }
}

export function useShares() {
  const sharedEntries = computed(() =>
    overview.value.shares.flatMap((share) => (share.entry ? [share.entry] : [])),
  );

  function shareOf(path: string) {
    return overview.value.shares.find((share) => share.path === path) ?? null;
  }

  function isShared(path: string) {
    return shareOf(path) !== null;
  }

  /** True when Samba already holds the account password from a protected share. */
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
