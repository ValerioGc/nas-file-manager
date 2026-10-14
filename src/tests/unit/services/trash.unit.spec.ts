import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  TrashFailure,
  emptyTrash,
  listTrash,
  listTrashDisks,
  purgeFromTrash,
  readTrashSettings,
  restoreFromTrash,
  saveTrashSettings,
} from '@/services/trash';

const fetcher = vi.fn();
beforeEach(() => vi.stubGlobal('fetch', fetcher));

function answer(status: number, body: unknown) {
  return {
    ok: status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

afterEach(() => fetcher.mockReset());

it('reads and changes the trash through its routes, with the paths of the backend', async () => {
  fetcher.mockResolvedValue(answer(200, []));
  await readTrashSettings();
  await saveTrashSettings({ enabled: false, days: 7 });
  await listTrashDisks();
  await listTrash('/v-a/docs and more');
  await restoreFromTrash('/v-a/docs/a.pdf');
  await restoreFromTrash('/v-a/docs/a.pdf', true);
  fetcher.mockResolvedValue(answer(204, undefined));
  await purgeFromTrash('/v-a/docs');
  await emptyTrash();
  await emptyTrash('v-b');
  const calls = fetcher.mock.calls.map(([url, init]) => [url, init.method, init.body]);
  expect(calls).toEqual([
    ['api/trash/settings', 'GET', undefined],
    ['api/trash/settings', 'PUT', '{"enabled":false,"days":7}'],
    ['api/trash/disks', 'GET', undefined],
    ['api/trash?path=v-a%2Fdocs%20and%20more', 'GET', undefined],
    ['api/trash/restore', 'POST', '{"path":"v-a/docs/a.pdf","replace":false}'],
    ['api/trash/restore', 'POST', '{"path":"v-a/docs/a.pdf","replace":true}'],
    ['api/trash?path=v-a%2Fdocs', 'DELETE', undefined],
    ['api/trash/empty', 'POST', '{}'],
    ['api/trash/empty', 'POST', '{"disk":"v-b"}'],
  ]);
});

it('keeps the status of a refusal and its reason', async () => {
  fetcher.mockResolvedValueOnce(answer(409, { error: 'destination already exists' }));
  const refused = await restoreFromTrash('v-a/a').catch((error: unknown) => error);
  expect(refused).toBeInstanceOf(TrashFailure);
  expect(refused).toMatchObject({ status: 409, message: 'destination already exists' });
  fetcher.mockResolvedValueOnce(answer(500, undefined));
  await expect(listTrashDisks()).rejects.toThrow('Request failed: 500');
});
