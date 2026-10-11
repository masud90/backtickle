/**
 * Phase 4 acceptance D35: with the default settings the pixels equal the baselines taken before
 * Phase 4 (tests/ui/shell-visual.spec.ts-snapshots, reached through a symlink; never regenerated
 * here). The three screens and the setup repeat A31 on purpose. Run with WD_UI_PORT=1487.
 */
import { expect, type Page, test } from '@playwright/test';
import { fixture, HOME, menu, preview, seedMock } from '../helpers';

const SPEC = `${HOME}/Product_Spec_v2.4.md`;
const NOTES = `${HOME}/Notes/Meeting.md`;
const FROZEN = new Date('2026-10-05T09:00:00Z');
const SHOT = { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.002 } as const;

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

for (const scheme of ['light', 'dark'] as const) {
  test(`D35 defaults: welcome screen matches the pre-Phase 4 baseline (${scheme})`, async ({
    page,
  }) => {
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

  test(`D35 defaults: split view with the wireframe sample matches the baseline (${scheme})`, async ({
    page,
  }) => {
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

  test(`D35 defaults: GFM guide preview matches the baseline (${scheme})`, async ({ page }) => {
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
}
