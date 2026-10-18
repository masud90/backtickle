/**
 * Search tab against the mock platform: scripted results,
 * requests recorded in `searches` and `cancelledSearches`.
 */
import { expect, type Page, test } from '@playwright/test';
import type { MockSeed } from '../../src/lib/platform-mock';
import { HOME, menu, seedMock, statusText } from './helpers';

const ROOT = `${HOME}/vault`;
const A = `${ROOT}/alpha.md`;
const B = `${ROOT}/sub/beta.md`;

function longDoc(): string {
  const lines = ['# Alpha', ''];
  for (let i = 3; i <= 80; i++)
    lines.push(i === 40 ? 'The lantern is lit here.' : `Filler line ${i}.`);
  return `${lines.join('\n')}\n`;
}

const LANTERN: NonNullable<MockSeed['searchResults']>[string] = {
  files: [
    {
      path: A,
      matches: [
        { line: 40, text: 'The lantern is lit here.', ranges: [[4, 11]] },
        {
          line: 41,
          text: 'lantern lantern',
          ranges: [
            [0, 7],
            [8, 15],
          ],
        },
      ],
    },
    { path: B, matches: [{ line: 3, text: 'A Lantern glows', ranges: [[2, 9]] }] },
  ],
};

async function start(page: Page, extra: Partial<MockSeed> = {}) {
  await seedMock(page, {
    files: { [A]: longDoc(), [B]: '# Beta\n\nx\nA Lantern glows\n' },
    searchResults: { lantern: LANTERN },
    ...extra,
    launch: { welcome: true, folderPath: ROOT, ...extra.launch },
  });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');
  await expect(page.getByTestId('welcome')).toBeVisible();
}

const input = (page: Page) => page.getByTestId('search-input');
const requests = (page: Page) => page.evaluate(() => window.__BACKTICKLE_MOCK__?.searches ?? []);

test.describe('C17 Search tab', () => {
  test('the command shows the Search tab with the field focused', async ({ page }) => {
    await start(page);
    await menu(page, 'search-folder');
    await expect(page.getByTestId('sidebar-tab-search')).toHaveAttribute('aria-selected', 'true');
    await expect(input(page)).toBeFocused();
  });

  test('without a folder it asks to open one', async ({ page }) => {
    await start(page, { launch: { welcome: true, folderPath: null } });
    await page.getByTestId('sidebar-tab-search').click();
    await expect(page.getByTestId('search-empty')).toHaveText('Open a folder to search it');
    await expect(page.getByTestId('search-open-folder')).toBeVisible();
  });

  test('results are grouped by file with counts and marked ranges', async ({ page }) => {
    await start(page);
    await menu(page, 'search-folder');
    await input(page).fill('lantern');
    await expect(page.getByTestId('search-file')).toHaveCount(2);
    await expect(page.getByTestId('search-summary')).toHaveText('3 matches in 2 files');
    const counts = page.getByTestId('search-file-count');
    await expect(counts.nth(0)).toHaveText('2');
    await expect(counts.nth(1)).toHaveText('1');
    const headers = page.getByTestId('search-file-header');
    await expect(headers.nth(0)).toContainText('alpha.md');
    await expect(headers.nth(1)).toContainText('beta.md');
    await expect(headers.nth(1)).toContainText('sub');
    const marks = await page.getByTestId('search-mark').allTextContents();
    expect(marks).toEqual(['lantern', 'lantern', 'lantern', 'Lantern']);
    // Marks are elements with a class, never inline styles.
    expect(await page.locator('[data-testid="search-results"] [style]').count()).toBe(0);
    // Collapsing a file hides its matches.
    await headers.nth(0).click();
    await expect(page.getByTestId('search-match')).toHaveCount(1);
    await expect(headers.nth(0)).toHaveAttribute('aria-expanded', 'false');
  });

  test('the search starts 250 ms after typing stops, with the toggles in the request', async ({
    page,
  }) => {
    await start(page);
    await menu(page, 'search-folder');
    await input(page).pressSequentially('lan', { delay: 20 });
    expect(await requests(page)).toHaveLength(0);
    await input(page).pressSequentially('tern', { delay: 20 });
    await expect.poll(async () => (await requests(page)).length).toBe(1);
    const first = (await requests(page))[0];
    expect(first).toMatchObject({
      folder: ROOT,
      query: 'lantern',
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    });
    await page.getByTestId('search-toggle-caseSensitive').click();
    await page.getByTestId('search-toggle-wholeWord').click();
    await page.getByTestId('search-toggle-regex').click();
    await expect(page.getByTestId('search-toggle-regex')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await requests(page)).length).toBe(2);
    expect((await requests(page))[1]).toMatchObject({
      query: 'lantern',
      caseSensitive: true,
      wholeWord: true,
      regex: true,
    });
  });

  test('a new search cancels the running one and ids increase', async ({ page }) => {
    await start(page, { searchHold: true });
    await menu(page, 'search-folder');
    await input(page).fill('lantern');
    await expect.poll(async () => (await requests(page)).length).toBe(1);
    await expect(page.getByTestId('search-status')).toHaveText('Searching…');
    await input(page).fill('lanterns');
    await expect.poll(async () => (await requests(page)).length).toBe(2);
    const sent = await requests(page);
    expect(sent[1]?.id).toBeGreaterThan(sent[0]?.id ?? 0);
    expect(await page.evaluate(() => window.__BACKTICKLE_MOCK__?.cancelledSearches)).toEqual([
      sent[0]?.id,
    ]);
    // The answer of the second search shows (nothing is scripted for it).
    await page.evaluate((id) => window.__BACKTICKLE_MOCK__?.finishSearch(id), sent[1]?.id ?? 0);
    await expect(page.getByTestId('search-none')).toHaveText('No matches');
  });

  test('an empty query clears the results without a request', async ({ page }) => {
    await start(page);
    await menu(page, 'search-folder');
    await input(page).fill('lantern');
    await expect(page.getByTestId('search-file')).toHaveCount(2);
    await input(page).fill('');
    await expect(page.getByTestId('search-hint')).toBeVisible();
    await expect(page.getByTestId('search-file')).toHaveCount(0);
    expect(await requests(page)).toHaveLength(1);
  });

  test('the caps note shows when the result is truncated', async ({ page }) => {
    await start(page, {
      searchResults: {
        lantern: { files: LANTERN.files, truncated: true },
      },
    });
    await menu(page, 'search-folder');
    await input(page).fill('lantern');
    await expect(page.getByTestId('search-caps')).toHaveText('Showing the first 1,000 matches');
  });

  test('a pattern error shows under the field', async ({ page }) => {
    await start(page, {
      searchResults: { '(': { files: [], error: 'regex parse error: unclosed group' } },
    });
    await menu(page, 'search-folder');
    await page.getByTestId('search-toggle-regex').click();
    await input(page).fill('(');
    await expect(page.getByTestId('search-error')).toHaveText('regex parse error: unclosed group');
    await expect(input(page)).toHaveAttribute('aria-invalid', 'true');
  });

  test('a click opens the file at the line with the caret on the match', async ({ page }) => {
    await start(page);
    await menu(page, 'search-folder');
    await input(page).fill('lantern');
    await page.getByTestId('search-match').first().click();
    await expect(page.getByTestId('document-name')).toContainText('alpha.md');
    // Line 40, column 5 (the match starts after "The ").
    await expect.poll(() => statusText(page, 'status-position')).toMatch(/40\D+5\b/);
    // Both panes are in view (Split) and the preview shows the line.
    await expect(page.getByTestId('preview')).toContainText('The lantern is lit here.');
    const inView = await page.getByTestId('preview').evaluate((el) => {
      const target = [...el.querySelectorAll('p')].find((p) =>
        p.textContent?.includes('The lantern is lit here.'),
      );
      const scroller = el.closest('[data-testid="preview-scroll"]') ?? el.parentElement;
      if (!target || !scroller) return false;
      const t = target.getBoundingClientRect();
      const s = scroller.getBoundingClientRect();
      return t.bottom > s.top && t.top < s.bottom;
    });
    expect(inView).toBe(true);
  });

  test('arrow keys and Return reach a result', async ({ page }) => {
    await start(page);
    await menu(page, 'search-folder');
    await input(page).fill('lantern');
    await expect(page.getByTestId('search-file')).toHaveCount(2);
    await page.keyboard.press('ArrowDown'); // first file header
    await page.keyboard.press('ArrowDown'); // first match
    await expect(page.getByTestId('search-match').first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('document-name')).toContainText('alpha.md');
  });
});
