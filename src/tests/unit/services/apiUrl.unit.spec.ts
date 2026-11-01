import { afterEach, expect, it, vi } from 'vitest';
import { appApiUrl } from '@/services/apiUrl';

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

it('keeps Explorer API requests inside the NAS application prefix', () => {
  window.history.replaceState({}, '', '/apps/nas-file-manager/?path=%2Fdocs');

  expect(appApiUrl('api/files?path=')).toBe('/apps/nas-file-manager/api/files?path=');
  expect(appApiUrl('api/downloads?path=docs%2Freport.pdf')).toBe(
    '/apps/nas-file-manager/api/downloads?path=docs%2Freport.pdf',
  );
});

it('keeps standalone web requests on the local application API', () => {
  expect(appApiUrl('api/files?path=')).toBe('api/files?path=');
});

it('uses the NAS API when Explorer runs in the launcher frame at a root path', () => {
  vi.stubGlobal('window', {
    location: { href: 'http://localhost:8080/', pathname: '/' },
    frameElement: { getAttribute: () => '/apps/nas-file-manager/' },
  });

  expect(appApiUrl('api/storage')).toBe('/apps/nas-file-manager/api/storage');
});

it('uses the packaged bundle location even when the page is at the root', () => {
  window.history.replaceState({}, '', '/');
  const bundle = 'http://localhost:8080/apps/nas-file-manager/assets/index-abc123.js';

  expect(appApiUrl('api/files?path=', bundle)).toBe('/apps/nas-file-manager/api/files?path=');
  expect(appApiUrl('api/storage', bundle)).toBe('/apps/nas-file-manager/api/storage');
});
