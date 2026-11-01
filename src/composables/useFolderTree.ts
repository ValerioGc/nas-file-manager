import { ref, watch, type Ref } from 'vue';
import { usePreferences } from '@/composables/usePreferences';
import { useI18n } from '@/i18n';
import { listDirectory, listVolumes } from '@/services/filesystem';
import type { FileEntry } from '@/types/files';
import type { FolderNode } from '@/types/folders';
import type { VolumeInfo, VolumeKind } from '@/types/storage';
import { filterHiddenEntries } from '@/utils/fileDisplay';
import { buildFolderTree } from '@/utils/folderTree';

/**
 * Folder tree of the sidebar and of the move dialog, with the NAS disks first and then the USB
 * drives and network shares in groups of their own. It follows the hidden files setting.
 */
export function useFolderTree(rootName: Ref<string>) {
  const { t } = useI18n();
  const { preferences } = usePreferences();
  const folderNodes = ref<FolderNode[]>([]);
  const volumes = ref<VolumeInfo[]>([]);

  async function loadFolderTree() {
    try {
      const [folders, discoveredVolumes] = await Promise.all([listDirectory(), listVolumes()]);
      volumes.value = discoveredVolumes;
      const visible = filterHiddenEntries(folders, preferences.value.showHiddenFiles);
      const idsOf = (kind: VolumeKind) =>
        new Set(
          discoveredVolumes.filter((volume) => volume.kind === kind).map((volume) => volume.id),
        );
      const belongsTo = (folder: FileEntry, ids: Set<string>) =>
        ids.has(folder.path.split('/').find(Boolean) ?? '');
      const externalIds = idsOf('external');
      const networkIds = idsOf('network');
      // The tree always has its root, empty when the NAS has no disks of its own.
      const [internalRoot] = buildFolderTree(
        visible.filter(
          (folder) => !belongsTo(folder, externalIds) && !belongsTo(folder, networkIds),
        ),
        rootName.value,
      );
      const groupRoot = (ids: Set<string>, name: string, path: string) => {
        const root = buildFolderTree(
          visible.filter((folder) => belongsTo(folder, ids)),
          name,
        )[0];
        if (!root?.children?.length) {
          return [];
        }
        root.path = path;
        root.selectable = false;
        return [root];
      };
      folderNodes.value = [
        internalRoot,
        ...groupRoot(externalIds, t.value.usbRoot, '@external'),
        ...groupRoot(networkIds, t.value.networkRoot, '@network'),
      ];
    } catch {
      folderNodes.value = [];
    }
  }

  watch(
    () => preferences.value.showHiddenFiles,
    () => {
      void loadFolderTree();
    },
  );

  return { folderNodes, volumes, loadFolderTree };
}
