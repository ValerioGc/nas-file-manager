import { computed, ref } from 'vue';
import type { FileEntry } from '@/types/files';

export type ClipboardMode = 'copy' | 'cut';
export type FileClipboard = { files: FileEntry[]; mode: ClipboardMode };

const clipboard = ref<FileClipboard | null>(null);

export function useFileClipboard() {
  const canPaste = computed(() => Boolean(clipboard.value?.files.length));

  function copyFiles(files: FileEntry[]) {
    setClipboard(files, 'copy');
  }

  function cutFiles(files: FileEntry[]) {
    setClipboard(files, 'cut');
  }

  function clearClipboard() {
    clipboard.value = null;
  }

  function setClipboard(files: FileEntry[], mode: ClipboardMode) {
    if (files.length === 0) {
      return;
    }
    clipboard.value = { files: [...files], mode };
    // A cut stays inside the NAS: only a copy hands the paths to the system as well.
    if (mode === 'copy') {
      void writePathsToSystemClipboard(files);
    }
  }

  return { canPaste, clipboard, clearClipboard, copyFiles, cutFiles };
}

async function writePathsToSystemClipboard(files: FileEntry[]) {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return;
  }
  try {
    await navigator.clipboard.writeText(files.map((file) => file.path).join('\n'));
  } catch {
    // The in-app clipboard remains available when browser permissions deny access.
  }
}
