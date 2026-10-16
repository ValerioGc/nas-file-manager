import { devices, expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('loads the fixture directory through the Axum API', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Documents', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Media', exact: true }).first()).toBeVisible();

  const response = await page.request.get('/api/files?path=Documents');
  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'report.txt' })]),
  );
});

test('requests the Explorer API through the launcher prefix inside its frame', async ({ page }) => {
  const apiPaths: string[] = [];
  await page.route('**/apps/nas-file-manager/**', async (route) => {
    const url = new URL(route.request().url());
    url.pathname = url.pathname.replace(/^\/apps\/nas-file-manager/, '');
    if (url.pathname.startsWith('/api/')) {
      apiPaths.push(new URL(route.request().url()).pathname);
    }
    await route.fulfill({ response: await page.request.fetch(url.toString()) });
  });

  await page.goto('/');
  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.id = 'launcher-explorer-test';
    frame.src = '/apps/nas-file-manager/';
    document.body.append(frame);
  });

  await expect(
    page.frameLocator('#launcher-explorer-test').getByRole('button', { name: 'Documents' }).first(),
  ).toBeVisible();
  await expect.poll(() => apiPaths).toContain('/apps/nas-file-manager/api/files');
  expect(apiPaths).toContain('/apps/nas-file-manager/api/storage');
});

test('the packaged bundle keeps API requests under Explorer even when the page path is root', async ({
  page,
}) => {
  const dist = resolve('dist/axum');
  const html = readFileSync(resolve(dist, 'index.html'), 'utf8');
  const bundle = html.match(/src="\.\/assets\/([^"]+\.js)"/)?.[1];
  const stylesheet = html.match(/href="\.\/assets\/([^"]+\.css)"/)?.[1];
  if (!bundle || !stylesheet) {
    throw new Error('Packaged Explorer bundle or stylesheet is missing');
  }
  const apiPaths: string[] = [];
  const rootApiPaths: string[] = [];

  await page.route('**/bundle-page**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<div id="app"></div><link rel="stylesheet" href="/apps/nas-file-manager/assets/${stylesheet}"><script type="module" src="/apps/nas-file-manager/assets/${bundle}"></script>`,
    }),
  );
  await page.route('**/api/**', (route) => {
    rootApiPaths.push(new URL(route.request().url()).pathname);
    return route.continue();
  });
  await page.route('**/apps/nas-file-manager/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/apps/nas-file-manager/api/')) {
      apiPaths.push(url.pathname);
      url.pathname = url.pathname.replace(/^\/apps\/nas-file-manager/, '');
      await route.fulfill({ response: await page.request.fetch(url.toString()) });
      return;
    }
    await route.fulfill({
      path: resolve(dist, url.pathname.replace('/apps/nas-file-manager/', '')),
    });
  });
  await page.route('**/api/documents/preferences', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 204 })
      : route.fulfill({ json: { preferences: {}, themeMode: 'dark' } }),
  );

  await page.goto('/bundle-page?theme=dark');
  await expect(page.getByRole('button', { name: 'Documents', exact: true }).first()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--nas-background').trim(),
    ),
  ).toBe('#172027');
  expect(
    await page
      .locator('.navigation .nav_item')
      .first()
      .evaluate((button) => getComputedStyle(button).borderTopWidth),
  ).toBe('0px');
  expect(apiPaths).toContain('/apps/nas-file-manager/api/files');
  expect(apiPaths).toContain('/apps/nas-file-manager/api/storage');
  expect(rootApiPaths).toEqual([]);

  await page.locator('.sidebar').getByRole('button', { name: 'Documents', exact: true }).click();
  const row = page.locator('.file_row').filter({ hasText: 'report.txt' });
  const treeItem = page.locator('.tree_item_button').first();
  await expect(row).toBeVisible();
  const normalRowHeight = (await row.boundingBox())!.height;
  const normalTreeHeight = (await treeItem.boundingBox())!.height;
  await row.click();
  const normalSelection = await row.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'File list' }).click();
  await page.getByTestId('settings_compact_list_switch').click();
  await page.getByTestId('settings_colored_navigation_switch').click();
  await page.locator('.settings_modal .modal_close').click();
  await expect(page.locator('.app_shell')).toHaveClass(/compact_list/);
  expect((await row.boundingBox())!.height).toBeLessThan(normalRowHeight - 10);
  expect((await treeItem.boundingBox())!.height).toBeLessThan(normalTreeHeight - 8);
  await expect
    .poll(() => row.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe(normalSelection);
  expect(await row.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe('none');
  await page.screenshot({ path: '/tmp/nas-explorer-compact-accent.png', fullPage: true });
});

test('opens a desktop folder and returns through the breadcrumb', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('searchbox', { name: 'Search' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Sort files' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New folder', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New file', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Documents', exact: true }).first().dblclick();
  await expect(page.locator('.file_row').filter({ hasText: 'report.txt' })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Sort files' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New folder', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New file', exact: true })).toBeVisible();
  await page.locator('.breadcrumbs .breadcrumb').first().click();
  await expect(page.getByRole('button', { name: 'Media', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Sort files' })).toHaveCount(0);
});

test.describe('on a phone', () => {
  // A phone: its size, a finger, and the pointer the media queries see as coarse.
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['Pixel 5'];
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

  test('opens a disk with a tap, acts on a file from its details and changes folder from the menu', async ({
    page,
  }) => {
    await page.goto('/');
    await page.locator('.computer_drive_card', { hasText: 'Documents' }).tap();
    const report = page.locator('.file_row', { hasText: 'report.txt' });
    await expect(report).toBeVisible();

    await report.locator('strong').tap();
    const details = page.locator('.file_details_modal');
    await expect(details.getByRole('button', { name: 'Rename' })).toBeVisible();
    await expect(details.getByRole('button', { name: 'Copy' })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Folders', exact: true }).tap();
    await page.locator('.sidebar').getByRole('button', { name: 'Media', exact: true }).tap();
    await expect(page.getByRole('heading', { level: 1, name: 'Media' })).toBeVisible();
    await expect(page.locator('.sidebar.open')).toHaveCount(0);
  });
});

test('opens a folder directly from the launcher location', async ({ page }) => {
  await page.goto('/?path=%2FDocuments');
  await expect(page.locator('.file_row').filter({ hasText: 'report.txt' })).toBeVisible();
});

test('provides a file selection from its NAS picker frame', async ({ page }) => {
  await page.route('**/apps/nas-file-manager/api/**', async (route) => {
    const response = await route.fetch({
      url: route.request().url().replace('/apps/nas-file-manager/', '/'),
    });
    await route.fulfill({ response });
  });
  await page.goto('/');
  await page.evaluate(() => {
    const replies: unknown[] = [];
    Object.assign(window, { pickerReplies: replies });
    window.addEventListener('message', (event) => replies.push(event.data));
    const frame = document.createElement('iframe');
    frame.id = 'file-picker-test';
    frame.src = '/apps/nas-file-manager/?nasPicker=test-token&extensions=.txt';
    Object.assign(frame.style, {
      width: '800px',
      height: '600px',
      position: 'fixed',
      inset: '0',
      zIndex: '1000',
    });
    document.body.append(frame);
  });
  const picker = page.frameLocator('#file-picker-test');
  await picker.getByRole('button', { name: 'Documents', exact: true }).click();
  await picker.getByRole('button', { name: 'report.txt', exact: true }).click();
  await page.screenshot({ path: '/tmp/explorer-picker.png' });
  await picker.getByRole('button', { name: 'Select', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const replies = (window as typeof window & { pickerReplies: unknown[] }).pickerReplies;
        return replies.find(
          (reply) =>
            typeof reply === 'object' &&
            reply !== null &&
            'type' in reply &&
            reply.type === 'files-picked',
        );
      }),
    )
    .toEqual({
      nas: 1,
      type: 'files-picked',
      token: 'test-token',
      files: [
        {
          name: 'report.txt',
          path: '/Documents/report.txt',
          download: 'api/downloads?path=Documents%2Freport.txt',
        },
      ],
      cancelled: false,
    });
  const download = await page.request.get('/api/downloads?path=Documents%2Freport.txt');
  expect(download.ok()).toBe(true);
  expect(await download.text()).toBe('Release smoke test fixture.\n');
});

test('groups the volumes of the NAS by kind, on the home page and in the tree', async ({
  page,
}) => {
  const volumes = [
    { id: 'v-data', name: 'Data', kind: 'device' },
    { id: 'v-usb', name: 'Chiavetta', kind: 'external' },
    { id: 'v-share', name: 'Condivisa', kind: 'network' },
  ];
  await page.route('**/api/volumes', (route) => route.fulfill({ json: volumes }));
  // The root of the NAS lists its volumes, as the backend does with a registry of them.
  await page.route('**/api/files?path=*', (route) => {
    const path = new URL(route.request().url()).searchParams.get('path') ?? '';
    if (path !== '' && path !== '/') {
      return route.continue();
    }
    return route.fulfill({
      json: volumes.map((volume) => ({
        name: volume.name,
        path: volume.id,
        kind: 'folder',
        size: null,
        modified: null,
      })),
    });
  });
  // Outside the NAS the page speaks English, the language of the browser of the tests.
  await page.goto('/');

  const groups = [
    ['drive_group_device', 'Disks', 'Data', 'Disk drive'],
    ['drive_group_external', 'External disks', 'Chiavetta', 'External disk'],
    ['drive_group_network', 'Network disks', 'Condivisa', 'Network disk'],
  ];
  for (const [id, title, name, label] of groups) {
    const group = page.getByTestId(id as string);
    await expect(group.getByRole('heading', { level: 2 })).toHaveText(title as string);
    await expect(group).toContainText(name as string);
    await expect(group).toContainText(label as string);
  }
  await expect(page.getByTestId('drive_group_device')).not.toContainText('Chiavetta');

  const tree = page.getByTestId('folder_tree');
  await expect(tree.getByRole('button', { name: 'USB', exact: true })).toBeVisible();
  await expect(tree.getByRole('button', { name: 'Network', exact: true })).toBeVisible();
  // A NAS that keeps the default name is just "NAS".
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('NAS');
  await expect(tree.getByRole('button', { name: 'NAS', exact: true })).toBeVisible();

  await expect(page.getByRole('complementary', { name: 'Details' })).toHaveCount(0);
  const icons = await page
    .locator('.computer_drive_icon img')
    .evaluateAll((images) => images.map((image) => (image as HTMLImageElement).src));
  expect(new Set(icons).size).toBe(3);
  await page
    .locator('.computer_drive_card')
    .first()
    .getByRole('button', { name: 'File actions' })
    .click();
  await expect(page.getByRole('menuitem')).toHaveText(['Open drive']);
  await expect(page.getByRole('searchbox', { name: 'Search' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Sort files' })).toHaveCount(0);
});

test('keeps a favorite on the backend, for every browser that opens the Explorer', async ({
  page,
  browser,
}) => {
  await page.goto('/?path=%2FDocuments');
  const row = page.locator('.file_row').filter({ hasText: 'report.txt' });
  await row.hover();
  // The answer, not the request: the backend has written the document once it has answered.
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' && response.url().endsWith('/api/documents/favorites'),
  );
  await row.getByTitle('Add to favorites').click();
  expect((await saved).ok()).toBe(true);
  const stored = await page.request.get('/api/documents/favorites');
  expect(await stored.json()).toEqual([expect.objectContaining({ name: 'report.txt' })]);

  const other = await browser.newPage();
  await other.goto('/');
  await other.locator('.navigation .nav_item').filter({ hasText: 'Favorites' }).click();
  const favorite = other.locator('.file_row').filter({ hasText: 'report.txt' });
  await expect(favorite).toBeVisible();
  await favorite.hover();
  const removed = other.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' && response.url().endsWith('/api/documents/favorites'),
  );
  await favorite.getByTitle('Remove from favorites').click();
  expect((await removed).ok()).toBe(true);
  await other.close();
  expect(await (await page.request.get('/api/documents/favorites')).json()).toEqual([]);
});

test('disables view changes for empty search results and empty favorites', async ({ page }) => {
  // Its own favorites, none: the test that saves one runs beside it.
  await page.route('**/api/documents/favorites', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 204 })
      : route.fulfill({ json: [] }),
  );
  await page.goto('/?path=%2FDocuments');
  const search = page.getByRole('searchbox', { name: 'Search' });
  const modes = page.locator('.view_switcher button');
  await expect(page.locator('.file_row').filter({ hasText: 'report.txt' })).toBeVisible();
  await expect(modes.first()).toBeEnabled();
  await expect(modes.last()).toBeEnabled();
  await search.fill('no-matching-file');
  await expect(page.locator('.file_row')).toHaveCount(0);
  await expect(modes.first()).toBeDisabled();
  await expect(modes.last()).toBeDisabled();
  await search.fill('');
  await expect(modes.first()).toBeEnabled();
  await expect(modes.last()).toBeEnabled();
  await modes.last().click();
  await expect(modes.last()).toHaveClass(/active/);
  await page.locator('.navigation .nav_item').filter({ hasText: 'Favorites' }).click();
  await expect(modes.first()).toBeDisabled();
  await expect(modes.last()).toBeDisabled();
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  await expect(
    page.locator('.navigation .nav_item').filter({ hasText: 'All files' }),
  ).toBeVisible();
  const toggle = page.getByRole('button', { name: 'Collapse sidebar', exact: true });
  await page
    .locator('.sidebar')
    .evaluate((element) => Promise.all(element.getAnimations().map((a) => a.finished)));
  expect(await toggle.evaluate((element) => getComputedStyle(element).position)).toBe('absolute');
  const aside = await page.locator('.sidebar').boundingBox();
  const navigation = await page.locator('.navigation').boundingBox();
  const control = await toggle.boundingBox();
  expect(navigation!.y - aside!.y).toBeLessThanOrEqual(16);
  expect(control!.y).toBeLessThan(navigation!.y + control!.height);
  const label = await page
    .locator('.navigation .nav_item')
    .filter({ hasText: 'All files' })
    .locator('.sidebar_label')
    .boundingBox();
  expect(label!.x + label!.width).toBeLessThan(control!.x);
  await page.mouse.move(0, 0);
  const background = await toggle.evaluate((element) => getComputedStyle(element).backgroundColor);
  const color = await toggle.evaluate((element) => getComputedStyle(element).color);
  await toggle.hover();
  expect(await toggle.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
    background,
  );
  expect(await toggle.evaluate((element) => getComputedStyle(element).color)).not.toBe(color);
  await page.screenshot({ path: '/tmp/explorer-floating-aside.png' });
});

test('goes back to the folder it left for the favorites, and shares nothing without Samba', async ({
  page,
}) => {
  await page.route('**/api/documents/favorites', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 204 })
      : route.fulfill({ json: [] }),
  );
  await page.goto('/?path=%2FDocuments');
  const report = page.locator('.file_row').filter({ hasText: 'report.txt' });
  await expect(report).toBeVisible();

  await page.getByTestId('nav_favorites').click();
  await expect(page.getByTestId('file_browser_empty')).toContainText('No favorites');
  await page.getByTestId('nav_shared').click();
  await expect(page.getByTestId('file_browser_empty')).toContainText('No shared folder');
  await page.getByTestId('nav_all-files').click();
  await expect(report).toBeVisible();

  // Without the launcher there is no Samba to share with: the menu does not offer it.
  await report.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Cut' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Share on the network' })).toHaveCount(0);
});

test('cuts a file inside the NAS and pastes it in another folder', async ({ page }) => {
  const target = 'Documents/e2e-cut-target';
  await page.request.post('/api/directories', { data: { path: target } });
  await page.request.post('/api/files', { data: { path: 'Documents/e2e-cut.txt' } });
  try {
    await page.goto('/?path=%2FDocuments');
    await page.locator('.file_row').filter({ hasText: 'e2e-cut.txt' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Cut' }).click();
    await page.locator('.file_row').filter({ hasText: 'e2e-cut-target' }).dblclick();
    await expect(page.getByTestId('file_browser_empty')).toContainText('Empty folder');

    // The empty part of the list: its own menu, with what was cut to paste.
    await page.locator('.file_browser').click({ button: 'right', position: { x: 2, y: 2 } });
    await page.getByRole('menuitem', { name: 'Paste' }).click();
    await expect(page.locator('.file_row').filter({ hasText: 'e2e-cut.txt' })).toBeVisible();
    const left = await (await page.request.get('/api/files?path=Documents')).json();
    expect(left).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'e2e-cut.txt' })]),
    );
  } finally {
    await page.request.delete(`/api/files?path=${encodeURIComponent(target)}`);
    await page.request.delete('/api/files?path=Documents%2Fe2e-cut.txt');
  }
});

test('makes a small preview of a photo that the browser keeps, and shows its room', async ({
  page,
}) => {
  // A 1x1 opaque PNG: its preview is a JPEG, never enlarged.
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC',
    'base64',
  );
  await page.request.post('/api/uploads?path=Documents%2Fe2e-pixel.png', { data: pixel });
  try {
    const preview = await page.request.get(
      '/api/previews?path=Documents%2Fe2e-pixel.png&size=small&v=1-1',
    );
    expect(preview.ok()).toBe(true);
    expect(preview.headers()['content-type']).toBe('image/jpeg');
    expect(preview.headers()['cache-control']).toBe('private, max-age=31536000, immutable');

    await page.goto('/?path=%2FDocuments');
    await expect(
      page
        .locator('.file_row')
        .filter({ hasText: 'e2e-pixel' })
        .locator('img[src*="api/previews"]'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('tab', { name: 'Previews' }).click();
    await expect(page.getByTestId('settings_preview_cache_used')).toContainText('Previews kept');
    await expect(page.getByTestId('settings_preview_cache_limit')).toHaveValue(String(2 ** 31));
  } finally {
    await page.request.delete('/api/files?path=Documents%2Fe2e-pixel.png');
  }
});

test('a deleted file goes to the trash of its disk and comes back from there', async ({ page }) => {
  await page.request.post('/api/files', { data: { path: 'Documents/e2e-trashed.txt' } });
  try {
    await page.goto('/?path=%2FDocuments');
    await page
      .locator('.file_row')
      .filter({ hasText: 'e2e-trashed.txt' })
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(page.getByRole('dialog')).toContainText('Move “e2e-trashed.txt” to the trash?');
    await page.getByRole('button', { name: 'Move to trash' }).click();
    await expect(page.locator('.file_row').filter({ hasText: 'e2e-trashed.txt' })).toHaveCount(0);

    await page.getByTestId('nav_trash').click();
    await expect(page.getByTestId('trash_view')).toContainText('Items stay here 30 days');
    await page.getByTestId('trash_entry_Documents').getByRole('button').first().click();
    await expect(page.getByTestId('trash_entry_Documents/e2e-trashed.txt')).toBeVisible();
    await page.screenshot({ path: '/tmp/nas-explorer-trash.png', fullPage: true });
    await page.getByTestId('trash_restore_Documents/e2e-trashed.txt').click();
    await expect(page.getByTestId('trash_entry_Documents/e2e-trashed.txt')).toHaveCount(0);

    await page.getByTestId('nav_all-files').click();
    await page.goto('/?path=%2FDocuments');
    await expect(page.locator('.file_row').filter({ hasText: 'e2e-trashed.txt' })).toBeVisible();
  } finally {
    await page.request.delete('/api/files?path=Documents%2Fe2e-trashed.txt');
    await page.request.post('/api/trash/empty', { data: {} });
  }
});

test('hides from the menu, filters hidden files and unhides from details without changing content', async ({
  page,
}) => {
  let preferences: unknown = { preferences: { showHiddenFiles: false } };
  await page.route('**/api/documents/preferences', async (route) => {
    if (route.request().method() === 'PUT') {
      preferences = route.request().postDataJSON();
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: preferences });
  });
  const name = 'e2e-hidden-content.txt';
  const path = `Documents/${name}`;
  const hiddenPath = `Documents/.${name}`;
  const uploaded = await page.request.post(`/api/uploads?path=${encodeURIComponent(path)}`, {
    data: Buffer.from('content to preserve'),
  });
  expect(uploaded.ok()).toBe(true);
  try {
    await page.goto('/?path=%2FDocuments');
    const row = page.locator('.file_row').filter({ hasText: name });
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Hide', exact: true }).click();
    await expect(row).toHaveCount(0);
    const hidden = await page.request.get(`/api/downloads?path=${encodeURIComponent(hiddenPath)}`);
    expect(hidden.ok()).toBe(true);
    expect(await hidden.text()).toBe('content to preserve');
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('tab', { name: 'File list' }).click();
    await page.getByTestId('settings_show_hidden_files_switch').click();
    await page.locator('.settings_modal .modal_close').click();
    await expect(row).toBeVisible();
    await row.click();
    await page.getByRole('button', { name: 'Expand details panel', exact: true }).click();
    await page
      .locator('.details_panel')
      .getByRole('button', { name: 'Unhide', exact: true })
      .click();
    await expect(row.locator('strong')).toHaveText(name);
    const visible = await page.request.get(`/api/downloads?path=${encodeURIComponent(path)}`);
    expect(await visible.text()).toBe('content to preserve');
  } finally {
    for (const candidate of [path, hiddenPath]) {
      await page.request.delete(`/api/files?path=${encodeURIComponent(candidate)}`);
      await page.request.delete(`/api/trash?path=${encodeURIComponent(candidate)}`);
    }
  }
});
