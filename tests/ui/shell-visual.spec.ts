/**
 * A31 visual baselines, light and dark, at 1280 x 820: the welcome screen, the split view with
 * the wireframe sample (sidebar open), and the preview of the GFM guide. Animations are off, the
 * text caret is hidden and the clock is frozen, so the same build gives the same pixels. The
 * first baselines are generated with `--update-snapshots` and approved by a person against the
 * Stitch screenshots; after that a difference fails the test.
 */
import { expect, type Page, test } from '@playwright/test';
import { fixture, HOME, menu, preview, seedMock } from './helpers';

const SPEC = `${HOME}/Product_Spec_v2.4.md`;
const NOTES = `${HOME}/Notes/Meeting.md`;
const FROZEN = new Date('2026-10-05T09:00:00Z');

async function prepare(page: Page, scheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.clock.setFixedTime(FROZEN);
}

const settled = async (page: Page) => {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
};

const SHOT = { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.002 } as const;

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`A31 visual baselines, ${scheme}`, () => {
    test(`A31 welcome screen (${scheme})`, async ({ page }) => {
      await prepare(page, scheme);
      await seedMock(page, {
        recents: [SPEC, NOTES],
        files: { [SPEC]: fixture('wireframe-sample.md'), [NOTES]: '# Meeting\n' },
      });
      await page.goto('/');
      await expect(page.getByTestId('recent-item')).toHaveCount(2);
      await settled(page);
      await expect(page).toHaveScreenshot(`welcome-${scheme}.png`, SHOT);
    });

    test(`A31 split view with the wireframe sample (${scheme})`, async ({ page }) => {
      await prepare(page, scheme);
      await seedMock(page, {
        files: { [SPEC]: fixture('wireframe-sample.md') },
        launch: { openPath: SPEC, view: 'split' },
      });
      await page.goto('/');
      await expect(page.getByTestId('outline-item')).toHaveCount(5);
      await expect(preview(page).locator('.code-card pre code span').first()).toBeAttached();
      await expect(preview(page).locator('.code-card-actions button').first()).toBeVisible();
      await settled(page);
      await expect(page).toHaveScreenshot(`split-wireframe-${scheme}.png`, SHOT);
    });

    test(`A31 preview of the GFM guide (${scheme})`, async ({ page }) => {
      await prepare(page, scheme);
      await seedMock(page, {});
      await page.goto('/');
      await expect(page.getByTestId('welcome')).toBeVisible();
      await menu(page, 'markdown-guide');
      await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'preview');
      await expect(page.getByTestId('outline-item').first()).toBeVisible();
      await expect(preview(page).locator('.code-card-actions button').first()).toBeVisible();
      await expect(preview(page).locator('math').first()).toBeAttached();
      await settled(page);
      await expect(page).toHaveScreenshot(`preview-gfm-guide-${scheme}.png`, SHOT);
    });
  });
}
