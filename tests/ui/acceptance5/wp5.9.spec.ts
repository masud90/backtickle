/**
 * Close button for a single document, cases E5.9-1 to E5.9-6, against
 * the mock. A second page at `/?mockWindow=doc-1` is a window other than `main`. Run with
 * WD_UI_PORT=1499.
 */
import { expect, type Page, test } from '@playwright/test';
import type { MockSeed } from '../../../src/lib/platform-mock';
import { editor, HOME, menu, seedMock, typeAtEnd } from '../helpers';

const A = `${HOME}/a.md`;
const B = `${HOME}/b.md`;
const FILES = { [A]: '# Alpha\n\nfirst\n', [B]: '# Beta\n\nsecond\n' };

const mock = <T>(page: Page, read: (m: NonNullable<Window['__BACKTICKLE_MOCK__']>) => T) =>
  page.evaluate(`(${read.toString()})(window.__BACKTICKLE_MOCK__)`) as Promise<T>;
const tabCount = (page: Page, count: number) =>
  expect.poll(() => mock(page, (m) => m.menuStates.at(-1)?.tabCount ?? 0)).toBe(count);
const closeButton = (page: Page) => page.getByTestId('close-document-button');
const docName = (page: Page) => page.getByTestId('document-name');

async function startOne(page: Page, seed: Partial<MockSeed> = {}) {
  await seedMock(page, {
    files: FILES,
    launch: { openPath: A, view: 'editor' },
    settings: { openExistingIn: 'editor' },
    ...seed,
  });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');
  await tabCount(page, 1);
  await expect(editor(page)).toBeVisible();
}

test('E5.9-1 one document: the close button sits just before the document name', async ({
  page,
}) => {
  await startOne(page);
  const button = closeButton(page);
  await expect(button).toBeVisible();
  await expect(button).toHaveAccessibleName('Close document');
  const box = await button.boundingBox();
  const name = await docName(page).boundingBox();
  const bar = await page.getByTestId('title-bar').boundingBox();
  if (!box || !name || !bar) throw new Error('no bounding box');
  expect(box.width).toBeGreaterThanOrEqual(24);
  expect(box.height).toBeGreaterThanOrEqual(24);
  expect(box.x + box.width).toBeLessThanOrEqual(name.x);
  expect(bar.height).toBe(44);
  await expect(page.locator('[data-testid="title-bar"] [style]')).toHaveCount(0);
});

test('E5.9-2 two documents: the title-bar button is hidden and comes back at one tab', async ({
  page,
}) => {
  await startOne(page);
  await mock(page, (m) => m.openFiles(['/Users/mock/b.md']));
  await tabCount(page, 2);
  await expect(closeButton(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Close b.md' }).click();
  await tabCount(page, 1);
  await expect(closeButton(page)).toBeVisible();
});

test('E5.9-3 a click closes the document and main shows the welcome screen', async ({ page }) => {
  await startOne(page);
  await closeButton(page).click();
  await tabCount(page, 0);
  await expect(page.getByTestId('welcome')).toBeVisible();
  await expect(closeButton(page)).toHaveCount(0);
  expect(await mock(page, (m) => m.finishCloses)).toEqual([]);
});

test("E5.9-4 unsaved edits: the usual prompt; Cancel keeps the document, Don't Save closes it", async ({
  page,
}) => {
  await startOne(page, { confirmUnsaved: 'cancel' });
  await typeAtEnd(page, 'kept');
  await expect(page.getByTestId('dirty-dot')).toBeVisible();
  await closeButton(page).click();
  await page.waitForTimeout(300);
  await tabCount(page, 1);
  await expect(editor(page)).toContainText('kept');
  await mock(page, (m) => m.setAnswers({ confirmUnsaved: 'discard' }));
  await closeButton(page).click();
  await tabCount(page, 0);
  await expect(page.getByTestId('welcome')).toBeVisible();
});

test('E5.9-5 keyboard: the button takes focus and Return closes the document', async ({ page }) => {
  await startOne(page);
  await closeButton(page).focus();
  await expect(closeButton(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await tabCount(page, 0);
  await expect(page.getByTestId('welcome')).toBeVisible();
});

test('E5.9-6 a second window closes with its only document; main keeps its welcome screen', async ({
  page,
}) => {
  await startOne(page);
  await mock(page, (m) => m.openFiles(['/Users/mock/b.md']));
  await tabCount(page, 2);
  await menu(page, 'move-tab-to-new-window');
  await tabCount(page, 1);
  const other = await page.context().newPage();
  await seedMock(other, {
    files: FILES,
    launch: { welcome: true },
    settings: { openExistingIn: 'editor' },
  });
  await other.setViewportSize({ width: 1280, height: 820 });
  await other.goto('/?mockWindow=doc-1');
  await tabCount(other, 1);
  await expect(closeButton(other)).toBeVisible();
  await closeButton(other).click();
  await expect.poll(() => mock(other, (m) => m.finishCloses)).toEqual(['window']);
  expect(await mock(page, (m) => m.finishCloses)).toEqual([]);
  // Main keeps its window: its own only document still has the button, which shows the welcome screen.
  await closeButton(page).click();
  await tabCount(page, 0);
  await expect(page.getByTestId('welcome')).toBeVisible();
  expect(await mock(page, (m) => m.finishCloses)).toEqual([]);
});
