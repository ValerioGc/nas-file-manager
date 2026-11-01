import { computed, nextTick, ref, watch, type Ref } from 'vue';
import type { DesktopNavigation, Visit } from '@/types/navigation';

const VISITS_KEPT = 50;

/**
 * History of the back button. Every change of list or folder is a visit, except the one made by
 * going back. `open` shows a visit again.
 */
export function useNavigationHistory(
  navigation: Ref<DesktopNavigation>,
  path: Ref<string>,
  name: Ref<string>,
  open: (visit: Visit) => void,
) {
  const visited = ref<Visit[]>([]);
  let here: Visit = { navigation: navigation.value, path: path.value, name: name.value };
  let returning = false;

  watch([navigation, path], ([nextNavigation, nextPath]) => {
    if (!returning) {
      visited.value = [...visited.value, here].slice(-VISITS_KEPT);
    }
    here = { navigation: nextNavigation, path: nextPath, name: name.value };
  });

  async function goBack() {
    const previous = visited.value.at(-1);
    if (!previous) {
      return;
    }
    visited.value = visited.value.slice(0, -1);
    returning = true;
    open(previous);
    await nextTick();
    returning = false;
  }

  return { canGoBack: computed(() => visited.value.length > 0), goBack };
}
