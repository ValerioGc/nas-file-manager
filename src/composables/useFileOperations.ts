import { ref } from 'vue';
import { useI18n } from '@/i18n';
import { useFavorites } from '@/composables/useFavorites';
import { validateFileName } from '@/utils/fileNameValidation';
import { isHiddenEntry } from '@/utils/fileDisplay';
import { refreshTrashUsage, useTrash } from '@/composables/useTrash';
import {
  copyEntry,
  clearPreviewCache,
  createFile as createFileEntry,
  createDirectory,
  deleteEntry,
  downloadFile,
  listDirectory,
  moveEntry,
  renameEntry,
  uploadFile,
} from '@/services/filesystem';
import type { FileEntry } from '@/types/files';
import type { ConflictDecision, FileConflict } from '@/types/conflicts';
import type { ConfirmationRequest } from '@/types/confirmation';

export type FileAction = 'copy' | 'delete' | 'download' | 'move' | 'rename' | 'hide' | 'show';
export type TransferKind = 'copy' | 'download' | 'move' | 'upload';
export type TransferState = { kind: TransferKind; label: string; progress: number };
export type ConflictResolver = (conflicts: FileConflict[]) => Promise<ConflictDecision[]>;
export type ConfirmationResolver = (request: ConfirmationRequest) => Promise<boolean>;

export function joinPath(directory: string, name: string) {
  return `${directory.replace(/\/$/, '')}/${name}`.replace(/^\//, '/');
}

export function useFileOperations(onCompleted?: () => void | Promise<void>) {
  const { t } = useI18n();
  const { settings: trash } = useTrash();
  const isMutating = ref(false);
  const transfer = ref<TransferState | null>(null);

  async function setHidden(file: FileEntry, hidden: boolean) {
    if (isHiddenEntry(file) === hidden) {
      return null;
    }
    const name = hidden ? `.${file.name}` : file.name.replace(/^\.+/, '');
    const invalid = validateFileName(name);
    if (invalid) {
      throw new Error(t.value[invalid]);
    }
    await execute(async () => {
      const renamed = await renameEntry(file.path, name);
      const { favorites } = useFavorites();
      favorites.value = favorites.value.map((entry) => {
        if (entry.path === file.path) {
          return renamed;
        }
        if (!entry.path.startsWith(`${file.path}/`)) {
          return entry;
        }
        return { ...entry, path: renamed.path + entry.path.slice(file.path.length) };
      });
    });
    return format(hidden ? t.value.fileHidden : t.value.fileShown, name);
  }

  /** Runs the direct actions; copy, move and rename go through their dialogs. */
  async function perform(
    action: 'delete' | 'download' | 'hide' | 'show',
    file: FileEntry,
    confirmOperation?: ConfirmationResolver,
  ): Promise<string | null> {
    if (action === 'hide' || action === 'show') {
      return setHidden(file, action === 'hide');
    }
    if (action === 'delete') {
      const confirmed = await askConfirmation(
        {
          title: t.value.deleteConfirmationTitle,
          message: format(
            trash.value.enabled ? t.value.confirmTrashMessage : t.value.confirmDeleteMessage,
            file.name,
          ),
          confirmLabel: trash.value.enabled ? t.value.moveToTrash : t.value.delete,
          cancelLabel: t.value.cancel,
        },
        confirmOperation,
      );
      if (!confirmed) {
        return null;
      }
      await execute(() => deleteEntry(file.path));
      await refreshTrashUsage();
      return format(trash.value.enabled ? t.value.trashed : t.value.deleted, file.name);
    }

    await track('download', `${t.value.download}: ${file.name}`, async () => {
      const download = await downloadFile(file.path);
      triggerDownload(download.blob, download.name);
    });
    return format(t.value.downloadStarted, file.name);
  }

  /** Deletes or downloads several entries. */
  async function performMany(
    action: 'delete' | 'download' | 'hide' | 'show',
    files: FileEntry[],
    confirmOperation?: ConfirmationResolver,
  ): Promise<string | null> {
    if (files.length === 0) {
      return null;
    }
    if (files.length === 1) {
      return perform(action, files[0], confirmOperation);
    }
    if (action === 'delete') {
      const confirmed = await askConfirmation(
        {
          title: t.value.deleteConfirmationTitle,
          message: format(
            trash.value.enabled
              ? t.value.confirmTrashManyMessage
              : t.value.confirmDeleteManyMessage,
            String(files.length),
            'count',
          ),
          confirmLabel: trash.value.enabled ? t.value.moveToTrash : t.value.delete,
          cancelLabel: t.value.cancel,
        },
        confirmOperation,
      );
      if (!confirmed) {
        return null;
      }
      await execute(() => Promise.all(files.map((file) => deleteEntry(file.path))));
      await refreshTrashUsage();
      return format(
        trash.value.enabled ? t.value.trashedMany : t.value.deletedMany,
        String(files.length),
        'count',
      );
    }

    for (const file of files) {
      await perform(action, file, confirmOperation);
    }
    return null;
  }

  async function transferToDestination(
    action: 'copy' | 'move',
    files: FileEntry[],
    destination: string,
    resolveConflicts?: ConflictResolver,
    confirmOperation?: ConfirmationResolver,
  ): Promise<string | null> {
    if (files.length === 0 || !destination.trim()) {
      return null;
    }
    const count = await transferEntries(
      action,
      files,
      destination,
      resolveConflicts,
      new Map(),
      confirmOperation,
    );
    if (count === 0) {
      return null;
    }
    return format(
      action === 'copy' ? t.value.copiedMany : t.value.movedMany,
      String(count),
      'count',
    );
  }

  async function transferEntries(
    action: 'copy' | 'move',
    files: FileEntry[],
    destination: string,
    resolveConflicts?: ConflictResolver,
    targetNames = new Map<string, string>(),
    confirmOperation?: ConfirmationResolver,
  ) {
    const decisions = await getConflictDecisions(files, destination, resolveConflicts, targetNames);
    const decisionMap = new Map(decisions.map((decision) => [decision.sourcePath, decision]));
    const overwriteCount = decisions.filter((decision) => decision.action === 'overwrite').length;
    if (overwriteCount > 0) {
      const confirmed = await askConfirmation(
        {
          title: t.value.overwriteConfirmationTitle,
          message: format(t.value.overwriteConfirmationMessage, String(overwriteCount), 'count'),
          confirmLabel: t.value.overwrite,
          cancelLabel: t.value.cancel,
        },
        confirmOperation,
      );
      if (!confirmed) {
        return 0;
      }
    }
    const count = await track(
      action,
      `${action === 'copy' ? t.value.copy : t.value.move}: ${files.length}`,
      async () => {
        let completed = 0;
        for (const file of files) {
          const decision = decisionMap.get(file.path);
          if (decision?.action === 'skip') {
            continue;
          }
          const targetName =
            decision?.action === 'rename'
              ? decision.name
              : (targetNames.get(file.path) ?? file.name);
          if (!targetName) {
            continue;
          }
          const target = joinPath(destination, targetName);
          if (decision?.action === 'overwrite') {
            await deleteEntry(decision.existingPath ?? target);
          }
          if (action === 'copy') {
            await copyEntry(file.path, target);
          } else {
            await moveEntry(file.path, target);
          }
          completed += 1;
        }
        return completed;
      },
    );
    return count;
  }

  async function rename(file: FileEntry, name: string): Promise<string | null> {
    if (!name || name === file.name) {
      return null;
    }
    await execute(() => renameEntry(file.path, name));
    return format(t.value.renamed, name);
  }

  /** Creates a folder with the name its window gave. */
  async function create(directory: string, name: string): Promise<string | null> {
    if (!name) {
      return null;
    }
    await execute(() => createDirectory(joinPath(directory, name)));
    return format(t.value.folderCreated, name);
  }

  /** Creates an empty file with the name its window gave. */
  async function createFile(directory: string, name: string): Promise<string | null> {
    if (!name) {
      return null;
    }
    await execute(() => createFileEntry(joinPath(directory, name)));
    return format(t.value.fileCreated, name);
  }

  async function upload(directory: string, files: FileList | File[]): Promise<string | null> {
    const list = Array.from(files);
    if (!list.length) {
      return null;
    }
    for (const file of list) {
      await track('upload', `${t.value.upload}: ${file.name}`, () =>
        uploadFile(joinPath(directory, file.name), file),
      );
    }
    return list.length === 1
      ? format(t.value.uploaded, list[0].name)
      : format(t.value.uploadedMany, String(list.length), 'count');
  }

  async function execute(operation: () => Promise<unknown>) {
    isMutating.value = true;
    try {
      await operation();
      clearPreviewCache();
      await onCompleted?.();
    } finally {
      isMutating.value = false;
    }
  }

  async function track<T>(kind: TransferKind, label: string, operation: () => Promise<T>) {
    transfer.value = { kind, label, progress: 6 };
    const timer = setInterval(() => {
      if (transfer.value && transfer.value.progress < 92) {
        transfer.value.progress += 7;
      }
    }, 180);
    try {
      const result = await operation();
      if (transfer.value) {
        transfer.value.progress = 100;
      }
      clearPreviewCache();
      await onCompleted?.();
      return result;
    } finally {
      clearInterval(timer);
      setTimeout(() => {
        transfer.value = null;
      }, 360);
    }
  }

  return {
    create,
    createFile,
    isMutating,
    perform,
    performMany,
    rename,
    transfer,
    transferToDestination,
    upload,
  };
}

async function getConflictDecisions(
  files: FileEntry[],
  destination: string,
  resolveConflicts?: ConflictResolver,
  targetNames = new Map<string, string>(),
): Promise<Array<ConflictDecision & { existingPath?: string }>> {
  if (!resolveConflicts) {
    return [];
  }
  const existingEntries = await listDirectory(destination);
  const samePathDecisions = files
    .filter((file) =>
      existingEntries.some(
        (entry) =>
          entry.name === (targetNames.get(file.path) ?? file.name) &&
          entry.path === joinPath(destination, targetNames.get(file.path) ?? file.name),
      ),
    )
    .map((file) => ({ sourcePath: file.path, action: 'skip' as const }));
  const conflicts = files
    .map((file) => {
      const existing = existingEntries.find(
        (entry) => entry.name === (targetNames.get(file.path) ?? file.name),
      );
      if (!existing || existing.path === file.path) {
        return null;
      }
      return { file, existing, destination };
    })
    .filter((conflict): conflict is FileConflict => conflict !== null);
  if (conflicts.length === 0) {
    return samePathDecisions;
  }
  const decisions = await resolveConflicts(conflicts);
  const decisionMap = new Map(decisions.map((decision) => [decision.sourcePath, decision]));
  return [
    ...samePathDecisions,
    ...conflicts.map((conflict) => {
      const decision = decisionMap.get(conflict.file.path);
      return {
        sourcePath: conflict.file.path,
        action: decision?.action ?? 'skip',
        name: decision?.name,
        existingPath: conflict.existing.path,
      };
    }),
  ];
}

/** The window of the app answers; without one nothing destructive happens. */
async function askConfirmation(request: ConfirmationRequest, resolver?: ConfirmationResolver) {
  return resolver ? resolver(request) : false;
}

function format(message: string, value: string, key = 'name') {
  return message.replace(`{${key}}`, value);
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
