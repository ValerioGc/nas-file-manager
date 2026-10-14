import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDirectory,
  copyEntry,
  clearPreviewCache,
  createFile,
  deleteEntry,
  downloadFile,
  formatModified,
  getStorageInfo,
  emptyPreviewCache,
  getVideoFramePreview,
  previewCacheUsage,
  previewUrl,
  setPreviewCacheLimit,
  listDirectory,
  listArchive,
  listVolumes,
  moveEntry,
  renameEntry,
  searchFilesystem,
  uploadFile,
} from '@/services/filesystem';

describe('filesystem service', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/');
    clearPreviewCache();
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal(
      'URL',
      Object.assign(class extends URL {}, {
        createObjectURL: vi.fn(() => 'blob:preview'),
        revokeObjectURL: vi.fn(),
      }),
    );
    vi.unstubAllEnvs();
  });

  it('uses the web API and maps backend paths to UI paths', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify([
          { name: 'a.txt', path: 'docs/a.txt', kind: 'file', size: 1, modified: 10 },
        ]),
      ),
    );

    await expect(listDirectory('/docs')).resolves.toMatchObject([{ path: '/docs/a.txt' }]);
    expect(fetch).toHaveBeenCalledWith('api/files?path=docs', expect.any(Object));
  });

  it('routes NAS file and storage requests through the Explorer application', async () => {
    window.history.replaceState({}, '', '/apps/nas-file-manager/');
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify([])))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ availableBytes: 40, totalBytes: 100, usedBytes: 60 })),
      );

    await listDirectory('/');
    await getStorageInfo();

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/apps/nas-file-manager/api/files?path=',
      expect.any(Object),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/apps/nas-file-manager/api/storage',
      expect.any(Object),
    );
  });

  it('routes file, volume and storage requests through Explorer when framed at root', async () => {
    vi.stubGlobal('window', {
      location: { href: 'http://localhost:8080/', pathname: '/' },
      frameElement: { getAttribute: () => '/apps/nas-file-manager/' },
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify([])))
      .mockResolvedValueOnce(new Response(JSON.stringify([])))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ availableBytes: 40, totalBytes: 100, usedBytes: 60 })),
      );

    await listDirectory('/');
    await listVolumes();
    await getStorageInfo();

    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      '/apps/nas-file-manager/api/files?path=',
      '/apps/nas-file-manager/api/volumes',
      '/apps/nas-file-manager/api/storage',
    ]);
  });

  it('loads volume metadata from the web API', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify([{ id: 'v-a', name: 'Data', kind: 'device' }])),
    );

    await expect(listVolumes()).resolves.toEqual([{ id: 'v-a', name: 'Data', kind: 'device' }]);
    expect(fetch).toHaveBeenCalledWith('api/volumes', expect.any(Object));
  });

  it('opens an archive through the web API without losing the password', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify([{ name: 'notes.txt', path: 'notes.txt', kind: 'document', size: 4 }]),
      ),
    );

    await expect(listArchive('/backups/archive.zip', 'P@ss word! €')).resolves.toMatchObject([
      { path: '/notes.txt', kind: 'document' },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      'api/archives/list',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          path: 'backups/archive.zip',
          password: 'P@ss word! €',
        }),
      }),
    );
  });

  it('loads real storage information from the web API', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ availableBytes: 40, totalBytes: 100, usedBytes: 60 })),
    );

    await expect(getStorageInfo()).resolves.toEqual({
      availableBytes: 40,
      totalBytes: 100,
      usedBytes: 60,
    });
    expect(fetch).toHaveBeenCalledWith('api/storage', expect.any(Object));
  });

  it('sends mutations and reports failed requests', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ name: 'new', path: 'new', kind: 'folder', size: null, modified: 1 }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response('forbidden', { status: 403 }));

    await expect(createDirectory('/new')).resolves.toMatchObject({ path: '/new' });
    await expect(deleteEntry('/new')).resolves.toBeUndefined();
    await expect(searchFilesystem('new')).rejects.toThrow('forbidden');
    expect(formatModified(0)).toBe('-');
    expect(formatModified(10)).not.toBe('-');
    expect(formatModified('today')).toBe('today');
  });

  it('keeps video preview loading compatible with binary web responses', async () => {
    const video = {
      load: vi.fn(() => queueMicrotask(() => video.onloadeddata?.(new Event('loadeddata')))),
      muted: false,
      onerror: null as ((event: Event) => void) | null,
      onloadeddata: null as ((event: Event) => void) | null,
      playsInline: false,
      preload: '',
      removeAttribute: vi.fn(),
      src: '',
      videoHeight: 180,
      videoWidth: 320,
    } as unknown as HTMLVideoElement;
    const canvas = {
      getContext: vi.fn(() => ({ drawImage: vi.fn() })),
      height: 0,
      toBlob: vi.fn((callback: BlobCallback) => callback(new Blob(['frame']))),
      width: 0,
    } as unknown as HTMLCanvasElement;
    vi.stubGlobal('document', {
      createElement: vi.fn((tagName: string) => {
        if (tagName === 'video') {
          return video;
        }
        if (tagName === 'canvas') {
          return canvas;
        }
        return {};
      }),
    });
    vi.mocked(fetch).mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));

    await expect(
      getVideoFramePreview({ name: 'clip.mp4', path: '/clip.mp4', modified: null }),
    ).resolves.toMatchObject({
      mimeType: 'image/jpeg',
    });
    expect(URL.createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'video/mp4' }),
    );
  });

  it('uploads and downloads through the web API', async () => {
    const file = { arrayBuffer: vi.fn(async () => new ArrayBuffer(3)) } as unknown as File;
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            name: 'upload.txt',
            path: 'upload.txt',
            kind: 'file',
            size: 3,
            modified: 1,
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response('downloaded'));

    await expect(uploadFile('/upload.txt', file)).resolves.toMatchObject({ path: '/upload.txt' });
    await expect(downloadFile('/upload.txt')).resolves.toMatchObject({ name: 'upload.txt' });
    expect(fetch).toHaveBeenCalledWith('api/uploads?path=upload.txt', {
      method: 'POST',
      body: file,
    });
    expect(fetch).toHaveBeenCalledWith('api/downloads?path=upload.txt');
  });

  it('uses fallback messages and names for failed and root-level web requests', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response('root file'));

    await expect(searchFilesystem('broken')).rejects.toThrow('Request failed: 500');
    await expect(
      uploadFile('/broken.txt', { arrayBuffer: vi.fn() } as unknown as File),
    ).rejects.toThrow('Upload failed: 500');
    await expect(downloadFile('/')).resolves.toMatchObject({ name: 'download' });
  });

  it('handles remaining web mutations and root paths', async () => {
    const entry = { name: 'item.txt', path: '', kind: 'file', size: 0, modified: null };
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify([entry])))
      .mockImplementation(async () => new Response(JSON.stringify(entry)));

    await expect(listDirectory()).resolves.toMatchObject([{ path: '/' }]);
    await expect(createFile('/item.txt')).resolves.toMatchObject({ path: '/' });
    await expect(renameEntry('/item.txt', 'renamed.txt')).resolves.toMatchObject({ path: '/' });
    await expect(copyEntry('/item.txt', '/copy.txt')).resolves.toMatchObject({ path: '/' });
    await expect(moveEntry('/item.txt', '/moved.txt')).resolves.toMatchObject({ path: '/' });
  });

  it('reports a failed web download without a response body', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
    await expect(downloadFile('/missing.txt')).rejects.toThrow('Download failed: 503');
  });

  function stubVideo({
    context = { drawImage: vi.fn() } as object | null,
    frame = new Blob(['frame']) as Blob | null,
    decodes = true,
  } = {}) {
    const video = {
      load: vi.fn(() =>
        queueMicrotask(() =>
          decodes
            ? video.onloadeddata?.(new Event('loadeddata'))
            : video.onerror?.(new Event('error')),
        ),
      ),
      onerror: null as ((event: Event) => void) | null,
      onloadeddata: null as ((event: Event) => void) | null,
      removeAttribute: vi.fn(),
      videoHeight: 0,
      videoWidth: 0,
    };
    const canvas = {
      getContext: vi.fn(() => context),
      toBlob: vi.fn((callback: BlobCallback) => callback(frame)),
    };
    vi.stubGlobal('document', {
      createElement: vi.fn((tagName: string) => (tagName === 'video' ? video : canvas)),
    });
    return { video, canvas };
  }

  it('shares and caches video frames, keeping the type of video blobs', async () => {
    const { canvas } = stubVideo();
    vi.mocked(fetch).mockImplementation(
      async () =>
        ({
          ok: true,
          status: 200,
          blob: async () => new Blob(['v'], { type: 'video/webm' }),
        }) as Response,
    );
    const clip = { name: 'clip.webm', path: '/clip.webm', modified: 2 };

    const [first, second] = await Promise.all([
      getVideoFramePreview(clip),
      getVideoFramePreview(clip),
    ]);
    expect(first).toBe(second);
    await expect(getVideoFramePreview(clip)).resolves.toBe(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'video/webm' }),
    );
    expect(canvas).toMatchObject({ width: 640, height: 400 });
    await getVideoFramePreview({ name: 'clip', path: '/clip', modified: null });
    expect(URL.createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'video/webm' }),
    );
  });

  it('names a preview after its file, so the browser keeps it until the file changes', () => {
    expect(previewUrl({ path: '/docs/photo.jpg', modified: 5, size: 900 }, 'small')).toBe(
      'api/previews?path=docs%2Fphoto.jpg&size=small&v=5-900',
    );
    expect(previewUrl({ path: '/raw', modified: null, size: null }, 'large')).toBe(
      'api/previews?path=raw&size=large&v=-',
    );
  });

  it('reads, limits and empties the room of the previews on the NAS', async () => {
    const usage = { usedBytes: 10, limitBytes: 2048 };
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify(usage)));

    await expect(previewCacheUsage()).resolves.toEqual(usage);
    await expect(setPreviewCacheLimit(2048)).resolves.toEqual(usage);
    await expect(emptyPreviewCache()).resolves.toEqual(usage);
    expect(vi.mocked(fetch).mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ['api/previews/cache', undefined],
      ['api/previews/cache', 'PUT'],
      ['api/previews/cache', 'DELETE'],
    ]);
    expect(vi.mocked(fetch).mock.calls[1]?.[1]?.body).toBe('{"limitBytes":2048}');
  });

  it('keeps the frames of the last videos only, letting the older go', async () => {
    stubVideo();
    vi.mocked(fetch).mockImplementation(async () => new Response(new Blob(['v'])));
    for (let index = 0; index <= 60; index += 1) {
      await getVideoFramePreview({ name: `${index}.mp4`, path: `/${index}.mp4`, modified: 1 });
    }
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    clearPreviewCache();
  });

  it('reports video frames that cannot be decoded, drawn or encoded', async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response(new Blob(['data'])));

    stubVideo({ decodes: false });
    await expect(
      getVideoFramePreview({ name: 'a.mkv', path: '/a.mkv', modified: null }),
    ).rejects.toThrow('Video preview could not be decoded');
    stubVideo({ context: null });
    await expect(
      getVideoFramePreview({ name: 'b.unknown', path: '/b.unknown', modified: null }),
    ).rejects.toThrow('Video preview canvas is unavailable');
    const { video } = stubVideo({ frame: null });
    await expect(
      getVideoFramePreview({ name: 'noextension', path: '/noextension', modified: null }),
    ).rejects.toThrow('Video preview could not be rendered');
    expect(video.removeAttribute).toHaveBeenCalledWith('src');
    expect(URL.createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'application/octet-stream' }),
    );
  });
});
