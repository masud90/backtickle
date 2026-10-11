/**
 * Translucent sidebar, cases E5.7-1 to E5.7-6, against the mock.
 * Headless WebKit has no window material, so the cases cover the setting, the page's own colors
 * and the rules that switch between translucent and opaque; the material itself is checked by
 * eye in the real app. Run with WD_UI_PORT=1497.
 */
import { expect, type Page, test } from '@playwright/test';
import { HOME, seedMock } from '../helpers';
import { at, openPrefs, row, settingsNow } from '../prefs-helpers';

const A = `${HOME}/a.md`;

const bg = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((el) => getComputedStyle(el).backgroundColor);

async function startMain(page: Page) {
  await seedMock(page, { files: { [A]: '# Alpha\n' }, launch: { openPath: A, view: 'editor' } });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');
  await page.getByTestId('sidebar').waitFor();
}

test('E5.7-1 the setting is in General, labelled Translucent sidebar, on by default', async ({
  page,
}) => {
  await openPrefs(page);
  await expect(row(page, 'vibrancy')).toContainText('Translucent sidebar');
  await expect(page.getByTestId('control-vibrancy')).toHaveAttribute('aria-checked', 'true');
  expect(at(await settingsNow(page), 'vibrancy')).toBe(true);
});

test('E5.7-2 switching it off is saved with Done', async ({ page }) => {
  await openPrefs(page);
  await page.getByTestId('control-vibrancy').click();
  await page.getByTestId('prefs-done').click();
  expect(at(await settingsNow(page), 'vibrancy')).toBe(false);
});

test('E5.7-3 without the real app the sidebar keeps today’s opaque color', async ({ page }) => {
  await startMain(page);
  expect(await page.evaluate(() => document.documentElement.dataset.vibrancy)).toBeUndefined();
  const color = await bg(page, 'sidebar');
  // surface-container-low at 70 percent over the canvas, as before this package.
  expect(color).not.toBe('rgba(0, 0, 0, 0)');
  expect(color).toMatch(/ 0\.7\)$/);
});

test('E5.7-4 with the material on, the sidebar is a scrim and the rest stays opaque', async ({
  page,
}) => {
  await startMain(page);
  await page.evaluate(() => {
    document.documentElement.dataset.vibrancy = 'on';
  });
  // The scrim is 40 percent opaque (light): 242, 242, 247.
  expect(await bg(page, 'sidebar')).toMatch(/^rgba\(242, 242, 247, 0\.4\)$|^color\(srgb/);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
    'rgba(0, 0, 0, 0)',
  );
  // The title bar's wrapper, the main column and the status bar paint the canvas themselves.
  const clear = await page.evaluate(() => {
    const opaque = (el: Element | null) =>
      !!el && getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)';
    return [
      opaque(document.querySelector('main')),
      opaque(document.querySelector('[data-testid="title-bar"]')?.parentElement ?? null),
      opaque(document.querySelector('footer')?.parentElement ?? null),
    ];
  });
  expect(clear).toEqual([true, true, true]);
});

test('E5.7-5 turning the data attribute off restores the opaque sidebar', async ({ page }) => {
  await startMain(page);
  const before = await bg(page, 'sidebar');
  await page.evaluate(() => {
    document.documentElement.dataset.vibrancy = 'on';
  });
  await page.evaluate(() => {
    delete document.documentElement.dataset.vibrancy;
  });
  expect(await bg(page, 'sidebar')).toBe(before);
});

test('E5.7-6 the Preferences category list takes the same scrim', async ({ page }) => {
  await openPrefs(page);
  const categories = page.getByTestId('prefs-categories');
  const before = await categories.evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.evaluate(() => {
    document.documentElement.dataset.vibrancy = 'on';
  });
  const after = await categories.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(after).not.toBe(before);
  expect(after).toMatch(/^rgba\(242, 242, 247, 0\.4\)$|^color\(srgb/);
});
