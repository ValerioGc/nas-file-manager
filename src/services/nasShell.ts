import { createNasShell, type NotificationTone, type PickerFile } from '@valeriogc/nas-base-app';

/** The one bridge of the application to the launcher, its context included. */
export const shell = createNasShell();

/** Tells whether the launcher was there to show the notification. */
export function notifyNasShell(
  title: string,
  message = '',
  tone: NotificationTone = 'info',
): boolean {
  return shell.notify(title, message, tone);
}

/** A shortcut of a folder on the desktop of the launcher, or why there is none. */
export async function requestFolderShortcut(
  path: string,
  name: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await shell.requestFolderShortcut(path, name);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Answers the picker of another application: a folder chosen has no download. */
export function sendPickedFiles(
  token: string,
  files: { name: string; path: string; download?: string }[],
  cancelled = false,
): void {
  shell.sendPickedFiles(token, files as PickerFile[], cancelled);
}
