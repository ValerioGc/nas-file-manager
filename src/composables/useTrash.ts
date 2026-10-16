import { computed, ref } from 'vue';
import { listTrashDisks, readTrashSettings, saveTrashSettings } from '@/services/trash';
import type { TrashDisk, TrashSettings } from '@/types/trash';

// The settings of the trash, the same for every view: a deletion says where it goes by them.
const settings = ref<TrashSettings>({ enabled: true, days: 30 });
const loaded = ref(false);
const disks = ref<TrashDisk[]>([]);
const usageLoaded = ref(false);
const items = computed(() => disks.value.reduce((sum, disk) => sum + disk.items, 0));
const bytes = computed(() => disks.value.reduce((sum, disk) => sum + disk.bytes, 0));

export async function refreshTrashUsage() {
  try {
    disks.value = await listTrashDisks();
    usageLoaded.value = true;
  } catch {
    // A transient error must not hide the files already found.
    usageLoaded.value = false;
  }
}

/** Reads the settings again; a NAS that cannot say keeps the defaults. */
export async function loadTrashSettings() {
  try {
    settings.value = await readTrashSettings();
    loaded.value = true;
  } catch {
    loaded.value = false;
  }
}

export function useTrash() {
  async function save(change: Partial<TrashSettings>) {
    settings.value = await saveTrashSettings({ ...settings.value, ...change });
  }

  return { settings, loaded, save, disks, items, bytes, usageLoaded };
}
