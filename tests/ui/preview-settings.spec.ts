/**
 * Preview settings. Run with WD_UI_PORT=1483.
 */
import { expect, test } from '@playwright/test';
import { preview, seedMock } from './helpers';

const ROOT = '/Users/mock/Vault';

async function change(page: import('@playwright/test').Page, patch: object) {
  await page.evaluate(
    (value) => window.__BACKTICKLE_MOCK__?.settingsChanged(value as never),
    patch,
  );
}

test('D17: detection off, a .md file in a vault is the default flavor; .qmd stays Quarto', async ({
  page,
}) => {
  await seedMock(page, {
    files: { [`${ROOT}/a.md`]: '# A\n', [`${ROOT}/b.qmd`]: '# B\n' },
    vault: { root: ROOT },
    vaults: [ROOT],
    launch: { openPath: `${ROOT}/a.md`, view: 'split' },
  });
  await page.goto('/');
  await expect(page.getByTestId('flavor-pill')).toContainText('Obsidian');
  await expect(page.getByTestId('flavor-auto')).toBeVisible();
  await change(page, { preview: { autoDetectFlavor: false } });
  await expect(page.getByTestId('flavor-pill')).toContainText('GFM');
  await expect(page.getByTestId('flavor-auto')).toHaveCount(0);
});

test('D18, D21: font, size, width and light code cards change computed styles', async ({
  page,
}) => {
  await seedMock(page, {
    files: { '/Users/mock/a.md': '# Title\n\nBody text.\n\n```js\nconst x = 1;\n```\n' },
    launch: { openPath: '/Users/mock/a.md', view: 'split' },
  });
  await page.goto('/');
  const body = preview(page).locator('p').first();
  await expect(body).toHaveText('Body text.');
  const before = await body.evaluate((el) => getComputedStyle(el).fontSize);
  expect(before).toBe('15px');
  await change(page, {
    preview: { fontSize: 20, columnWidth: 880, font: 'system', codeCards: 'light' },
  });
  await expect.poll(() => body.evaluate((el) => getComputedStyle(el).fontSize)).toBe('20px');
  expect(await body.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('apple-system');
  expect(await preview(page).evaluate((el) => getComputedStyle(el).maxWidth)).toBe('880px');
  await change(page, { view: { zoom: 1.5 } });
  await expect.poll(() => body.evaluate((el) => getComputedStyle(el).fontSize)).toBe('30px');
  const card = preview(page).locator('.code-card').first();
  expect(await card.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    'rgb(246, 248, 250)',
  );
});

test('D19: hashtag pills and math off', async ({ page }) => {
  await seedMock(page, {
    files: { '/Users/mock/a.md': 'A #tag and $x+1$ here.\n' },
    launch: { openPath: '/Users/mock/a.md', view: 'split' },
  });
  await page.goto('/');
  await expect(preview(page).locator('.math')).toHaveCount(1);
  await expect(preview(page).locator('span.tag')).toHaveCount(0);
  await change(page, { preview: { hashtagPills: true, math: false } });
  await expect(preview(page).locator('span.tag')).toHaveText('#tag');
  await expect(preview(page).locator('.math')).toHaveCount(0);
  await expect(preview(page)).toContainText('$x+1$');
});

test('D20: remote images off make no request and show placeholders', async ({ page }) => {
  const requested: string[] = [];
  await page.route('https://img.example.test/**', (route) => {
    requested.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'image/gif',
      body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
    });
  });
  await seedMock(page, {
    files: {
      '/Users/mock/a.md':
        '![one](https://img.example.test/1.png)\n\n![two](https://img.example.test/2.png)\n\n![three](https://img.example.test/3.png)\n',
    },
    settings: { preview: { remoteImages: false } },
    launch: { openPath: '/Users/mock/a.md', view: 'split' },
  });
  await page.goto('/');
  const holders = preview(page).locator('.wd-image-remote-off');
  await expect(holders).toHaveCount(3);
  await expect(holders.first()).toContainText('one');
  await expect(holders.first()).toContainText('img.example.test');
  await page.waitForTimeout(500);
  expect(requested).toEqual([]);
  await change(page, { preview: { remoteImages: true } });
  await expect(preview(page).locator('.wd-image-remote-off')).toHaveCount(0);
  await expect(preview(page).locator('img')).toHaveCount(3);
});

test('D22: a render option change renders once and keeps the scroll position', async ({ page }) => {
  const lines = Array.from({ length: 300 }, (_, i) => `Line ${i} #t${i}\n`).join('\n');
  await seedMock(page, {
    files: { '/Users/mock/a.md': lines },
    launch: { openPath: '/Users/mock/a.md', view: 'preview' },
  });
  await page.goto('/');
  await expect(preview(page).locator('p').first()).toBeVisible();
  const scroller = page.getByTestId('preview-scroll');
  await scroller.evaluate((el) => {
    el.scrollTop = 2000;
  });
  const top = await scroller.evaluate((el) => el.scrollTop);
  await change(page, { preview: { hashtagPills: true } });
  await expect(preview(page).locator('span.tag').first()).toBeVisible();
  const after = await scroller.evaluate((el) => el.scrollTop);
  expect(Math.abs(after - top)).toBeLessThan(40);
});
