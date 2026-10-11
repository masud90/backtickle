/**
 * Phase 3 acceptance C37 (WP3.8a2): visual baselines, light and dark, 1280 x 820, for the Files
 * tab, Search with results, Quick Open and the preview find bar. Animations are off, the caret is
 * hidden and the clock is frozen. The first baselines are generated with `--update-snapshots`
 * and approved by a person; after that a difference fails the test. Run with
 * WD_UI_PORT=1472.
 */
import { expect, type Page, test } from '@playwright/test';
import type { MockSeed } from '../../../src/lib/platform-mock';
import { HOME, menu, preview, seedMock } from '../helpers';

const ROOT = `${HOME}/Projects/field-notes`;
const FROZEN = new Date('2026-10-05T09:00:00Z');
const SHOT = { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.002 } as const;

const NOTE = `# Field notes

The lantern project began in spring. Each lantern was counted twice, and the counts were compared.

## Method

We counted lanterns in every district. A second team repeated the count.

## Results

The totals matched in most districts; a lantern count is easy to get wrong.
`;

const files = (): Record<string, string> => ({
  [`${ROOT}/README.md`]: NOTE,
  [`${ROOT}/analysis/plan.md`]: '# Plan\n\nlantern\n',
  [`${ROOT}/analysis/results.qmd`]: '# Results\n',
  [`${ROOT}/analysis/notes.md`]: '# Notes\n',
  [`${ROOT}/drafts/report.md`]: '# Report\n\nlantern\n',
  [`${ROOT}/drafts/outline.md`]: '# Outline\n',
  [`${ROOT}/glossary.md`]: '# Glossary\n',
});

async function prepare(page: Page, scheme: 'light' | 'dark', seed: MockSeed) {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.clock.setFixedTime(FROZEN);
  await seedMock(page, seed);
  await page.goto('/');
}

const settled = async (page: Page) => {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
};

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`C37 visual baselines, ${scheme}`, () => {
    test(`C37 Files tab (${scheme})`, async ({ page }) => {
      await prepare(page, scheme, {
        files: files(),
        launch: { openPath: `${ROOT}/README.md`, view: 'split', folderPath: ROOT },
      });
      await expect(preview(page).locator('h1')).toHaveText('Field notes');
      await page.getByTestId('sidebar-tab-files').click();
      await expect(page.getByTestId('files-tree')).toBeVisible();
      await page.locator(`[data-testid="files-row"][data-path="${ROOT}/analysis"]`).click();
      await expect(
        page.locator(`[data-testid="files-row"][data-path="${ROOT}/analysis/plan.md"]`),
      ).toBeVisible();
      await settled(page);
      await expect(page).toHaveScreenshot(`c37-files-${scheme}.png`, SHOT);
    });

    test(`C37 Search with results (${scheme})`, async ({ page }) => {
      await prepare(page, scheme, {
        files: files(),
        searchResults: {
          lantern: {
            files: [
              {
                path: `${ROOT}/README.md`,
                matches: [
                  { line: 3, text: 'The lantern project began in spring.', ranges: [[4, 11]] },
                  { line: 10, text: 'a lantern count is easy to get wrong.', ranges: [[2, 9]] },
                ],
              },
              {
                path: `${ROOT}/analysis/plan.md`,
                matches: [{ line: 3, text: 'lantern', ranges: [[0, 7]] }],
              },
              {
                path: `${ROOT}/drafts/report.md`,
                matches: [{ line: 3, text: 'lantern', ranges: [[0, 7]] }],
              },
            ],
          },
        },
        launch: { openPath: `${ROOT}/README.md`, view: 'split', folderPath: ROOT },
      });
      await expect(preview(page).locator('h1')).toHaveText('Field notes');
      await menu(page, 'search-folder');
      await page.getByTestId('search-input').fill('lantern');
      await expect(page.getByTestId('search-file')).toHaveCount(3);
      await settled(page);
      await expect(page).toHaveScreenshot(`c37-search-${scheme}.png`, SHOT);
    });

    test(`C37 Quick Open (${scheme})`, async ({ page }) => {
      await prepare(page, scheme, {
        files: files(),
        launch: { openPath: `${ROOT}/README.md`, view: 'split', folderPath: ROOT },
      });
      await expect(preview(page).locator('h1')).toHaveText('Field notes');
      await menu(page, 'quick-open');
      await expect(page.getByTestId('picker')).toBeVisible();
      await expect.poll(() => page.getByTestId('picker-row').count()).toBeGreaterThan(4);
      await page.getByTestId('picker-input').fill('res');
      await expect(page.getByTestId('picker-match').first()).toBeVisible();
      await settled(page);
      await expect(page).toHaveScreenshot(`c37-quickopen-${scheme}.png`, SHOT);
    });

    test(`C37 preview find bar (${scheme})`, async ({ page }) => {
      await prepare(page, scheme, {
        files: files(),
        launch: { openPath: `${ROOT}/README.md`, view: 'preview' },
      });
      await expect(preview(page).locator('h1')).toHaveText('Field notes');
      await menu(page, 'find');
      await page.getByTestId('preview-find-input').fill('lantern');
      await expect(page.getByTestId('preview-find-count')).toHaveText('1 of 4');
      await settled(page);
      await expect(page).toHaveScreenshot(`c37-previewfind-${scheme}.png`, SHOT);
    });
  });
}
