/**
 * Unsaved dot, cases E5.8-1 to E5.8-4, against the mock. The mock
 * records every value sent to `setDocumentEdited`. Dock recents are native (Rust unit tests and
 * the real-app check). Run with WD_UI_PORT=1498.
 */
import { expect, type Page, test } from '@playwright/test';
import { editor, HOME, menu, seedMock, tabs, typeAtEnd } from '../helpers';

const A = `${HOME}/a.md`;
const B = `${HOME}/b.md`;
const FILES = { [A]: '# Alpha\n\nfirst\n', [B]: '# Beta\n\nsecond\n' };

const mock = <T>(page: Page, read: (m: NonNullable<Window['__BACKTICKLE_MOCK__']>) => T) =>
  page.evaluate(`(${read.toString()})(window.__BACKTICKLE_MOCK__)`) as Promise<T>;
const sent = (page: Page) => mock(page, (m) => m.documentEdited);

async function start(page: Page, two = false) {
  await seedMock(page, {
    files: FILES,
    launch: { openPath: A, view: 'editor' },
    settings: { openExistingIn: 'editor' },
  });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');
  await expect(editor(page)).toBeVisible();
  if (two) {
    await mock(page, (m) => m.openFiles(['/Users/mock/b.md']));
    await expect(tabs(page)).toHaveCount(2);
  }
}

test('E5.8-1 a clean document sends nothing', async ({ page }) => {
  await start(page);
  await page.waitForTimeout(300);
  expect(await sent(page)).toEqual([]);
});

test('E5.8-2 typing sets the flag once, saving clears it', async ({ page }) => {
  await start(page);
  await editor(page).click();
  await typeAtEnd(page, 'abc');
  await expect.poll(() => sent(page)).toEqual([true]);
  await menu(page, 'save');
  await expect.poll(() => sent(page)).toEqual([true, false]);
});

test('E5.8-3 the flag follows the active tab', async ({ page }) => {
  await start(page, true);
  // b.md is active and clean; edit it, then switch to a.md (clean) and back.
  await editor(page).click();
  await typeAtEnd(page, 'x');
  await expect.poll(() => sent(page)).toEqual([true]);
  await tabs(page).first().click();
  await expect.poll(() => sent(page)).toEqual([true, false]);
  await tabs(page).nth(1).click();
  await expect.poll(() => sent(page)).toEqual([true, false, true]);
});

test('E5.8-4 closing the last document clears the flag', async ({ page }) => {
  await start(page);
  await editor(page).click();
  await typeAtEnd(page, 'x');
  await expect.poll(() => sent(page)).toEqual([true]);
  await menu(page, 'save');
  await menu(page, 'close-tab');
  await expect.poll(() => sent(page)).toEqual([true, false]);
});
