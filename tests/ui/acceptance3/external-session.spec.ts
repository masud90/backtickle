/**
 * Phase 3 acceptance C21, C23, C24, C25 (WP3.8a2): external changes, linked files, cursor and
 * scroll memory, session restore. Mock platform, real WebKit. Expected values come from
 * Run with WD_UI_PORT=1472.
 */
import { expect, type Page, test } from '@playwright/test';
import type { MockSeed } from '../../../src/lib/platform-mock';
import { editor, HOME, menu, preview, seedMock, tabs } from '../helpers';

const DOCS = `${HOME}/Documents`;
const NOTE = `${DOCS}/acc-note.md`;

const lines = (count: number, prefix = 'Row') =>
  Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`).join('\n\n');
const NOTE_TEXT = `# Acc note\n\n${lines(10)}\n`;

const mock = <T>(page: Page, read: (m: NonNullable<Window['__WRITEDOWN_MOCK__']>) => T) =>
  page.evaluate(`(${read.toString()})(window.__WRITEDOWN_MOCK__)`) as Promise<T>;

async function start(page: Page, seed: MockSeed) {
  await seedMock(page, seed);
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');
}

async function startNote(page: Page, extra: Partial<MockSeed> = {}) {
  await start(page, {
    launch: { openPath: NOTE, view: 'split' },
    ...extra,
    files: { [NOTE]: NOTE_TEXT, ...extra.files },
  });
  await expect(page.getByTestId('document-name')).toHaveText('acc-note.md');
  await expect(editor(page)).toBeVisible();
}

/** Someone else changes the file on disk, then the watcher reports it. */
async function outsideChange(
  page: Page,
  path: string,
  kind: 'modified' | 'created' | 'removed',
  text?: string,
  scope: 'document' | 'linked' | 'folder' = 'document',
) {
  await page.evaluate(
    ([p, k, t, s]) => {
      const m = window.__WRITEDOWN_MOCK__;
      if (!m) throw new Error('no mock');
      if (k === 'modified') m.externallyModify(p as string, (t as string | null) ?? undefined);
      else if (k === 'created') m.externallyCreate(p as string, (t as string | null) ?? '');
      else m.externallyRemove(p as string);
      m.fileChanged([{ path: p as string, kind: k, scope: s } as never]);
    },
    [path, kind, text ?? null, scope] as const,
  );
}

const position = (page: Page) => page.getByTestId('status-position');

test.describe('C21 a document changed on disk', () => {
  test('C21 a clean document reloads and the caret stays on its line and column', async ({
    page,
  }) => {
    await startNote(page);
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(position(page)).toHaveText('Ln 7, Col 3');

    // The new text only adds lines below the caret.
    await outsideChange(page, NOTE, 'modified', `${NOTE_TEXT}\nAppended by another app.\n`);
    await expect(editor(page)).toContainText('Appended by another app.');
    await expect(preview(page)).toContainText('Appended by another app.');
    await expect(position(page)).toHaveText('Ln 7, Col 3');
    await expect(page.getByTestId('banner-external')).toHaveCount(0);
    await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  });

  test('C21 a dirty document shows Reload and Keep Mine; Reload takes the disk text', async ({
    page,
  }) => {
    await startNote(page);
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' my edit');
    await expect(page.getByTestId('dirty-dot')).toBeVisible();
    await outsideChange(page, NOTE, 'modified', '# Theirs\n\nDisk text.\n');

    const banner = page.getByTestId('banner-external');
    await expect(banner).toContainText('This file was changed by another app.');
    await expect(banner.getByRole('button', { name: 'Reload', exact: true })).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Keep Mine' })).toBeVisible();
    // Nothing happens to the text until a choice is made.
    await expect(editor(page)).toContainText('my edit');

    await banner.getByRole('button', { name: 'Reload', exact: true }).click();
    await expect(banner).toHaveCount(0);
    await expect(editor(page)).toContainText('Disk text.');
    await expect(editor(page)).not.toContainText('my edit');
    await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  });

  test('C21 Keep Mine keeps the edits and leaves the next save to the modified-externally question', async ({
    page,
  }) => {
    await startNote(page, { ask: false });
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' kept words');
    await outsideChange(page, NOTE, 'modified', '# Theirs\n');

    const banner = page.getByTestId('banner-external');
    await banner.getByRole('button', { name: 'Keep Mine' }).click();
    await expect(banner).toHaveCount(0);
    await expect(editor(page)).toContainText('kept words');
    await expect(page.getByTestId('dirty-dot')).toBeVisible();
    expect(await mock(page, (m) => m.saves.length)).toBe(0);

    await menu(page, 'save');
    // The answer is "no", so the question was asked and nothing was written.
    await expect.poll(() => mock(page, (m) => m.asks.length)).toBe(1);
    expect(await mock(page, (m) => m.saves.length)).toBe(0);
  });

  test('C21 a removed document shows the missing-file banner, is marked unsaved and Close leaves it', async ({
    page,
  }) => {
    await startNote(page, { confirmUnsaved: 'discard' });
    await outsideChange(page, NOTE, 'removed');

    const banner = page.getByTestId('banner-missing');
    await expect(banner).toContainText('This file is no longer on disk.');
    await expect(banner.getByRole('button', { name: 'Save As…' })).toBeVisible();
    await expect(page.getByTestId('dirty-dot')).toBeVisible();
    await expect(editor(page)).toContainText('Row 4');

    await banner.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('welcome')).toBeVisible();
  });
});

test.describe('C23 linked files', () => {
  const DIR = `${HOME}/Linked`;

  test('C23 a changed Quarto include renders again', async ({ page }) => {
    const doc = `${DIR}/main.qmd`;
    await start(page, {
      launch: { openPath: doc, view: 'split' },
      files: {
        [doc]: '# Main\n\nBefore.\n\n{{< include _part.qmd >}}\n\nAfter.\n',
        [`${DIR}/_part.qmd`]: 'Included words, first version.\n',
      },
    });
    await expect(preview(page)).toContainText('first version');
    await outsideChange(
      page,
      `${DIR}/_part.qmd`,
      'modified',
      'Included words, second version.\n',
      'linked',
    );
    await expect(preview(page)).toContainText('second version');
    await expect(preview(page)).not.toContainText('first version');
  });

  test('C23 a changed bibliography updates the citation and the reference list', async ({
    page,
  }) => {
    const doc = `${DIR}/paper.md`;
    const bib = (title: string, year: number) =>
      `@article{k2020,\n  author = {Okafor, Ada},\n  title = {${title}},\n  journal = {Journal},\n  year = {${year}}\n}\n`;
    await start(page, {
      launch: { openPath: doc, view: 'split' },
      files: {
        [doc]: '---\nbibliography: refs.bib\n---\n\nCited [@k2020].\n',
        [`${DIR}/refs.bib`]: bib('First title', 2020),
      },
    });
    await expect(preview(page)).toContainText('(Okafor 2020)');
    await outsideChange(page, `${DIR}/refs.bib`, 'modified', bib('Second title', 2022), 'linked');
    await expect(preview(page)).toContainText('(Okafor 2022)');
    // Pandoc's citeproc title-cases the reference list title ("Second Title.").
    await expect(preview(page)).toContainText('second title', { ignoreCase: true });
  });

  const vaultStart = async (page: Page) => {
    const root = `${HOME}/Vault3`;
    const home = `${root}/Home.md`;
    await start(page, {
      launch: { openPath: home, view: 'split' },
      files: {
        [home]: '# Home\n\n![[Embedded]]\n\nSee [[Later]].\n',
        [`${root}/Embedded.md`]: 'Embedded body one.\n',
        [`${root}/Other.md`]: '# Other\n',
      },
      vault: { root },
      vaults: [root],
    });
    await expect(preview(page)).toContainText('Embedded body one.');
    return root;
  };

  test('C23 a changed embedded note re-renders', async ({ page }) => {
    const root = await vaultStart(page);
    await outsideChange(page, `${root}/Embedded.md`, 'modified', 'Embedded body two.\n', 'linked');
    await expect(preview(page)).toContainText('Embedded body two.');
  });

  test('C23 a new note resolves a wikilink', async ({ page }) => {
    const root = await vaultStart(page);
    const link = preview(page).locator('a.wikilink', { hasText: 'Later' });
    await expect(link).toBeVisible();
    await expect(link).not.toHaveAttribute('href', /.+/);
    await outsideChange(page, `${root}/Later.md`, 'created', '# Later\n', 'folder');
    await expect(link).toHaveAttribute('href', 'Later.md');
  });
});

test.describe('C24 cursor and scroll come back', () => {
  const LONG = lines(240, 'Entry');

  test('C24 after closing the tab and opening the file again', async ({ page }) => {
    const a = `${DOCS}/long-a.md`;
    const b = `${DOCS}/long-b.md`;
    await start(page, {
      files: { [a]: LONG, [b]: '# B\n' },
      launch: { openPath: a, view: 'editor' },
    });
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowDown');
    await expect(position(page)).toHaveText('Ln 41, Col 1');

    await page.evaluate((p) => window.__WRITEDOWN_MOCK__?.openFiles([p]), b);
    await expect(page.getByTestId('document-name')).toHaveText('long-b.md');
    await menu(page, 'close-tab');
    await menu(page, 'close-tab');
    await expect(page.getByTestId('welcome')).toBeVisible();

    await page.evaluate((p) => window.__WRITEDOWN_MOCK__?.openFiles([p]), a);
    await expect(page.getByTestId('document-name')).toHaveText('long-a.md');
    await expect(position(page)).toHaveText('Ln 41, Col 1');
  });

  test('C24 after a relaunch the stored caret is restored and the line is on screen', async ({
    page,
  }) => {
    const a = `${DOCS}/long-c.md`;
    await start(page, {
      files: { [a]: LONG },
      docState: { [a]: { flavor: null, cursor: { line: 101, column: 2 }, scrollLine: 95 } },
      launch: { openPath: a, view: 'editor' },
    });
    await expect(position(page)).toHaveText('Ln 101, Col 3');
    const visible = await editor(page).evaluate((el) => {
      const view = el.closest('.cm-editor')?.getBoundingClientRect();
      const row = [...el.querySelectorAll('.cm-line')].find(
        (line) => line.textContent === 'Entry 51',
      );
      const box = row?.getBoundingClientRect();
      return Boolean(view && box && box.bottom > view.top && box.top < view.bottom);
    });
    // Source line 101 holds "Entry 51" (entries are separated by blank lines).
    expect(visible).toBe(true);
  });
});

test.describe('C25 session restore', () => {
  const FOLDER = `${DOCS}/proj3`;
  const A = `${DOCS}/s-a.md`;
  const B = `${DOCS}/s-b.md`;
  const C = `${DOCS}/s-c.md`;
  const seed = (): MockSeed => ({
    files: {
      [A]: '# A\n\nalpha body\n',
      [B]: '# B\n\nbeta body\n',
      [C]: '# C\n\ngamma body\n',
      [`${FOLDER}/one/two.md`]: '# Two\n',
      [`${FOLDER}/top.md`]: '# Top\n',
    },
    folders: [FOLDER],
    session: {
      tabs: [
        { path: A, view: 'editor' },
        { path: `${DOCS}/vanished.md`, view: 'preview' },
        { path: B, view: 'preview' },
      ],
      active: 0,
      folder: FOLDER,
      sidebarTab: 'outline',
      expanded: [`${FOLDER}/one`],
    },
  });

  test('C25 tabs with their views, the active tab, the sidebar tab and the folder; the missing file is skipped', async ({
    page,
  }) => {
    await start(page, seed());
    await expect(tabs(page)).toHaveCount(2);
    await expect(tabs(page).nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('document-name')).toHaveText('s-a.md');
    await expect(editor(page)).toContainText('alpha body');
    await expect(page.getByTestId('sidebar-tab-outline')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('alert')).toHaveCount(0);

    await tabs(page).nth(1).click();
    await expect(preview(page)).toContainText('beta body');

    // The folder is open and its expansion came back.
    await page.getByTestId('sidebar-tab-files').click();
    await expect(page.getByTestId('files-root')).toHaveText('proj3');
    await expect(
      page.locator(`[data-testid="files-row"][data-path="${FOLDER}/one"]`),
    ).toHaveAttribute('aria-expanded', 'true');
    await expect(
      page.locator(`[data-testid="files-row"][data-path="${FOLDER}/one/two.md"]`),
    ).toBeVisible();
  });

  test('C25 a file opened from Finder at launch comes after the restored tabs and is active', async ({
    page,
  }) => {
    await start(page, { ...seed(), pendingOpenFiles: [C] });
    await expect(tabs(page)).toHaveCount(3);
    await expect(page.getByTestId('tab-strip').getByTestId('tab')).toContainText([
      /s-a\.md/,
      /s-b\.md/,
      /s-c\.md/,
    ]);
    await expect(page.getByTestId('document-name')).toHaveText('s-c.md');
  });

  test('C25 untitled documents are not stored', async ({ page }) => {
    await start(page, seed());
    await expect(tabs(page)).toHaveCount(2);
    await menu(page, 'new');
    await expect(tabs(page)).toHaveCount(3);
    await tabs(page).nth(1).click();
    await page.evaluate(() => window.__WRITEDOWN_MOCK__?.closeRequested('quit'));
    await expect.poll(() => mock(page, (m) => m.finishCloses)).toEqual(['quit']);
    const stored = await mock(page, (m) => m.session);
    expect(stored?.tabs).toEqual([
      { path: A, view: 'editor' },
      { path: B, view: 'preview' },
    ]);
    expect(stored?.active).toBe(1);
    expect(stored?.folder).toBe(FOLDER);
    expect(stored?.sidebarTab).toBe('outline');
  });

  for (const [name, launch] of [
    ['--open', { openPath: C, view: 'split' as const }],
    ['--folder', { folderPath: FOLDER }],
    ['--welcome', { welcome: true }],
  ] as const) {
    test(`C25 ${name} skips the restore`, async ({ page }) => {
      await start(page, { ...seed(), launch });
      if (name === '--open') {
        await expect(page.getByTestId('document-name')).toHaveText('s-c.md');
        await expect(tabs(page)).toHaveCount(0);
      } else if (name === '--folder') {
        await expect(tabs(page)).toHaveCount(0);
        await expect(page.getByTestId('document-name')).toHaveCount(0);
      } else {
        await expect(page.getByTestId('welcome')).toBeVisible();
        await expect(tabs(page)).toHaveCount(0);
      }
    });
  }

  test('C25 --folder shows the folder in the Files tab', async ({ page }) => {
    await start(page, { ...seed(), launch: { folderPath: FOLDER } });
    await expect(page.getByTestId('sidebar-tab-files')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('files-tree')).toBeVisible();
  });

  test('C25 restoreSession: false skips the restore', async ({ page }) => {
    await start(page, { ...seed(), settings: { restoreSession: false } });
    await expect(page.getByTestId('welcome')).toBeVisible();
    await expect(tabs(page)).toHaveCount(0);
  });
});
