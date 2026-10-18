/**
 * Move Tab to New Window, cases E5.1-1 to E5.1-8, against the mock.
 * The mock models a window as a page: a second page opened at `/?mockWindow=doc-1` is the window
 * the tab moved to. Run with WD_UI_PORT=1491.
 */
import { expect, type Page, test } from '@playwright/test';
import type { MockSeed } from '../../../src/lib/platform-mock';
import { editor, HOME, menu, seedMock } from '../helpers';

const A = `${HOME}/a.md`;
const B = `${HOME}/b.md`;
const FILES = { [A]: '# Alpha\n\nfirst\n', [B]: '# Beta\n\nsecond\n' };

/** The number of tabs the window reports to the menu (a single tab has no tab strip). */
const tabCount = (page: Page, count: number) =>
  expect.poll(() => mock(page, (m) => m.menuStates.at(-1)?.tabCount ?? 0)).toBe(count);
const docName = (page: Page) => page.getByTestId('document-name');
const dirtyDot = (page: Page) => page.getByTestId('dirty-dot');

const mock = <T>(page: Page, read: (m: NonNullable<Window['__BACKTICKLE_MOCK__']>) => T) =>
  page.evaluate(`(${read.toString()})(window.__BACKTICKLE_MOCK__)`) as Promise<T>;

async function startMain(page: Page, seed: Partial<MockSeed> = {}) {
  await seedMock(page, {
    files: FILES,
    launch: { openPath: A, view: 'editor' },
    settings: { openExistingIn: 'editor' },
    ...seed,
  });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');
  await tabCount(page, 1);
  await mock(page, (m) => m.openFiles(['/Users/mock/b.md']));
  await tabCount(page, 2);
}

/** The window the tab moved to: a page of the same context at `?mockWindow=<label>`. */
async function openWindow(page: Page, label: string): Promise<Page> {
  const other = await page.context().newPage();
  await seedMock(other, {
    files: FILES,
    launch: { welcome: true },
    settings: { openExistingIn: 'editor' },
  });
  await other.setViewportSize({ width: 1280, height: 820 });
  await other.goto(`/?mockWindow=${label}`);
  return other;
}

test('E5.1-1 the command moves the active tab out of this window', async ({ page }) => {
  await startMain(page);
  await menu(page, 'move-tab-to-new-window');
  await tabCount(page, 1);
  await expect(docName(page)).toContainText('a.md');
  const moved = await mock(page, (m) => m.movedTabs.map((t) => [t.label, t.transfer.path]));
  expect(moved).toEqual([['doc-1', B]]);
});

test('E5.1-2 with one tab the command does nothing', async ({ page }) => {
  await seedMock(page, { files: FILES, launch: { openPath: A, view: 'editor' } });
  await page.goto('/');
  await tabCount(page, 1);
  await menu(page, 'move-tab-to-new-window');
  expect(await mock(page, (m) => m.movedTabs.length)).toBe(0);
  await tabCount(page, 1);
});

test('E5.1-3 the new window shows the tab, and unsaved edits and undo history come along', async ({
  page,
}) => {
  await startMain(page);
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('EXTRA');
  await expect(dirtyDot(page)).toBeVisible();
  await menu(page, 'move-tab-to-new-window');
  const other = await openWindow(page, 'doc-1');
  await tabCount(other, 1);
  await expect(docName(other)).toContainText('b.md');
  await expect(editor(other)).toContainText('EXTRA');
  await expect(dirtyDot(other)).toBeVisible();
  await editor(other).click();
  await other.keyboard.press('ControlOrMeta+z');
  await expect(editor(other)).not.toContainText('EXTRA');
  await expect(dirtyDot(other)).toHaveCount(0);
});

test('E5.1-4 a file open in another window is not opened twice', async ({ page }) => {
  await startMain(page);
  await menu(page, 'move-tab-to-new-window');
  await mock(page, (m) => m.openFiles(['/Users/mock/b.md']));
  await expect.poll(() => mock(page, (m) => m.focusedElsewhere)).toEqual([B]);
  await tabCount(page, 1);
});

test('E5.1-5 the other window is asked to show the file it holds', async ({ page }) => {
  await startMain(page);
  await menu(page, 'move-tab-to-new-window');
  const other = await openWindow(page, 'doc-1');
  await tabCount(other, 1);
  await mock(page, (m) => m.openFiles(['/Users/mock/b.md']));
  await tabCount(other, 1);
  await expect(docName(other)).toContainText('b.md');
  expect(await mock(other, (m) => m.windowLabel)).toBe('doc-1');
});

test('E5.1-6 closing the last tab of a moved window closes the window; main shows the welcome screen', async ({
  page,
}) => {
  await startMain(page);
  await menu(page, 'move-tab-to-new-window');
  const other = await openWindow(page, 'doc-1');
  await tabCount(other, 1);
  await menu(other, 'close-tab');
  await expect.poll(() => mock(other, (m) => m.finishCloses)).toEqual(['window']);
  // Main keeps its window with no tab: the welcome screen.
  await menu(page, 'close-tab');
  await tabCount(page, 0);
  expect(await mock(page, (m) => m.finishCloses)).toEqual([]);
});

test('E5.1-7 the tab context menu offers Move Tab to New Window', async ({ page }) => {
  await startMain(page);
  await page.getByTestId('tab-strip').getByRole('tab').first().click({ button: 'right' });
  const entry = page.getByTestId('tab-menu-move');
  await expect(entry).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tab-menu')).toHaveCount(0);
  await page.getByTestId('tab-strip').getByRole('tab').first().click({ button: 'right' });
  await page.getByTestId('tab-menu-move').click();
  await tabCount(page, 1);
});

test('E5.1-8 a window restored from the session starts with its tabs', async ({ page }) => {
  await seedMock(page, {
    files: FILES,
    session: {
      tabs: [{ path: A, view: 'preview' }],
      active: 0,
      folder: null,
      sidebarTab: 'outline',
      windows: [{ tabs: [{ path: B, view: 'preview' }], active: 0 }],
    },
  });
  await page.goto('/');
  await tabCount(page, 1);
  await expect.poll(() => mock(page, (m) => m.restoredWindows)).toEqual([['doc-1']]);
  const other = await page.context().newPage();
  await seedMock(other, {
    files: FILES,
    launch: { welcome: true },
    session: {
      tabs: [{ path: A, view: 'preview' }],
      active: 0,
      folder: null,
      sidebarTab: 'outline',
      windows: [{ tabs: [{ path: B, view: 'preview' }], active: 0 }],
    },
  });
  await other.goto('/?mockWindow=doc-1');
  await tabCount(other, 1);
  await expect(docName(other)).toContainText('b.md');
});
