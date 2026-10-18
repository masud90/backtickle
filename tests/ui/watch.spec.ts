/**
 * External changes against the mock platform: the watch set,
 * the three document answers (reload, banner, missing), linked files and the vault.
 * Run with WD_UI_PORT=1468.
 */
import { expect, type Page, test } from '@playwright/test';
import type { MockSeed } from '../../src/lib/platform-mock';
import { editor, HOME, menu, preview, seedMock, tabs, typeAtEnd } from './helpers';

const DOCS = `${HOME}/Documents`;
const NOTE = `${DOCS}/note.md`;
const OTHER = `${DOCS}/other.md`;
const BODY = Array.from({ length: 8 }, (_, i) => `Line ${i + 1} of the note.`).join('\n\n');
const NOTE_TEXT = `# Note\n\n${BODY}\n`;

const mock = <T>(page: Page, read: (m: NonNullable<Window['__BACKTICKLE_MOCK__']>) => T) =>
  page.evaluate(`(${read.toString()})(window.__BACKTICKLE_MOCK__)`) as Promise<T>;

async function openNote(page: Page, seed: MockSeed = {}) {
  await seedMock(page, {
    launch: { openPath: NOTE, view: 'split' },
    ...seed,
    files: { [NOTE]: NOTE_TEXT, ...seed.files },
  });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');
  await expect(page.getByTestId('document-name')).toHaveText('note.md');
  await expect(editor(page)).toBeVisible();
}

const change = (
  page: Page,
  kind: 'modified' | 'created' | 'removed',
  path = NOTE,
  scope = 'document',
) =>
  page.evaluate(
    ([k, p, s]) =>
      window.__BACKTICKLE_MOCK__?.fileChanged([{ path: p, kind: k, scope: s } as never]),
    [kind, path, scope] as const,
  );

const lastWatch = (page: Page) => mock(page, (m) => m.watches[m.watches.length - 1] ?? null);

test.describe('the watch set', () => {
  test('follows the open documents and is after an open and a close', async ({ page }) => {
    await openNote(page, { files: { [OTHER]: '# Other\n' } });
    await expect
      .poll(() => lastWatch(page))
      .toEqual({ documents: [NOTE], linked: [], folder: null });

    await page.evaluate(() =>
      window.__BACKTICKLE_MOCK__?.openFiles(['/Users/mock/Documents/other.md']),
    );
    await expect(tabs(page)).toHaveCount(2);
    await expect
      .poll(() => lastWatch(page))
      .toEqual({ documents: [NOTE, OTHER], linked: [], folder: null });

    await menu(page, 'close-tab');
    await expect(page.getByTestId('document-name')).toHaveText('note.md');
    await expect
      .poll(() => lastWatch(page))
      .toEqual({ documents: [NOTE], linked: [], folder: null });
  });

  test('has the open folder and the linked files a preview fetched', async ({ page }) => {
    const DIR = `${HOME}/Papers`;
    const DOC = `${DIR}/paper.md`;
    await seedMock(page, {
      files: {
        [DOC]: '---\nbibliography: refs.bib\n---\n\nSee [@smith2020].\n',
        [`${DIR}/refs.bib`]:
          '@article{smith2020,\n  author = {Smith, Jane},\n  title = {A Title},\n  journal = {J},\n  year = {2020}\n}\n',
      },
      launch: { openPath: DOC, view: 'split', folderPath: DIR },
    });
    await page.goto('/');
    await expect(preview(page)).toContainText('Smith');
    await expect
      .poll(() => lastWatch(page))
      .toEqual({ documents: [DOC], linked: [`${DIR}/refs.bib`], folder: DIR });
  });
});

test.describe('C21 a document changed on disk', () => {
  test('a clean one reloads and the caret stays on its line', async ({ page }) => {
    await openNote(page);
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('status-position')).toHaveText('Ln 5, Col 1');

    const changed = `# Note\n\nA new paragraph.\n\n${BODY}\n\nAnd one more.\n`;
    await mock(page, () => undefined);
    await page.evaluate(
      ([path, text]) =>
        window.__BACKTICKLE_MOCK__?.externallyModify(path as string, text as string),
      [NOTE, changed],
    );
    await change(page, 'modified');

    await expect(preview(page)).toContainText('A new paragraph.');
    await expect(editor(page)).toContainText('And one more.');
    await expect(page.getByTestId('banner-external')).toHaveCount(0);
    await expect(page.getByTestId('banner-missing')).toHaveCount(0);
    await expect(page.getByTestId('status-position')).toHaveText('Ln 5, Col 1');
    await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  });

  test('a dirty one asks; Keep Mine keeps the text and the next save asks about the file', async ({
    page,
  }) => {
    await openNote(page, { ask: false });
    await typeAtEnd(page, 'mine');
    await page.evaluate(
      ([path, text]) =>
        window.__BACKTICKLE_MOCK__?.externallyModify(path as string, text as string),
      [NOTE, '# Theirs\n'],
    );
    await change(page, 'modified');

    const banner = page.getByTestId('banner-external');
    await expect(banner).toContainText('This file was changed by another app.');
    await banner.getByRole('button', { name: 'Keep Mine' }).click();
    await expect(banner).toHaveCount(0);
    await expect(editor(page)).toContainText('mine');
    await expect(page.getByTestId('dirty-dot')).toBeVisible();

    await menu(page, 'save');
    await expect
      .poll(() => mock(page, (m) => m.asks.map((ask) => ask.title)))
      .toEqual(['The file changed on disk since you opened it']);
  });

  test('a dirty one: Reload takes the file and drops the edits', async ({ page }) => {
    await openNote(page);
    await typeAtEnd(page, 'mine');
    await page.evaluate(
      ([path, text]) =>
        window.__BACKTICKLE_MOCK__?.externallyModify(path as string, text as string),
      [NOTE, '# Theirs\n\nTheir text.\n'],
    );
    await change(page, 'modified');

    await page
      .getByTestId('banner-external')
      .getByRole('button', { name: 'Reload', exact: true })
      .click();
    await expect(page.getByTestId('banner-external')).toHaveCount(0);
    await expect(preview(page)).toContainText('Their text.');
    await expect(editor(page)).not.toContainText('mine');
    await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  });

  test('a removed one shows the missing-file banner and the unsaved mark; Save As saves it', async ({
    page,
  }) => {
    await openNote(page, { saveDialog: `${DOCS}/restored.md` });
    await page.evaluate((path) => window.__BACKTICKLE_MOCK__?.externallyRemove(path), NOTE);
    await change(page, 'removed');

    const banner = page.getByTestId('banner-missing');
    await expect(banner).toContainText('This file is no longer on disk.');
    await expect(page.getByTestId('dirty-dot')).toBeVisible();
    await expect(editor(page)).toContainText('Line 3 of the note.');

    await banner.getByRole('button', { name: 'Save As…' }).click();
    await expect(page.getByTestId('document-name')).toHaveText('restored.md');
    await expect(banner).toHaveCount(0);
    await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
    const saves = await mock(page, (m) => m.saves.map((save) => save.path));
    expect(saves).toEqual([`${DOCS}/restored.md`]);
  });
});

const BIB = (year: number) =>
  `@article{smith2020,\n  author = {Smith, Jane},\n  title = {A Title},\n  journal = {J},\n  year = {${year}}\n}\n`;

test.describe('C23 linked files', () => {
  const DIR = `${HOME}/Papers`;
  const DOC = `${DIR}/paper.md`;

  test('a changed bibliography renders the citations again', async ({ page }) => {
    await seedMock(page, {
      files: {
        [DOC]: '---\nbibliography: refs.bib\n---\n\nSee [@smith2020].\n',
        [`${DIR}/refs.bib`]: BIB(2020),
      },
      launch: { openPath: DOC, view: 'split' },
    });
    await page.goto('/');
    await expect(preview(page)).toContainText('(Smith 2020)');

    await page.evaluate(
      ([path, text]) =>
        window.__BACKTICKLE_MOCK__?.externallyModify(path as string, text as string),
      [`${DIR}/refs.bib`, BIB(2021)],
    );
    await change(page, 'modified', `${DIR}/refs.bib`, 'linked');

    await expect(preview(page)).toContainText('(Smith 2021)');
  });

  test('a note added to the vault resolves a wikilink that was unresolved', async ({ page }) => {
    const ROOT = `${HOME}/Vault`;
    const HOME_NOTE = `${ROOT}/Home.md`;
    await seedMock(page, {
      files: { [HOME_NOTE]: '# Home\n\nGo to [[Newcomer]].\n', [`${ROOT}/Other.md`]: '# Other\n' },
      vault: { root: ROOT },
      vaults: [ROOT],
      launch: { openPath: HOME_NOTE, view: 'split' },
    });
    await page.goto('/');
    await expect(page.getByTestId('flavor-pill')).toContainText('Obsidian');
    const link = preview(page).locator('a.wikilink', { hasText: 'Newcomer' });
    await expect(link).toBeVisible();
    await expect(link).not.toHaveAttribute('href', /.+/);

    await page.evaluate(
      (path) => window.__BACKTICKLE_MOCK__?.externallyCreate(path, '# Newcomer\n'),
      `${ROOT}/Newcomer.md`,
    );
    await change(page, 'created', `${ROOT}/Newcomer.md`, 'folder');

    await expect(link).toHaveAttribute('href', 'Newcomer.md');
  });
});
