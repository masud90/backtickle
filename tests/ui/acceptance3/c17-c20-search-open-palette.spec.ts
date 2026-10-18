/**
 * Phase 3 acceptance C17, C19 and C20 (Search tab, Quick Open, command palette,
 * on the mock platform. C18, the Rust search, is in
 * src-tauri/tests/acceptance3.rs. Scripted search results are built from
 * tests/fixtures/folder/expected-search.json (lines and texts) with the ranges computed here.
 *
 * C19 expected ranking, worked out by hand from the scoring rules of 2.4 (a match scores higher
 * for consecutive characters, for characters at a word start and for characters in the file name),
 * over the Markdown files of the fixture folder (relative paths):
 *   a.mdown, b.mkd, binary.md, c.mkdn, chapter 10.md, chapter 2.md, d.mdx, e.qmd, f.Rmd, g.rmd,
 *   h.mmd, notes with spaces.md, plain.txt, sub/Café notes.md, sub/deep/level three.md,
 *   sub/deep/note.markdown, other/more/mid.md, other/more/last/deepest.md
 * Query "ma" needs an m followed later by an a. Only two paths have one: "note.markdown" (the
 * letters sit side by side at the start of the word "markdown" inside the file name) and
 * "other/more/last/deepest.md" (m at the start of the folder "more", a inside the folder "last",
 * nothing consecutive, nothing in the file name). Expected order: note.markdown, then deepest.md.
 * Query "dee" (d, e, e in order): "other/more/last/deepest.md" has all three side by side at the
 * start of the file name, "sub/deep/level three.md" and "sub/deep/note.markdown" have them side by
 * side at the start of the folder "deep" only. Expected: deepest.md first, then the two "deep"
 * paths in either order (the rules do not separate them). No other path has d before two e.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Page, test } from '@playwright/test';
import {
  editorText,
  expect,
  FIXTURES,
  FOLDER,
  folderSeed,
  HOME,
  inFolder,
  launch,
  menu,
  mock,
  selectionOf,
} from './support';

interface ExpectedSearch {
  query: string;
  files: Record<string, Array<{ line: number; text: string; matches: number }>>;
  totalLines: number;
  totalMatches: number;
  fileCount: number;
}
const EXPECTED = (
  JSON.parse(readFileSync(join(FIXTURES, 'folder', 'expected-search.json'), 'utf8')) as {
    searches: ExpectedSearch[];
  }
).searches[0] as ExpectedSearch;

/** The scripted `searchFolder` answer for the first search of expected-search.json. */
function lanternResult() {
  return {
    files: Object.entries(EXPECTED.files).map(([relative, rows]) => ({
      path: inFolder(relative),
      matches: rows.map((row) => ({
        line: row.line,
        text: row.text,
        ranges: [...row.text.matchAll(/lantern/gi)].map(
          (hit) => [hit.index as number, (hit.index as number) + hit[0].length] as [number, number],
        ),
      })),
    })),
  };
}

async function start(page: Page, seed: Record<string, unknown> = {}) {
  await page.setViewportSize({ width: 1280, height: 820 });
  const seeded = {
    files: folderSeed(),
    launch: { welcome: true, folderPath: FOLDER },
    searchResults: { lantern: lanternResult() },
    ...seed,
  };
  const opens = Boolean((seeded.launch as { openPath?: string } | undefined)?.openPath);
  await launch(page, { seed: seeded, waitFor: opens ? 'document' : 'welcome' });
}

const input = (page: Page) => page.getByTestId('search-input');
const requests = (page: Page) => page.evaluate(() => window.__BACKTICKLE_MOCK__?.searches ?? []);

test.describe('C17 Search tab', () => {
  test('C17 the command shows the Search tab with the field focused', async ({ page }) => {
    await start(page);
    await menu(page, 'search-folder');
    await expect(page.getByTestId('sidebar-tab-search')).toHaveAttribute('aria-selected', 'true');
    await expect(input(page)).toBeFocused();
  });

  test('C17 without a folder it offers to open one', async ({ page }) => {
    await start(page, { launch: { welcome: true } });
    await menu(page, 'search-folder');
    await expect(page.getByTestId('search-empty')).toHaveText('Open a folder to search it');
    await expect(page.getByTestId('search-open-folder')).toBeVisible();
  });

  test('C17 results are grouped by file with counts and marked ranges', async ({ page }) => {
    await start(page);
    await menu(page, 'search-folder');
    await input(page).fill('lantern');
    await expect(page.getByTestId('search-file')).toHaveCount(EXPECTED.fileCount);
    await expect(page.getByTestId('search-summary')).toHaveText(
      `${EXPECTED.totalLines} matches in ${EXPECTED.fileCount} files`,
    );
    // Rows per file, in the order the answer gave them.
    const perFile = Object.values(EXPECTED.files).map((rows) => String(rows.length));
    await expect(page.getByTestId('search-file-count')).toHaveText(perFile);
    await expect(page.getByTestId('search-match')).toHaveCount(EXPECTED.totalLines);
    // Every occurrence is marked, with the text as written (capital L included).
    const marks = await page.getByTestId('search-mark').allTextContents();
    expect(marks).toHaveLength(EXPECTED.totalMatches);
    expect(marks.map((m) => m.toLowerCase())).toEqual(marks.map(() => 'lantern'));
    expect(marks).toContain('Lantern');
    // The line number of each match is shown.
    const rows = await page.getByTestId('search-match').allTextContents();
    const firstLine = Object.values(EXPECTED.files)[0]?.[0];
    expect(rows[0]).toContain(String(firstLine?.line));
    expect(rows[0]).toContain(firstLine?.text.slice(0, 10));
    // A collapsible file header.
    const header = page.getByTestId('search-file-header').first();
    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('search-match')).toHaveCount(
      EXPECTED.totalLines - (Object.values(EXPECTED.files)[0]?.length ?? 0),
    );
  });

  test('C17 the request goes 250 ms after typing stops and carries the toggles', async ({
    page,
  }) => {
    await start(page);
    await menu(page, 'search-folder');
    await input(page).pressSequentially('lan', { delay: 20 });
    expect(await requests(page)).toHaveLength(0);
    await input(page).pressSequentially('tern', { delay: 20 });
    await expect.poll(async () => (await requests(page)).length).toBe(1);
    expect((await requests(page))[0]).toMatchObject({
      folder: FOLDER,
      query: 'lantern',
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    });
    await page.getByTestId('search-toggle-caseSensitive').click();
    await expect.poll(async () => (await requests(page)).length).toBe(2);
    expect((await requests(page))[1]).toMatchObject({ caseSensitive: true, wholeWord: false });
    await page.getByTestId('search-toggle-wholeWord').click();
    await expect.poll(async () => (await requests(page)).length).toBe(3);
    expect((await requests(page))[2]).toMatchObject({ caseSensitive: true, wholeWord: true });
    await page.getByTestId('search-toggle-regex').click();
    await expect.poll(async () => (await requests(page)).length).toBe(4);
    expect((await requests(page))[3]).toMatchObject({
      caseSensitive: true,
      wholeWord: true,
      regex: true,
    });
  });

  test('C17 a new query cancels the running search', async ({ page }) => {
    await start(page, { searchHold: true });
    await menu(page, 'search-folder');
    await input(page).fill('lantern');
    await expect.poll(async () => (await requests(page)).length).toBe(1);
    await input(page).fill('lanterns');
    await expect.poll(async () => (await requests(page)).length).toBe(2);
    const [first, second] = await requests(page);
    expect(second?.id).toBeGreaterThan(first?.id ?? 0);
    expect(await mock(page, (m) => m.cancelledSearches)).toEqual([first?.id]);
  });

  test('C17 the caps note shows for a truncated result', async ({ page }) => {
    await start(page, {
      searchResults: { lantern: { ...lanternResult(), truncated: true } },
    });
    await menu(page, 'search-folder');
    await input(page).fill('lantern');
    await expect(page.getByTestId('search-caps')).toHaveText('Showing the first 1,000 matches');
  });

  test('C17 a regular expression error shows under the field', async ({ page }) => {
    await start(page, {
      searchResults: { '(': { files: [], error: 'regex parse error: unclosed group' } },
    });
    await menu(page, 'search-folder');
    await page.getByTestId('search-toggle-regex').click();
    await input(page).fill('(');
    await expect(page.getByTestId('search-error')).toHaveText('regex parse error: unclosed group');
  });

  test('C17 a click opens the file at the line with the cursor on the match', async ({ page }) => {
    await start(page);
    await menu(page, 'search-folder');
    await input(page).fill('lantern');
    // chapter 2.md, line 5: "A lantern, a lantern." (the first match starts at column 3).
    const target = page
      .getByTestId('search-match')
      .filter({ hasText: 'A lantern, a lantern.' })
      .first();
    await target.click();
    await expect(page.getByTestId('document-name')).toHaveText('chapter 2.md');
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'split');
    await expect
      .poll(async () => {
        const { from } = await selectionOf(page);
        const before = (await editorText(page)).slice(0, from);
        return `${before.split('\n').length}:${from - (before.lastIndexOf('\n') + 1) + 1}`;
      })
      .toBe('5:3');
  });

  test('C17 Return on a result reaches the same place', async ({ page }) => {
    await start(page);
    await menu(page, 'search-folder');
    await input(page).fill('lantern');
    await expect(page.getByTestId('search-file')).toHaveCount(EXPECTED.fileCount);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('search-match').first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('document-name')).toHaveText('chapter 10.md');
  });
});

// ---- C19 Quick Open -----------------------------------------------------------------------------

const rows = (page: Page) => page.getByTestId('picker-row');
const rowNames = (page: Page) =>
  rows(page).evaluateAll((els) =>
    els.map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()),
  );
/** The file name at the start of a picker row (names may contain spaces). */
const fileName = (text: string) => /^.*?\.[A-Za-z]+(?= |$)/.exec(text)?.[0] ?? text;
const LOOSE = `${HOME}/Documents/loose.md`;

test.describe('C19 Quick Open', () => {
  test('C19 an empty query lists open tabs, then recents, then folder files, each once', async ({
    page,
  }) => {
    await start(page, {
      files: { ...folderSeed(), [LOOSE]: '# Loose\n' },
      recents: [LOOSE, inFolder('b.mkd')],
      launch: { openPath: inFolder('a.mdown'), folderPath: FOLDER },
    });
    await expect(page.getByTestId('document-name')).toHaveText('a.mdown');
    await page.evaluate((p) => window.__BACKTICKLE_MOCK__?.openFiles([p]), inFolder('c.mkdn'));
    await expect(page.getByTestId('document-name')).toHaveText('c.mkdn');
    await menu(page, 'quick-open');
    await expect(page.getByTestId('picker')).toBeVisible();
    await expect(page.getByTestId('picker-input')).toBeFocused();
    await expect.poll(() => rows(page).count()).toBeGreaterThan(5);
    const names = (await rowNames(page)).map(fileName);
    // Tabs first (a.mdown, c.mkdn), then the recents not open (loose.md, b.mkd), then the rest.
    expect(names.slice(0, 4)).toEqual(['a.mdown', 'c.mkdn', 'loose.md', 'b.mkd']);
    // The folder's files come last, once each, without the ones already listed.
    const rest = (await rowNames(page)).slice(4).map(fileName);
    expect(new Set(rest).size).toBe(rest.length);
    expect(rest).not.toContain('a.mdown');
    expect(rest).not.toContain('b.mkd');
    expect(rest).not.toContain('c.mkdn');
    expect([...rest].sort()).toEqual(
      [
        'binary.md',
        'chapter 10.md',
        'chapter 2.md',
        'd.mdx',
        'e.qmd',
        'f.Rmd',
        'g.rmd',
        'h.mmd',
        'notes with spaces.md',
        'plain.txt',
        'Café notes.md',
        'level three.md',
        'note.markdown',
        'mid.md',
        'deepest.md',
      ].sort(),
    );
  });

  test('C19 "ma" ranks note.markdown above deepest.md, and marks the matched characters', async ({
    page,
  }) => {
    await start(page);
    await menu(page, 'quick-open');
    await page.getByTestId('picker-input').fill('ma');
    await expect.poll(() => rows(page).count()).toBe(2);
    const names = (await rowNames(page)).map(fileName);
    expect(names).toEqual(['note.markdown', 'deepest.md']);
    // In the first row the two matched characters are the pair at the start of "markdown".
    const marked = await rows(page).first().getByTestId('picker-match').allTextContents();
    expect(marked.join('')).toBe('ma');
  });

  test('C19 "dee" puts the file-name match first', async ({ page }) => {
    await start(page);
    await menu(page, 'quick-open');
    await page.getByTestId('picker-input').fill('dee');
    await expect.poll(() => rows(page).count()).toBe(3);
    const names = (await rowNames(page)).map(fileName);
    expect(names[0]).toBe('deepest.md');
    expect(names.slice(1).sort()).toEqual(['level three.md', 'note.markdown']);
    const marked = await rows(page).first().getByTestId('picker-match').allTextContents();
    expect(marked.join('')).toBe('dee');
  });

  test('C19 Return opens the selected file and closes the picker', async ({ page }) => {
    await start(page);
    await menu(page, 'quick-open');
    await page.getByTestId('picker-input').fill('ma');
    await expect.poll(() => rows(page).count()).toBe(2);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('picker')).toHaveCount(0);
    await expect(page.getByTestId('document-name')).toHaveText('note.markdown');
  });

  test('C19 Escape closes the picker and returns the focus', async ({ page }) => {
    await start(page);
    await page.getByTestId('sidebar-tab-files').focus();
    await menu(page, 'quick-open');
    await expect(page.getByTestId('picker')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('picker')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-tab-files')).toBeFocused();
  });

  test('C19 works without a folder: tabs and recents', async ({ page }) => {
    await start(page, {
      files: { [LOOSE]: '# Loose\n' },
      recents: [LOOSE],
      launch: { welcome: true },
    });
    await menu(page, 'quick-open');
    await expect(page.getByTestId('picker')).toBeVisible();
    await expect.poll(() => rows(page).count()).toBe(1);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('document-name')).toHaveText('loose.md');
  });
});

// ---- C20 command palette ------------------------------------------------------------------------

test.describe('C20 command palette', () => {
  const NOTE = `${HOME}/note.md`;
  async function startDoc(page: Page) {
    await start(page, {
      files: { [NOTE]: '# Note\n\nbody\n' },
      launch: { openPath: NOTE },
    });
    await expect(page.getByTestId('document-name')).toHaveText('note.md');
  }
  const row = (page: Page, text: string) => rows(page).filter({ hasText: text }).first();

  test('C20 lists enabled commands with their shortcuts', async ({ page }) => {
    await startDoc(page);
    await menu(page, 'command-palette');
    await expect(page.getByTestId('picker')).toBeVisible();
    await expect(row(page, 'Save As…')).toContainText('⇧⌘S');
    await expect(row(page, 'Quick Open…')).toContainText('⇧⌘O');
    await expect(row(page, 'Flavor: Pandoc / MMD')).toBeVisible();
    // The palette is not listed in itself.
    await expect(rows(page).filter({ hasText: 'Command Palette…' })).toHaveCount(0);
  });

  test('C20 without a document only commands that need none are listed', async ({ page }) => {
    await start(page, { launch: { welcome: true } });
    await menu(page, 'command-palette');
    await expect.poll(() => rows(page).count()).toBeGreaterThan(3);
    await expect(rows(page).filter({ hasText: 'Open Folder…' })).toHaveCount(1);
    await expect(rows(page).filter({ hasText: 'Save As…' })).toHaveCount(0);
  });

  test('C20 filters as you type and runs a view switch with Return', async ({ page }) => {
    await startDoc(page);
    await menu(page, 'command-palette');
    await page.getByTestId('picker-input').fill('view: split');
    await expect(rows(page).first()).toContainText('View: Split');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('picker')).toHaveCount(0);
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'split');
  });

  test('C20 runs a flavor choice', async ({ page }) => {
    await startDoc(page);
    await menu(page, 'command-palette');
    await page.getByTestId('picker-input').fill('Flavor: Pandoc');
    await rows(page).first().click();
    await expect(page.getByTestId('status-flavor')).toContainText('Pandoc');
  });

  test('C20 runs a sidebar tab command', async ({ page }) => {
    await startDoc(page);
    await menu(page, 'command-palette');
    await page.getByTestId('picker-input').fill('Show Files');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('sidebar-tab-files')).toHaveAttribute('aria-selected', 'true');
  });
});
