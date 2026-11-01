import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { notifyNasShell, requestFolderShortcut, sendPickedFiles } from '@/services/nasShell';

let originalParent: PropertyDescriptor | undefined;
let parent: { postMessage: ReturnType<typeof vi.fn> };

function arrive(data: unknown, origin = window.location.origin) {
  const event = new MessageEvent('message', { data, origin });
  Object.defineProperty(event, 'source', { value: parent });
  window.dispatchEvent(event);
}

beforeEach(() => {
  originalParent = Object.getOwnPropertyDescriptor(window, 'parent');
  parent = { postMessage: vi.fn() };
  Object.defineProperty(window, 'parent', { configurable: true, value: parent });
});

afterEach(() => {
  if (originalParent) {
    Object.defineProperty(window, 'parent', originalParent);
  }
  vi.useRealTimers();
});

it('notifies and answers the picker of another application on the current origin', () => {
  expect(notifyNasShell('Done', 'One file', 'success')).toBe(true);
  sendPickedFiles('token', [
    { name: 'a.txt', path: '/a.txt', download: 'api/downloads?path=a.txt' },
    { name: 'docs', path: '/docs' },
  ]);
  expect(parent.postMessage.mock.calls).toEqual([
    [
      { nas: 1, type: 'notify', title: 'Done', message: 'One file', tone: 'success' },
      window.location.origin,
    ],
    [
      {
        nas: 1,
        type: 'files-picked',
        token: 'token',
        files: [
          { name: 'a.txt', path: '/a.txt', download: 'api/downloads?path=a.txt' },
          { name: 'docs', path: '/docs' },
        ],
        cancelled: false,
      },
      window.location.origin,
    ],
  ]);
});

it('resolves a shortcut only after a matching shell reply, and says why it failed', async () => {
  const added = requestFolderShortcut('/docs', 'Docs');
  const request = parent.postMessage.mock.calls[0]![0];
  expect(request).toMatchObject({ type: 'shortcut', path: '/docs', name: 'Docs' });
  arrive(
    { nas: 1, type: 'shortcut-result', requestId: request.requestId, success: true },
    'https://evil.example',
  );
  arrive({ nas: 1, type: 'shortcut-result', requestId: request.requestId, success: true });
  await expect(added).resolves.toEqual({ success: true });

  const refused = requestFolderShortcut('/docs', 'Docs');
  const second = parent.postMessage.mock.calls[1]![0];
  arrive({
    nas: 1,
    type: 'shortcut-result',
    requestId: second.requestId,
    success: false,
    error: 'Full',
  });
  await expect(refused).resolves.toEqual({ success: false, error: 'Full' });
});

it('cannot reach a launcher outside the frame', async () => {
  Object.defineProperty(window, 'parent', { configurable: true, value: window });
  expect(notifyNasShell('Done')).toBe(false);
  await expect(requestFolderShortcut('/docs', 'Docs')).resolves.toMatchObject({ success: false });
});
