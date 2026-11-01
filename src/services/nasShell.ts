import { createNasShell, type NotificationTone, type PickerFile } from '@valeriogc/nas-base-app';
import { messageOf } from '@/utils/errors';

/** Single bridge to the launcher, including its context. */
export const shell = createNasShell();

/** Returns false when no launcher is available to show the notification. */
export function notifyNasShell(
  title: string,
  message = '',
  tone: NotificationTone = 'info',
): boolean {
  return shell.notify(title, message, tone);
}

/** Asks the launcher for a desktop shortcut to a folder. */
export async function requestFolderShortcut(
  path: string,
  name: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await shell.requestFolderShortcut(path, name);
    return { success: true };
  } catch (error) {
    return { success: false, error: messageOf(error, String(error)) };
  }
}

export function sendPickedFiles(
  token: string,
  files: { name: string; path: string; download?: string }[],
  cancelled = false,
): void {
  shell.sendPickedFiles(token, files as PickerFile[], cancelled);
}
