/** Quick Open against the mock platform. */
import { expect, type Page, test } from '@playwright/test';
import type { MockSeed } from '../../src/lib/platform-mock';
import { HOME, menu, seedMock } from './helpers';

const ROOT = `${HOME}/vault`;
const READ = `${ROOT}/readme.md`;
const NOTE = `${ROOT}/docs/note.md`;
const OTHER = `${ROOT}/notes/other.md`;
const LOOSE = `${HOME}/Documents/loose.md`;

async function start(page: Page, extra: Partial<MockSeed> = {}) {
  await seedMock(page, {
    files: {
      [READ]: '# Readme\n\nbody\n',
      [NOTE]: '# Note file\n\nbody\n',
      [OTHER]: '# Other file\n\nbody\n',
      [LOOSE]: '# Loose file\n\nbody\n',
    },
    recents: [LOOSE],
    launch: { openPath: READ, folderPath: ROOT },
    ...extra,
  });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');
}

const rows = (page: Page) => page.getByTestId('picker-row');
const rowTexts = (page: Page) =>
  rows(page).evaluateAll((els) =>
    els.map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()),
  );

test.describe('C19 Quick Open', () => {
  test('an empty query lists open tabs, then recents, then the folder files, each once', async ({
    page,
  }) => {
    await start(page);
    await expect(page.getByTestId('document-name')).toBeVisible();
    await menu(page, 'quick-open');
    await expect(page.getByTestId('picker')).toBeVisible();
    await expect(page.getByTestId('picker-input')).toBeFocused();
    await expect.poll(() => rows(page).count()).toBe(4);
    // readme.md (tab), loose.md (recent), then docs/note.md and notes/other.md (folder; readme is not repeated).
    expect(await rowTexts(page)).toEqual([
      'readme.md',
      `loose.md ${HOME.replace('/Users/mock', '~')}/Documents`,
      'note.md docs',
      'other.md notes',
    ]);
  });

  test('typing ranks by the relative path and marks the matched characters', async ({ page }) => {
    await start(page);
    await menu(page, 'quick-open');
    await expect.poll(() => rows(page).count()).toBe(4);
    await page.getByTestId('picker-input').fill('note');
    // "docs/note.md" matches in the file name (score 31); "notes/other.md" only in the folder (23).
    await expect.poll(() => rows(page).count()).toBe(2);
    expect(await rowTexts(page)).toEqual(['note.md docs', 'other.md notes']);
    expect(await page.getByTestId('picker-match').allTextContents()).toEqual(['note']);
  });

  test('Return opens the selected file and closes the picker', async ({ page }) => {
    await start(page);
    await menu(page, 'quick-open');
    await expect.poll(() => rows(page).count()).toBe(4);
    await page.getByTestId('picker-input').fill('note');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('picker')).toHaveCount(0);
    await expect(
      page.getByTestId('tab-strip').getByRole('tab', { name: /note\.md/ }),
    ).toBeVisible();
    await expect(page.getByTestId('document-name')).toContainText('note.md');
  });

  test('an open tab is activated, not opened twice', async ({ page }) => {
    await start(page);
    await menu(page, 'quick-open');
    await expect.poll(() => rows(page).count()).toBe(4);
    await page.keyboard.press('Enter'); // the first row is the open readme.md
    await expect(page.getByTestId('picker')).toHaveCount(0);
    await expect(page.getByTestId('tab-strip').getByRole('tab')).toHaveCount(0); // still one document
    await expect(page.getByTestId('document-name')).toContainText('readme.md');
  });

  test('Escape closes the picker and returns the focus', async ({ page }) => {
    await start(page);
    await expect(page.getByTestId('document-name')).toBeVisible();
    await page.getByTestId('sidebar-tab-files').focus();
    await menu(page, 'quick-open');
    await expect(page.getByTestId('picker')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('picker')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-tab-files')).toBeFocused();
  });

  test('works without a folder: tabs and recents', async ({ page }) => {
    await start(page, { launch: { welcome: true } });
    await expect(page.getByTestId('welcome')).toBeVisible();
    await menu(page, 'quick-open');
    await expect(page.getByTestId('picker')).toBeVisible();
    await expect.poll(() => rows(page).count()).toBe(1);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('document-name')).toContainText('loose.md');
  });

  test('a query with no match says so', async ({ page }) => {
    await start(page);
    await menu(page, 'quick-open');
    await page.getByTestId('picker-input').fill('zzzzq');
    await expect(page.getByTestId('picker-empty')).toHaveText('No matching files');
  });
});
