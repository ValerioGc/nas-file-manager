import { notifyNasShell } from '@/services/nasShell';

/** Reports a success through the launcher, or with `show` in the page without it. */
export function reportSuccess(message: string, show: (message: string) => void) {
  if (!notifyNasShell(message, '', 'success')) {
    show(message);
  }
}
