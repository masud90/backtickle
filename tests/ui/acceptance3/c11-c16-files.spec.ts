/**
 * Phase 3 acceptance C11 to C16 (Files sidebar), on the mock platform
 * with the files of tests/fixtures/folder as the fake tree. Expected rows come from the fixture
 * README and the rules of 2.3, not from the app.
 */
import { type Locator, type Page, test } from '@playwright/test';
import {
  editor,
  expect,
  FOLDER,
  folderSeed,
  HOME,
  inFolder,
  launch,
  menu,
  mock,
  setView,
} from './support';

async function start(page: Page, seed: Record<string, unknown> = {}) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await launch(page, {
    seed: {
      files: folderSeed(),
      folderDialog: FOLDER,
      launch: { welcome: true },
      ...seed,
    },
  });
}

async function openFromWelcome(page: Page) {
  await page.getByTestId('welcome-open-folder').click();
  await expect(page.getByTestId('files-tree')).toBeVisible();
}

const row = (page: Page, relative: string): Locator =>
  page.locator(`[data-testid="files-row"][data-path="${inFolder(relative)}"]`);
const visibleRows = (page: Page) =>
  page
    .getByTestId('files-row')
    .evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-path') ?? '').split('/folder/')[1]),
    );
const tabs = (page: Page) => page.getByTestId('tab-strip').getByRole('tab');
const docName = (page: Page) => page.getByTestId('document-name');

// binary.md is listed: 2.3 filters by name (Markdown family), only the search skips binary content.
// (The fixture README puts it under "Not listed"; the spec's rule decides.)
const TOP_LEVEL = [
  'other',
  'sub',
  'a.mdown',
  'b.mkd',
  'binary.md',
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
];

test.describe('C11 Open Folder', () => {
  test('C11 the welcome button shows the Files tab with the folder in natural order', async ({
    page,
  }) => {
    await start(page);
    await openFromWelcome(page);
    await expect(page.getByTestId('sidebar-tab-files')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('files-root')).toHaveText('folder');
    expect(await visibleRows(page)).toEqual(TOP_LEVEL);
    expect(await mock(page, (m) => m.folderDialogs)).toEqual(['open']);
  });

  test('C11 the File menu command opens the folder dialog too', async ({ page }) => {
    await start(page);
    await menu(page, 'open-folder');
    await expect(page.getByTestId('files-tree')).toBeVisible();
    expect(await visibleRows(page)).toEqual(TOP_LEVEL);
  });

  test('C11 hidden, ignored and non-Markdown entries never show, at any depth', async ({
    page,
  }) => {
    await start(page);
    await openFromWelcome(page);
    for (const dir of ['other', 'other/more', 'other/more/last', 'sub', 'sub/deep']) {
      await row(page, dir).click();
      await expect(row(page, dir)).toHaveAttribute('aria-expanded', 'true');
    }
    expect((await visibleRows(page)).sort()).toEqual(
      [
        ...TOP_LEVEL,
        'other/more',
        'other/more/last',
        'other/more/last/deepest.md',
        'other/more/mid.md',
        'sub/Café notes.md',
        'sub/deep',
        'sub/deep/level three.md',
        'sub/deep/note.markdown',
      ].sort(),
    );
    for (const hidden of [
      '.config.md',
      '.hidden',
      'node_modules',
      '_site',
      'data.csv',
      'image.png',
      'notes.docx',
      'README',
    ]) {
      await expect(row(page, hidden)).toHaveCount(0);
    }
  });

  test('C11 folders load lazily and nest', async ({ page }) => {
    await start(page);
    await openFromWelcome(page);
    await expect(row(page, 'sub/deep')).toHaveCount(0);
    await row(page, 'sub').click();
    await expect(row(page, 'sub')).toHaveAttribute('aria-level', '1');
    await expect(row(page, 'sub/deep')).toHaveAttribute('aria-level', '2');
    await expect(row(page, 'sub/deep/level three.md')).toHaveCount(0);
    expect(await mock(page, (m) => m.fileOps)).toEqual([]);
    await row(page, 'sub/deep').click();
    await expect(row(page, 'sub/deep/level three.md')).toHaveAttribute('aria-level', '3');
    await row(page, 'sub').click();
    await expect(row(page, 'sub/deep')).toHaveCount(0);
  });

  test('C11 a level over 5,000 entries shows the truncation note', async ({ page }) => {
    const files = folderSeed();
    for (let i = 0; i < 5001; i++) files[inFolder(`big/n${String(i).padStart(5, '0')}.md`)] = 'x';
    await start(page, { files });
    await openFromWelcome(page);
    await expect(page.getByTestId('files-truncated')).toHaveCount(0);
    await row(page, 'big').click();
    await expect(page.getByTestId('files-truncated')).toContainText('5,000');
  });

  test('C11 without a folder the tab says so and offers the button', async ({ page }) => {
    await start(page);
    await page.getByTestId('sidebar-tab-files').click();
    await expect(page.getByTestId('files-empty')).toContainText('No folder open');
    await expect(page.getByTestId('files-open-folder')).toBeVisible();
  });
});

test.describe('C12 opening files', () => {
  test('C12 a click opens the file in Preview and highlights its row', async ({ page }) => {
    await start(page);
    await openFromWelcome(page);
    await row(page, 'a.mdown').click();
    await expect(docName(page)).toHaveText('a.mdown');
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'preview');
    await expect(row(page, 'a.mdown')).toHaveAttribute('aria-current', 'true');
  });

  test('C12 Return opens the focused file', async ({ page }) => {
    await start(page);
    await openFromWelcome(page);
    await row(page, 'c.mkdn').focus();
    await page.keyboard.press('Enter');
    await expect(docName(page)).toHaveText('c.mkdn');
  });

  test('C12 a file that is open activates its tab instead of opening twice', async ({ page }) => {
    await start(page);
    await openFromWelcome(page);
    await row(page, 'a.mdown').click();
    await row(page, 'b.mkd').click();
    await expect(tabs(page)).toHaveCount(2);
    await expect(row(page, 'b.mkd')).toHaveAttribute('aria-current', 'true');
    await row(page, 'a.mdown').click();
    await expect(tabs(page)).toHaveCount(2);
    await expect(docName(page)).toHaveText('a.mdown');
    await expect(row(page, 'a.mdown')).toHaveAttribute('aria-current', 'true');
    await expect(row(page, 'b.mkd')).not.toHaveAttribute('aria-current', 'true');
  });

  test('C12 the active document is revealed in the tree', async ({ page }) => {
    await start(page);
    await openFromWelcome(page);
    await page.evaluate(
      (path) => window.__BACKTICKLE_MOCK__?.openFiles([path]),
      inFolder('sub/deep/note.markdown'),
    );
    await expect(row(page, 'sub/deep/note.markdown')).toHaveAttribute('aria-current', 'true');
    await expect(row(page, 'sub')).toHaveAttribute('aria-expanded', 'true');
    await expect(row(page, 'sub/deep')).toHaveAttribute('aria-expanded', 'true');
  });
});

test.describe('C13 operations', () => {
  test('C13 New File creates Untitled.md, opens it in Split and starts a rename', async ({
    page,
  }) => {
    await start(page);
    await openFromWelcome(page);
    await row(page, 'a.mdown').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'New File' }).click();
    await expect(page.getByTestId('files-rename-input')).toHaveValue('Untitled.md');
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'split');
    await expect(docName(page)).toHaveText('Untitled.md');
    await page.keyboard.type('draft');
    await page.keyboard.press('Enter');
    await expect(row(page, 'draft.md')).toBeVisible();
    await expect(docName(page)).toHaveText('draft.md');
    // A second new file is numbered.
    await row(page, 'a.mdown').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'New File' }).click();
    await expect(page.getByTestId('files-rename-input')).toHaveValue('Untitled.md');
    await page.keyboard.press('Escape');
    await row(page, 'a.mdown').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'New File' }).click();
    const names = (await mock(page, (m) => m.fileOps))
      .filter((op) => op.op === 'create-file')
      .map((op) => (op.to ?? '').split('/').pop());
    expect(names).toEqual(['Untitled.md', 'Untitled.md', 'Untitled 2.md']);
  });

  test('C13 New Folder inside a folder', async ({ page }) => {
    await start(page);
    await openFromWelcome(page);
    await row(page, 'sub').click();
    await row(page, 'sub').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'New Folder' }).click();
    await page.keyboard.type('fresh');
    await page.keyboard.press('Enter');
    await expect(row(page, 'sub/fresh')).toHaveAttribute('data-kind', 'folder');
    expect((await mock(page, (m) => m.tree())).folders).toContain(inFolder('sub/fresh'));
  });

  test('C13 Rename refuses an existing name, a slash and a leading dot; the extension stays', async ({
    page,
  }) => {
    await start(page);
    await openFromWelcome(page);
    await row(page, 'a.mdown').focus();
    await page.keyboard.press('F2');
    const input = page.getByTestId('files-rename-input');
    await expect(input).toBeFocused();
    await input.fill('b.mkd');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('files-rename-error')).toBeVisible();
    await input.fill('x/y.md');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('files-rename-error')).toBeVisible();
    await input.fill('.dot.md');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('files-rename-error')).toBeVisible();
    expect(await mock(page, (m) => m.fileOps)).toEqual([]);
    await expect(row(page, 'a.mdown')).toBeVisible();
    // Typing a new base name keeps the extension: the default selection excludes ".mdown".
    await page.keyboard.press('Escape');
    await row(page, 'a.mdown').focus();
    await page.keyboard.press('F2');
    await page.keyboard.type('renamed');
    await page.keyboard.press('Enter');
    await expect(row(page, 'renamed.mdown')).toBeVisible();
    await expect(row(page, 'a.mdown')).toHaveCount(0);
  });

  test('C13 Duplicate names the copy "name copy.md", then "name copy 2.md", and opens it', async ({
    page,
  }) => {
    await start(page);
    await openFromWelcome(page);
    await row(page, 'chapter 2.md').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    await expect(row(page, 'chapter 2 copy.md')).toBeVisible();
    await expect(docName(page)).toHaveText('chapter 2 copy.md');
    await row(page, 'chapter 2.md').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    await expect(row(page, 'chapter 2 copy 2.md')).toBeVisible();
  });

  test('C13 an open tab follows a rename and a move', async ({ page }) => {
    await start(page);
    await openFromWelcome(page);
    await row(page, 'a.mdown').click();
    await row(page, 'a.mdown').focus();
    await page.keyboard.press('F2');
    await page.getByTestId('files-rename-input').fill('now.qmd');
    await page.keyboard.press('Enter');
    await expect(docName(page)).toHaveText('now.qmd');
    await expect(page.getByTestId('flavor-pill')).toContainText('Quarto');
    await expect(row(page, 'now.qmd')).toHaveAttribute('aria-current', 'true');

    // A move: the tab keeps the document and the title follows the new path.
    await page.evaluate((to) => window.__BACKTICKLE_MOCK__?.setFolderAnswers(to), inFolder('sub'));
    await menu(page, 'move-to');
    await expect(row(page, 'now.qmd')).toHaveCount(0);
    await expect(docName(page)).toHaveText('now.qmd');
    expect((await mock(page, (m) => m.fileOps)).at(-1)).toEqual({
      op: 'move',
      from: inFolder('now.qmd'),
      to: inFolder('sub/now.qmd'),
    });
    await menu(page, 'reveal-in-finder');
    await expect.poll(() => mock(page, (m) => m.reveals.at(-1))).toBe(inFolder('sub/now.qmd'));
  });

  test('C13 Move to Trash asks once with the file name; a clean open tab closes', async ({
    page,
  }) => {
    await start(page, { ask: true });
    await openFromWelcome(page);
    await row(page, 'a.mdown').click();
    await row(page, 'a.mdown').focus();
    await page.keyboard.press('Meta+Backspace');
    await expect(row(page, 'a.mdown')).toHaveCount(0);
    await expect(page.getByTestId('welcome')).toBeVisible();
    const asks = await mock(page, (m) => m.asks);
    expect(asks).toHaveLength(1);
    expect(asks[0]?.title).toBe('Move "a.mdown" to the Trash?');
    expect(await mock(page, (m) => m.trashed)).toEqual([inFolder('a.mdown')]);
  });

  test('C13 declining the question trashes nothing', async ({ page }) => {
    await start(page, { ask: false });
    await openFromWelcome(page);
    await row(page, 'b.mkd').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
    await expect(row(page, 'b.mkd')).toBeVisible();
    expect(await mock(page, (m) => m.trashed)).toEqual([]);
  });

  test('C13 a dirty open tab stays open and gets the missing-file banner', async ({ page }) => {
    await start(page, { ask: true });
    await openFromWelcome(page);
    await row(page, 'a.mdown').click();
    await setView(page, 'editor');
    await editor(page).click();
    await page.keyboard.type('unsaved');
    await expect(page.getByTestId('dirty-dot')).toBeVisible();
    await row(page, 'a.mdown').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
    await expect(row(page, 'a.mdown')).toHaveCount(0);
    await expect(docName(page)).toHaveText('a.mdown');
    await expect(page.getByTestId('banner-missing')).toBeVisible();
    await expect(page.getByTestId('dirty-dot')).toBeVisible();
  });
});

test.describe('C14 keyboard and menus', () => {
  test('C14 arrows expand, collapse and move; Return opens', async ({ page }) => {
    await start(page);
    await openFromWelcome(page);
    const other = row(page, 'other');
    await other.focus();
    await page.keyboard.press('ArrowRight');
    await expect(other).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(row(page, 'other/more')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(other).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(other).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('ArrowDown');
    await expect(row(page, 'sub')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(row(page, 'a.mdown')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(docName(page)).toHaveText('a.mdown');
    await row(page, 'a.mdown').focus();
    await page.keyboard.press('ArrowUp');
    await expect(row(page, 'sub')).toBeFocused();
  });

  test('C14 F2 starts a rename and ⌘⌫ moves to the Trash', async ({ page }) => {
    await start(page, { ask: true });
    await openFromWelcome(page);
    await row(page, 'e.qmd').focus();
    await page.keyboard.press('F2');
    await expect(page.getByTestId('files-rename-input')).toBeFocused();
    await page.keyboard.press('Escape');
    await row(page, 'e.qmd').focus();
    await page.keyboard.press('Meta+Backspace');
    await expect(row(page, 'e.qmd')).toHaveCount(0);
    expect(await mock(page, (m) => m.trashed)).toEqual([inFolder('e.qmd')]);
  });

  test('C14 the context menu opens by right-click and by the ⋯ button', async ({ page }) => {
    await start(page);
    await openFromWelcome(page);
    await row(page, 'e.qmd').click({ button: 'right' });
    const menuBox = page.getByRole('menu', { name: 'File actions' });
    await expect(menuBox).toBeVisible();
    const names = await menuBox.getByRole('menuitem').allTextContents();
    expect(
      names.map((n) =>
        n
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/ (F2|⌘⌫)$/, ''),
      ),
    ).toEqual([
      'New File',
      'New Folder',
      'Rename',
      'Duplicate',
      'Move to Trash',
      'Reveal in Finder',
      'Copy Path',
    ]);
    await page.keyboard.press('Escape');
    await expect(menuBox).toHaveCount(0);
    await page.getByRole('button', { name: 'Actions for f.Rmd' }).click();
    await expect(menuBox).toBeVisible();
  });
});

test.describe('C15 folder changes', () => {
  const change = (page: Page, kind: 'created' | 'removed', relative: string) =>
    page.evaluate(
      ([k, path]) => {
        const control = window.__BACKTICKLE_MOCK__;
        if (k === 'created') control?.externallyCreate(path as string, '# new\n');
        else control?.externallyRemove(path as string);
        control?.fileChanged([
          { path: path as string, kind: k as 'created' | 'removed', scope: 'folder' },
        ]);
      },
      [kind, inFolder(relative)] as const,
    );

  test('C15 files created and removed outside appear and disappear without a reload', async ({
    page,
  }) => {
    await start(page);
    await openFromWelcome(page);
    await row(page, 'sub').click();
    await change(page, 'created', 'sub/added.md');
    await expect(row(page, 'sub/added.md')).toBeVisible();
    await change(page, 'created', 'zzz-top.md');
    await expect(row(page, 'zzz-top.md')).toBeVisible();
    await change(page, 'removed', 'sub/added.md');
    await expect(row(page, 'sub/added.md')).toHaveCount(0);
    await change(page, 'removed', 'sub');
    await expect(row(page, 'sub')).toHaveCount(0);
    await expect(row(page, 'sub/deep')).toHaveCount(0);
  });

  test('C15 a hidden file created outside does not appear', async ({ page }) => {
    await start(page);
    await openFromWelcome(page);
    await change(page, 'created', '.secret.md');
    await change(page, 'created', 'visible-after.md');
    await expect(row(page, 'visible-after.md')).toBeVisible();
    await expect(row(page, '.secret.md')).toHaveCount(0);
  });
});

test.describe('C16 title menu and File menu', () => {
  async function openA(page: Page, seed: Record<string, unknown> = {}) {
    await start(page, seed);
    await openFromWelcome(page);
    await row(page, 'a.mdown').click();
    await expect(docName(page)).toHaveText('a.mdown');
  }

  test('C16 Rename… from the title menu uses a sheet with the same rules', async ({ page }) => {
    await openA(page);
    await page.getByTestId('document-menu-button').click();
    await page.getByRole('menuitem', { name: 'Rename…' }).click();
    const input = page.getByTestId('rename-sheet-input');
    await expect(input).toBeFocused();
    await input.fill('b.mkd');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('rename-sheet-error')).toBeVisible();
    await input.fill('with/slash.md');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('rename-sheet-error')).toBeVisible();
    await input.fill('fresh.mdown');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('rename-sheet')).toHaveCount(0);
    await expect(docName(page)).toHaveText('fresh.mdown');
  });

  test('C16 the File menu command reaches the same sheet', async ({ page }) => {
    await openA(page);
    await menu(page, 'rename');
    await expect(page.getByTestId('rename-sheet')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('rename-sheet')).toHaveCount(0);
  });

  test('C16 Move To… asks for a folder and moves the file', async ({ page }) => {
    await openA(page);
    await page.evaluate(
      (to) => window.__BACKTICKLE_MOCK__?.setFolderAnswers(to),
      inFolder('other'),
    );
    await page.getByTestId('document-menu-button').click();
    await page.getByRole('menuitem', { name: 'Move To…' }).click();
    expect(await mock(page, (m) => m.folderDialogs)).toEqual(['open', 'move']);
    expect((await mock(page, (m) => m.fileOps)).at(-1)).toEqual({
      op: 'move',
      from: inFolder('a.mdown'),
      to: inFolder('other/a.mdown'),
    });
  });

  test('C16 Duplicate opens the copy in a new tab', async ({ page }) => {
    await openA(page);
    await menu(page, 'duplicate');
    await expect(docName(page)).toHaveText('a copy.mdown');
    await expect(tabs(page)).toHaveCount(2);
  });

  test('C16 Revert to Saved asks only when dirty, then restores the file text', async ({
    page,
  }) => {
    await openA(page, { ask: [true, false] });
    await setView(page, 'editor');
    await menu(page, 'revert');
    expect(await mock(page, (m) => m.asks)).toHaveLength(0);
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('ADDED');
    await expect(page.getByTestId('dirty-dot')).toBeVisible();
    await menu(page, 'revert');
    await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
    await expect(editor(page)).not.toContainText('ADDED');
    expect(await mock(page, (m) => m.asks)).toHaveLength(1);
    // The question answered "no": the edit stays.
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('KEPT');
    await menu(page, 'revert');
    await expect(editor(page)).toContainText('KEPT');
  });

  test('C16 Reveal in Finder and Copy Path (writeClipboard)', async ({ page }) => {
    await openA(page);
    await page.getByTestId('document-menu-button').click();
    await page.getByRole('menuitem', { name: 'Copy Path' }).click();
    await expect
      .poll(() => mock(page, (m) => m.clipboardWrites.at(-1)?.text))
      .toBe(inFolder('a.mdown'));
    await page.getByTestId('document-menu-button').click();
    await page.getByRole('menuitem', { name: 'Reveal in Finder' }).click();
    await expect.poll(() => mock(page, (m) => m.reveals.at(-1))).toBe(inFolder('a.mdown'));
    expect(HOME).toBe('/Users/mock');
  });
});
