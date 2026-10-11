/**
 * Document state and session against the mock platform.
 * Run with WD_UI_PORT=1468.
 */
import { expect, type Page, test } from '@playwright/test';
import type { MockSeed } from '../../src/lib/platform-mock';
import { editor, HOME, menu, preview, seedMock, tabs } from './helpers';

const DOCS = `${HOME}/Documents`;
const A = `${DOCS}/a.md`;
const B = `${DOCS}/b.md`;
const C = `${DOCS}/c.md`;
const GONE = `${DOCS}/gone.md`;
const LONG = Array.from({ length: 200 }, (_, i) => `Line ${i + 1}`).join('\n\n');

const mock = <T>(page: Page, read: (m: NonNullable<Window['__WRITEDOWN_MOCK__']>) => T) =>
  page.evaluate(`(${read.toString()})(window.__WRITEDOWN_MOCK__)`) as Promise<T>;

async function start(page: Page, seed: MockSeed) {
  await seedMock(page, seed);
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');
}

const position = (page: Page) => page.getByTestId('status-position');

test.describe('C24 cursor and scroll come back', () => {
  test('after a relaunch: the stored caret and top line are restored', async ({ page }) => {
    await start(page, {
      files: { [A]: LONG },
      docState: { [A]: { flavor: null, cursor: { line: 61, column: 3 }, scrollLine: 61 } },
      launch: { openPath: A, view: 'editor' },
    });
    await expect(position(page)).toHaveText('Ln 61, Col 4');
    // Line 61 of the file is at the top of the editor.
    const top = await editor(page).evaluate((el) => {
      const rect = el.closest('.cm-editor')?.getBoundingClientRect();
      const lines = [...el.querySelectorAll('.cm-line')];
      const first = lines.find(
        (line) => line.getBoundingClientRect().bottom > (rect?.top ?? 0) + 4,
      );
      return first?.textContent ?? null;
    });
    expect(top).toBe('Line 31');
  });

  test('a line past the end is ignored', async ({ page }) => {
    await start(page, {
      files: { [A]: '# Short\n\ntext\n' },
      docState: { [A]: { flavor: null, cursor: { line: 99, column: 0 }, scrollLine: 99 } },
      launch: { openPath: A, view: 'split' },
    });
    await expect(preview(page)).toContainText('text');
    await expect(position(page)).toHaveText('Ln 1, Col 1');
  });

  test('after closing the tab and opening the file again, and on a tab switch', async ({
    page,
  }) => {
    await start(page, {
      files: { [A]: LONG, [B]: '# B\n' },
      launch: { openPath: A, view: 'editor' },
    });
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(position(page)).toHaveText('Ln 7, Col 3');

    // A tab switch stores the position of the tab that is left.
    await page.evaluate((path) => window.__WRITEDOWN_MOCK__?.openFiles([path]), B);
    await expect(page.getByTestId('document-name')).toHaveText('b.md');
    await menu(page, 'close-tab');
    await expect(page.getByTestId('document-name')).toHaveText('a.md');
    await menu(page, 'close-tab');
    await expect(page.getByTestId('welcome')).toBeVisible();

    await page.evaluate((path) => window.__WRITEDOWN_MOCK__?.openFiles([path]), A);
    await expect(page.getByTestId('document-name')).toHaveText('a.md');
    await expect(position(page)).toHaveText('Ln 7, Col 3');
  });
});

const FOLDER = `${DOCS}/proj`;
const sessionSeed = (): MockSeed => ({
  files: {
    [A]: '# A\n\nalpha text\n',
    [B]: '# B\n\nbeta text\n',
    [C]: '# C\n\ngamma text\n',
    [`${FOLDER}/sub/inner.md`]: '# Inner\n',
    [`${FOLDER}/top.md`]: '# Top\n',
  },
  folders: [FOLDER],
  session: {
    tabs: [
      { path: A, view: 'preview' },
      { path: GONE, view: 'split' },
      { path: B, view: 'editor' },
    ],
    active: 2,
    folder: FOLDER,
    sidebarTab: 'files',
    expanded: [`${FOLDER}/sub`],
  },
});

test.describe('C25 session restore', () => {
  test('tabs with their views, the active tab, the folder, the sidebar tab and expanded folders', async ({
    page,
  }) => {
    await start(page, sessionSeed());
    await expect(tabs(page)).toHaveCount(2);
    await expect(page.getByTestId('document-name')).toHaveText('b.md');
    await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
    // b.md was in the editor view, a.md in the preview view.
    await expect(editor(page)).toContainText('beta text');
    await tabs(page).nth(0).click();
    await expect(preview(page)).toContainText('alpha text');
    await expect(page.getByTestId('files-tree')).toBeVisible();
    await expect(
      page.locator(`[data-testid="files-row"][data-path="${FOLDER}/sub"]`),
    ).toHaveAttribute('aria-expanded', 'true');
    await expect(
      page.locator(`[data-testid="files-row"][data-path="${FOLDER}/sub/inner.md"]`),
    ).toBeVisible();
    await expect(page.getByTestId('error-banner')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('a file opened from Finder at launch comes after the restored tabs and is active', async ({
    page,
  }) => {
    await start(page, { ...sessionSeed(), pendingOpenFiles: [C] });
    await expect(tabs(page)).toHaveCount(3);
    await expect(page.getByTestId('tab-strip').getByTestId('tab')).toContainText([
      /a\.md/,
      /b\.md/,
      /c\.md/,
    ]);
    await expect(page.getByTestId('document-name')).toHaveText('c.md');
  });

  test('quitting stores the session; untitled documents are left out', async ({ page }) => {
    await start(page, sessionSeed());
    await expect(tabs(page)).toHaveCount(2);
    await menu(page, 'new');
    await expect(tabs(page)).toHaveCount(3);
    await tabs(page).nth(0).click();
    await page.evaluate(() => window.__WRITEDOWN_MOCK__?.closeRequested('quit'));
    // The untitled document is empty and clean, so nothing is asked.
    await expect.poll(() => mock(page, (m) => m.finishCloses)).toEqual(['quit']);
    const stored = await mock(page, (m) => m.session);
    expect(stored).toEqual({
      tabs: [
        { path: A, view: 'preview' },
        { path: B, view: 'editor' },
      ],
      active: 0,
      folder: FOLDER,
      sidebarTab: 'files',
      expanded: [`${FOLDER}/sub`],
    });
  });

  test('--open, --folder and --welcome skip the restore', async ({ page }) => {
    await start(page, { ...sessionSeed(), launch: { welcome: true } });
    await expect(page.getByTestId('welcome')).toBeVisible();
    await expect(tabs(page)).toHaveCount(0);
  });

  test('--open shows only that file', async ({ page }) => {
    await start(page, { ...sessionSeed(), launch: { openPath: C, view: 'split' } });
    await expect(page.getByTestId('document-name')).toHaveText('c.md');
    await expect(tabs(page)).toHaveCount(0); // a single tab shows no strip
    await expect(page.getByTestId('banner-missing')).toHaveCount(0);
  });

  test('restoreSession: false in the settings skips the restore', async ({ page }) => {
    await start(page, { ...sessionSeed(), settings: { restoreSession: false } });
    await expect(page.getByTestId('welcome')).toBeVisible();
    await expect(tabs(page)).toHaveCount(0);
  });
});
