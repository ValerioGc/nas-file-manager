import { ref } from 'vue';
import { readTrashSettings, saveTrashSettings } from '@/services/trash';
import type { TrashSettings } from '@/types/trash';

// The settings of the trash, the same for every view: a deletion says where it goes by them.
const settings = ref<TrashSettings>({ enabled: true, days: 30 });
const loaded = ref(false);

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

  return { settings, loaded, save };
}
