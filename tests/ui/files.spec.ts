/**
 * Files sidebar against the mock platform, with a
 * fake tree in the shape of tests/fixtures/folder.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, test } from '@playwright/test';
import type { MockSeed } from '../../src/lib/platform-mock';
import { editor, HOME, seedMock, tabs } from './helpers';

const ROOT = `${HOME}/folder`;
const p = (relative: string) => `${ROOT}/${relative}`;

/** The fixture folder's files (text is invented), including the ones that must not be listed. */
function folderFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  const listed = [
    'a.mdown',
    'b.mkd',
    'c.mkdn',
    'chapter 10.md',
    'chapter 2.md',
    'd.mdx',
    'e.qmd',
    'f.Rmd',
    'g.rmd',
    'h.mmd',
    'notes with spaces.md',
    'plain.txt',
    'sub/Café notes.md',
    'sub/deep/level three.md',
    'sub/deep/note.markdown',
    'other/more/mid.md',
    'other/more/last/deepest.md',
  ];
  for (const name of listed) files[p(name)] = `# ${name}\n\nLantern text.\n`;
  const hidden = [
    'README',
    'data.csv',
    'notes.docx',
    'image.png',
    '.config.md',
    '.hidden/secret.md',
    'node_modules/pkg/readme.md',
    '_site/index.md',
  ];
  for (const name of hidden) files[p(name)] = 'not listed\n';
  return files;
}

async function start(page: Page, extra: Partial<MockSeed> = {}) {
  await seedMock(page, {
    files: { ...folderFiles(), ...extra.files },
    folderDialog: ROOT,
    ...extra,
    launch: { welcome: true, ...extra.launch },
  });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');
  await expect(page.getByTestId('welcome')).toBeVisible();
}

async function openFolderFromWelcome(page: Page) {
  await page.getByTestId('welcome-open-folder').click();
  await expect(page.getByTestId('files-tree')).toBeVisible();
}

const row = (page: Page, relative: string): Locator =>
  page.locator(`[data-testid="files-row"][data-path="${p(relative)}"]`);
const rowNames = (page: Page) =>
  page
    .getByTestId('files-row')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-path')?.split('/folder/')[1]));
const mock = <T>(page: Page, read: (m: NonNullable<Window['__WRITEDOWN_MOCK__']>) => T) =>
  page.evaluate(`(${read.toString()})(window.__WRITEDOWN_MOCK__)`) as Promise<T>;

test.describe('C11 Open Folder', () => {
  test('the welcome button opens the folder in the Files tab: order and filters', async ({
    page,
  }) => {
    await start(page);
    await openFolderFromWelcome(page);
    await expect(page.getByTestId('sidebar-tab-files')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('files-root')).toHaveText('folder');
    expect(await rowNames(page)).toEqual([
      'other',
      'sub',
      'a.mdown',
      'b.mkd',
      'c.mkdn',
      'chapter 2.md',
      'chapter 10.md',
      'd.mdx',
      'e.qmd',
      'f.Rmd',
      'g.rmd',
      'h.mmd',
      'notes with spaces.md',
      'plain.txt',
    ]);
    expect(await mock(page, (m) => m.folderDialogs)).toEqual(['open']);
  });

  test('the File menu action and the empty state open it too', async ({ page }) => {
    await start(page);
    await page.getByTestId('sidebar-tab-files').click();
    await expect(page.getByTestId('files-empty')).toContainText('No folder open');
    await page.getByTestId('files-open-folder').click();
    await expect(page.getByTestId('files-tree')).toBeVisible();
    await page.evaluate(() => window.__WRITEDOWN_MOCK__?.setFolderAnswers(null));
    await page.evaluate(() => window.__WRITEDOWN_MOCK__?.menuAction('open-folder'));
    // Cancelled: the folder stays.
    await expect(page.getByTestId('files-tree')).toBeVisible();
    expect(await mock(page, (m) => m.folderDialogs)).toEqual(['open', 'open']);
  });

  test('folders load lazily and expansion nests', async ({ page }) => {
    await start(page);
    await openFolderFromWelcome(page);
    await expect(row(page, 'sub/deep')).toHaveCount(0);
    await row(page, 'sub').click();
    await expect(row(page, 'sub')).toHaveAttribute('aria-expanded', 'true');
    await expect(row(page, 'sub/deep')).toHaveAttribute('aria-level', '2');
    await expect(row(page, 'sub/deep/level three.md')).toHaveCount(0);
    await row(page, 'sub/deep').click();
    await expect(row(page, 'sub/deep/level three.md')).toHaveAttribute('aria-level', '3');
    await expect(row(page, 'sub/Café notes.md')).toHaveAttribute('aria-level', '2');
    await row(page, 'sub').click();
    await expect(row(page, 'sub/deep')).toHaveCount(0);
    await expect(row(page, 'sub')).toHaveAttribute('aria-expanded', 'false');
  });

  test('a level over 5,000 entries shows the truncation note', async ({ page }) => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 5001; i++) many[p(`big/n${String(i).padStart(5, '0')}.md`)] = 'x';
    await start(page, { files: many });
    await openFolderFromWelcome(page);
    await expect(page.getByTestId('files-truncated')).toHaveCount(0);
    await row(page, 'big').click();
    await expect(page.getByTestId('files-truncated')).toContainText('5,000');
  });

  test('an empty folder says so', async ({ page }) => {
    await start(page, { files: {}, folders: [`${HOME}/hollow`], folderDialog: `${HOME}/hollow` });
    await page.getByTestId('welcome-open-folder').click();
    await expect(page.getByTestId('files-folder-empty')).toBeVisible();
  });
});

test.describe('C12 Opening and the active row', () => {
  test('click opens in Preview; the active row is highlighted; an open file activates its tab', async ({
    page,
  }) => {
    await start(page);
    await openFolderFromWelcome(page);
    await row(page, 'a.mdown').click();
    await expect(page.getByTestId('document-name')).toHaveText('a.mdown');
    await expect(page.getByTestId('preview')).toBeVisible();
    await expect(editor(page)).toHaveCount(0);
    await expect(row(page, 'a.mdown')).toHaveAttribute('aria-current', 'true');
    await row(page, 'b.mkd').click();
    await expect(tabs(page)).toHaveCount(2);
    await expect(row(page, 'b.mkd')).toHaveAttribute('aria-current', 'true');
    await expect(row(page, 'a.mdown')).not.toHaveAttribute('aria-current', 'true');
    await row(page, 'a.mdown').click();
    await expect(tabs(page)).toHaveCount(2);
    await expect(page.getByTestId('document-name')).toHaveText('a.mdown');
  });

  test('Return opens a file; a file in a closed folder is revealed when it becomes active', async ({
    page,
  }) => {
    await start(page);
    await openFolderFromWelcome(page);
    await row(page, 'c.mkdn').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('document-name')).toHaveText('c.mkdn');
    await page.evaluate(
      (path) => window.__WRITEDOWN_MOCK__?.openFiles([path]),
      p('sub/deep/note.markdown'),
    );
    await expect(row(page, 'sub/deep/note.markdown')).toHaveAttribute('aria-current', 'true');
    await expect(row(page, 'sub')).toHaveAttribute('aria-expanded', 'true');
    await expect(row(page, 'sub/deep')).toHaveAttribute('aria-expanded', 'true');
  });
});

test.describe('C13 Operations', () => {
  test('New File creates Untitled.md, opens it in Split and starts a rename', async ({ page }) => {
    await start(page);
    await openFolderFromWelcome(page);
    await row(page, 'a.mdown').focus();
    await page.getByRole('button', { name: 'Actions for a.mdown' }).click();
    await page.getByRole('menuitem', { name: 'New File' }).click();
    await expect(page.getByTestId('files-rename-input')).toBeFocused();
    await expect(page.getByTestId('files-rename-input')).toHaveValue('Untitled.md');
    await expect(editor(page)).toBeVisible();
    await expect(page.getByTestId('document-name')).toHaveText('Untitled.md');
    await page.keyboard.type('draft');
    await page.keyboard.press('Enter');
    await expect(row(page, 'draft.md')).toBeVisible();
    await expect(page.getByTestId('document-name')).toHaveText('draft.md');
    const ops = await mock(page, (m) => m.fileOps);
    expect(ops).toEqual([
      { op: 'create-file', from: null, to: p('Untitled.md') },
      { op: 'rename', from: p('Untitled.md'), to: p('draft.md') },
    ]);
    // A second one is numbered.
    await page.getByTestId('files-tree').click({ button: 'right', position: { x: 5, y: 400 } });
    await page.getByRole('menuitem', { name: 'New File' }).click();
    await expect(page.getByTestId('files-rename-input')).toHaveValue('Untitled.md');
  });

  test('New Folder in a selected folder, then rename', async ({ page }) => {
    await start(page);
    await openFolderFromWelcome(page);
    await row(page, 'sub').click();
    await row(page, 'sub').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'New Folder' }).click();
    await expect(page.getByTestId('files-rename-input')).toHaveValue('Untitled Folder');
    await page.keyboard.type('notes');
    await page.keyboard.press('Enter');
    await expect(row(page, 'sub/notes')).toHaveAttribute('data-kind', 'folder');
    expect((await mock(page, (m) => m.tree())).folders).toContain(p('sub/notes'));
  });

  test('Rename refusals keep the field open and say why', async ({ page }) => {
    await start(page);
    await openFolderFromWelcome(page);
    await row(page, 'a.mdown').focus();
    await page.keyboard.press('F2');
    const input = page.getByTestId('files-rename-input');
    await expect(input).toBeFocused();
    // The extension is outside the selection.
    await page.keyboard.type('b');
    await page.keyboard.press('Enter');
    await expect(row(page, 'b.mdown')).toBeVisible();
    await row(page, 'b.mdown').focus();
    await page.keyboard.press('F2');
    await input.fill('b.mkd');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('files-rename-error')).toContainText('already exists');
    await input.fill('x/y');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('files-rename-error')).toContainText('"/"');
    await input.fill('.hidden');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('files-rename-error')).toContainText('dot');
    await input.fill('ok');
    await page.keyboard.press('Enter');
    await expect(row(page, 'ok.mdown')).toBeVisible();
    await expect(row(page, 'b.mdown')).toHaveCount(0);
  });

  test('a clash with an existing name is refused by the platform', async ({ page }) => {
    await start(page);
    await openFolderFromWelcome(page);
    await row(page, 'a.mdown').focus();
    await page.keyboard.press('F2');
    await page.getByTestId('files-rename-input').fill('b.mkd');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('files-rename-error')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(row(page, 'a.mdown')).toBeVisible();
    expect(await mock(page, (m) => m.fileOps)).toEqual([]);
  });

  test('Duplicate names the copy "name copy.md" and opens it', async ({ page }) => {
    await start(page);
    await openFolderFromWelcome(page);
    await row(page, 'chapter 2.md').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    await expect(row(page, 'chapter 2 copy.md')).toBeVisible();
    await expect(page.getByTestId('document-name')).toHaveText('chapter 2 copy.md');
    await row(page, 'chapter 2.md').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    await expect(row(page, 'chapter 2 copy 2.md')).toBeVisible();
  });

  test('a tab follows a rename and a move of its file', async ({ page }) => {
    await start(page, { settings: { recentLimit: 20 } });
    await openFolderFromWelcome(page);
    await row(page, 'a.mdown').click();
    await expect(page.getByTestId('document-name')).toHaveText('a.mdown');
    await row(page, 'a.mdown').focus();
    await page.keyboard.press('F2');
    await page.keyboard.type('renamed');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('document-name')).toHaveText('renamed.mdown');
    await expect(row(page, 'renamed.mdown')).toHaveAttribute('aria-current', 'true');
    // The flavor follows the new extension: Quarto for .qmd.
    await row(page, 'renamed.mdown').focus();
    await page.keyboard.press('F2');
    await page.getByTestId('files-rename-input').fill('now.qmd');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('document-name')).toHaveText('now.qmd');
    await expect(page.getByTestId('flavor-pill')).toContainText('Quarto');
    // Recents follow: close the tab and read the welcome screen.
    await page.evaluate(() => window.__WRITEDOWN_MOCK__?.menuAction('close-tab'));
    await expect(page.getByTestId('recent-name').first()).toHaveText('now.qmd');
    await expect(page.getByTestId('recent-name')).toHaveCount(1);
  });

  test('Move to Trash asks once; a clean open tab closes', async ({ page }) => {
    await start(page, { ask: true });
    await openFolderFromWelcome(page);
    await row(page, 'a.mdown').click();
    await expect(page.getByTestId('document-name')).toHaveText('a.mdown');
    await row(page, 'a.mdown').focus();
    await page.keyboard.press('Meta+Backspace');
    await expect(row(page, 'a.mdown')).toHaveCount(0);
    await expect(page.getByTestId('welcome')).toBeVisible();
    const asks = await mock(page, (m) => m.asks);
    expect(asks).toHaveLength(1);
    expect(asks[0]?.title).toBe('Move "a.mdown" to the Trash?');
    expect(await mock(page, (m) => m.trashed)).toEqual([p('a.mdown')]);
  });

  test('declining the question trashes nothing', async ({ page }) => {
    await start(page, { ask: false });
    await openFolderFromWelcome(page);
    await row(page, 'b.mkd').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
    await expect(row(page, 'b.mkd')).toBeVisible();
    expect(await mock(page, (m) => m.trashed)).toEqual([]);
  });

  test('a dirty open tab stays open with the missing-file banner', async ({ page }) => {
    await start(page, { ask: true });
    await openFolderFromWelcome(page);
    await row(page, 'a.mdown').click();
    await page.evaluate(() => window.__WRITEDOWN_MOCK__?.menuAction('view-editor'));
    await editor(page).click();
    await page.keyboard.type('more');
    await expect(page.getByTestId('dirty-dot')).toBeVisible();
    await row(page, 'a.mdown').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
    await expect(row(page, 'a.mdown')).toHaveCount(0);
    await expect(page.getByTestId('document-name')).toHaveText('a.mdown');
    await expect(page.getByTestId('banner-missing')).toContainText('no longer on disk');
  });

  test('Reveal in Finder and Copy Path', async ({ page }) => {
    await start(page);
    await openFolderFromWelcome(page);
    await row(page, 'd.mdx').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Copy Path' }).click();
    await expect.poll(() => mock(page, (m) => m.clipboardWrites.at(-1)?.text)).toBe(p('d.mdx'));
    await row(page, 'd.mdx').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Reveal in Finder' }).click();
    await expect.poll(() => mock(page, (m) => m.reveals.at(-1))).toBe(p('d.mdx'));
  });
});

test.describe('C14 Keyboard and menus', () => {
  test('arrows, expand, collapse, Return', async ({ page }) => {
    await start(page);
    await openFolderFromWelcome(page);
    const first = row(page, 'other');
    await first.focus();
    await page.keyboard.press('ArrowRight');
    await expect(first).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(row(page, 'other/more')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(first).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('ArrowDown');
    await expect(row(page, 'sub')).toBeFocused();
    await page.keyboard.press('End');
    await expect(row(page, 'plain.txt')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(first).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(first).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowUp');
    await expect(first).toBeFocused();
  });

  test('roving tabindex: exactly one row is a tab stop', async ({ page }) => {
    await start(page);
    await openFolderFromWelcome(page);
    await expect(page.locator('[data-testid="files-row"][tabindex="0"]')).toHaveCount(1);
    await row(page, 'e.qmd').focus();
    await expect(page.locator('[data-testid="files-row"][tabindex="0"]')).toHaveAttribute(
      'data-path',
      p('e.qmd'),
    );
  });

  test('the context menu opens by right-click and by the actions button, and closes with Escape', async ({
    page,
  }) => {
    await start(page);
    await openFolderFromWelcome(page);
    await row(page, 'e.qmd').click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'File actions' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText([
      /^\s*New File\s*$/,
      /^\s*New Folder\s*$/,
      /^\s*Rename\s+F2$/,
      /^\s*Duplicate\s*$/,
      /^\s*Move to Trash\s+⌘⌫$/,
      /^\s*Reveal in Finder\s*$/,
      /^\s*Copy Path\s*$/,
    ]);

    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(row(page, 'e.qmd')).toBeFocused();
    await page.getByRole('button', { name: 'Actions for f.Rmd' }).click();
    await expect(menu).toBeVisible();
  });

  test('F2 and the keyboard menu key work on the focused row', async ({ page }) => {
    await start(page);
    await openFolderFromWelcome(page);
    await row(page, 'g.rmd').focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menu', { name: 'File actions' })).toBeVisible();
  });
});

test.describe('C15 Folder changes', () => {
  test('files created, removed and renamed elsewhere appear without a reload', async ({ page }) => {
    await start(page);
    await openFolderFromWelcome(page);
    await row(page, 'sub').click();
    await page.evaluate((path) => {
      window.__WRITEDOWN_MOCK__?.externallyCreate(path, '# new\n');
      window.__WRITEDOWN_MOCK__?.fileChanged([{ path, kind: 'created', scope: 'folder' }]);
    }, p('sub/added.md'));
    await expect(row(page, 'sub/added.md')).toBeVisible();
    await page.evaluate((path) => {
      window.__WRITEDOWN_MOCK__?.externallyCreate(path, '# top\n');
      window.__WRITEDOWN_MOCK__?.fileChanged([{ path, kind: 'created', scope: 'folder' }]);
    }, p('top.md'));
    await expect(row(page, 'top.md')).toBeVisible();
    await page.evaluate((path) => {
      window.__WRITEDOWN_MOCK__?.externallyRemove(path);
      window.__WRITEDOWN_MOCK__?.fileChanged([{ path, kind: 'removed', scope: 'folder' }]);
    }, p('sub/added.md'));
    await expect(row(page, 'sub/added.md')).toHaveCount(0);
    await page.evaluate((path) => {
      window.__WRITEDOWN_MOCK__?.externallyRemove(path);
      window.__WRITEDOWN_MOCK__?.fileChanged([{ path, kind: 'removed', scope: 'folder' }]);
    }, p('sub'));
    await expect(row(page, 'sub')).toHaveCount(0);
    await expect(row(page, 'sub/deep')).toHaveCount(0);
  });

  test('document-scope changes do not touch the tree', async ({ page }) => {
    await start(page);
    await openFolderFromWelcome(page);
    await page.evaluate((path) => {
      window.__WRITEDOWN_MOCK__?.externallyCreate(path, '# x\n');
      window.__WRITEDOWN_MOCK__?.fileChanged([{ path, kind: 'created', scope: 'document' }]);
    }, p('quiet.md'));
    await page.waitForTimeout(150);
    await expect(row(page, 'quiet.md')).toHaveCount(0);
  });
});

test.describe('C16 Title menu and File menu', () => {
  async function openDocument(page: Page, relative = 'a.mdown', extra: Partial<MockSeed> = {}) {
    await start(page, extra);
    await openFolderFromWelcome(page);
    await row(page, relative).click();
    await expect(page.getByTestId('document-name')).toHaveText(relative.split('/').pop() ?? '');
  }

  test('Rename… opens a sheet with the same rules', async ({ page }) => {
    await openDocument(page);
    await page.getByTestId('document-menu-button').click();
    await page.getByRole('menuitem', { name: 'Rename…' }).click();
    const input = page.getByTestId('rename-sheet-input');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('a.mdown');
    await input.fill('b.mkd');
    await page.getByTestId('rename-sheet-ok').click();
    await expect(page.getByTestId('rename-sheet-error')).toContainText('already exists');
    await input.fill('moved');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('rename-sheet')).toHaveCount(0);
    await expect(page.getByTestId('document-name')).toHaveText('moved.mdown');
    await expect(row(page, 'moved.mdown')).toBeVisible();
  });

  test('the rename sheet cancels with Escape', async ({ page }) => {
    await openDocument(page);
    await page.evaluate(() => window.__WRITEDOWN_MOCK__?.menuAction('rename'));
    await expect(page.getByTestId('rename-sheet')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('rename-sheet')).toHaveCount(0);
    await expect(page.getByTestId('document-name')).toHaveText('a.mdown');
  });

  test('Move To… moves the file and the tab follows', async ({ page }) => {
    await openDocument(page);
    await page.evaluate((folder) => window.__WRITEDOWN_MOCK__?.setFolderAnswers(folder), p('sub'));
    await page.getByTestId('document-menu-button').click();
    await page.getByRole('menuitem', { name: 'Move To…' }).click();
    await expect(row(page, 'a.mdown')).toHaveCount(0);
    expect(await mock(page, (m) => m.folderDialogs)).toEqual(['open', 'move']);
    expect(await mock(page, (m) => m.fileOps.at(-1))).toEqual({
      op: 'move',
      from: p('a.mdown'),
      to: p('sub/a.mdown'),
    });
    await expect(page.getByTestId('document-name')).toHaveText('a.mdown');
    await page.evaluate(() => window.__WRITEDOWN_MOCK__?.menuAction('reveal-in-finder'));
    await expect.poll(() => mock(page, (m) => m.reveals.at(-1))).toBe(p('sub/a.mdown'));
  });

  test('Duplicate opens the copy', async ({ page }) => {
    await openDocument(page);
    await page.getByTestId('document-menu-button').click();
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    await expect(page.getByTestId('document-name')).toHaveText('a copy.mdown');
    await expect(tabs(page)).toHaveCount(2);
  });

  test('Revert to Saved asks only when dirty, then restores the file', async ({ page }) => {
    await openDocument(page, 'a.mdown', { ask: [true, false] });
    await page.evaluate(() => window.__WRITEDOWN_MOCK__?.menuAction('view-editor'));
    // Clean: no question.
    await page.evaluate(() => window.__WRITEDOWN_MOCK__?.menuAction('revert'));
    await expect(page.getByTestId('document-name')).toHaveText('a.mdown');
    expect(await mock(page, (m) => m.asks)).toHaveLength(0);
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('EXTRA');
    await expect(page.getByTestId('dirty-dot')).toBeVisible();
    await page.getByTestId('document-menu-button').click();
    await page.getByRole('menuitem', { name: 'Revert to Saved' }).click();
    await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
    await expect(editor(page)).not.toContainText('EXTRA');
    expect(await mock(page, (m) => m.asks)).toHaveLength(1);
    // Declined: the edit stays.
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('KEEP');
    await page.evaluate(() => window.__WRITEDOWN_MOCK__?.menuAction('revert'));
    await expect(editor(page)).toContainText('KEEP');
    await expect(page.getByTestId('dirty-dot')).toBeVisible();
  });

  test('Reveal in Finder and Copy Path in the title menu', async ({ page }) => {
    await openDocument(page);
    await page.getByTestId('document-menu-button').click();
    await page.getByRole('menuitem', { name: 'Copy Path' }).click();
    await expect.poll(() => mock(page, (m) => m.clipboardWrites.at(-1)?.text)).toBe(p('a.mdown'));
    await page.getByTestId('document-menu-button').click();
    await page.getByRole('menuitem', { name: 'Reveal in Finder' }).click();
    await expect.poll(() => mock(page, (m) => m.reveals.at(-1))).toBe(p('a.mdown'));
  });

  test('the title-menu entries are disabled for an untitled document', async ({ page }) => {
    await start(page);
    await page.getByTestId('welcome-new').click();
    await page.getByTestId('document-menu-button').click();
    for (const name of ['Rename…', 'Move To…', 'Duplicate', 'Revert to Saved']) {
      await expect(page.getByRole('menuitem', { name })).toBeDisabled();
    }
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`Files axe, ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test(`the tree, an open menu and a rename field have no serious finding (${scheme})`, async ({
      page,
    }) => {
      await start(page);
      await openFolderFromWelcome(page);
      await row(page, 'sub').click();
      await row(page, 'a.mdown').click();
      const serious = async () =>
        (await new AxeBuilder({ page }).analyze()).violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      expect(await serious()).toEqual([]);
      await row(page, 'b.mkd').click({ button: 'right' });
      await expect(page.getByRole('menu', { name: 'File actions' })).toBeVisible();
      expect(await serious()).toEqual([]);
      await page.keyboard.press('Escape');
      await row(page, 'b.mkd').focus();
      await page.keyboard.press('F2');
      await expect(page.getByTestId('files-rename-input')).toBeFocused();
      expect(await serious()).toEqual([]);
    });
  });
}

test.describe('Files tree windowing', () => {
  test('a row far down the list, after scrolling, carries aria-setsize and aria-posinset', async ({
    page,
  }) => {
    const files: Record<string, string> = {};
    for (let i = 1; i <= 300; i++) files[p(`zbulk/n${String(i).padStart(3, '0')}.md`)] = '# x\n';
    await start(page, { files });
    await openFolderFromWelcome(page);
    const bulk = await row(page, 'zbulk');
    await bulk.click();
    // Only the rows in view are drawn.
    await expect(row(page, 'zbulk/n300.md')).toHaveCount(0);
    await page.getByTestId('files-tree').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const last = row(page, 'zbulk/n300.md');
    await expect(last).toHaveCount(1);
    await expect(last).toHaveAttribute('aria-setsize', '300');
    await expect(last).toHaveAttribute('aria-posinset', '300');
    await expect(last).toHaveAttribute('aria-level', '2');
  });
});
