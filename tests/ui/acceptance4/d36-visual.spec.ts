/**
 * Phase 4 acceptance D36: new visual baselines for dyslexia mode on a guide, the reading ruler
 * (editor and preview) and the main window at interface scale 1.5, in light and dark. The
 * Preferences categories already have baselines (tests/ui/prefs-visual.spec.ts). Generate with
 * `--update-snapshots` for this file only; a person approves the images. Run with WD_UI_PORT=1487.
 */
import { expect, type Page, test } from '@playwright/test';
import { editor, preview, startGuide } from './support';

const SHOT = { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.002 } as const;
const FROZEN = new Date('2026-10-05T09:00:00Z');

async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`D36 baselines (${scheme})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.clock.setFixedTime(FROZEN);
    });

    test(`D36 dyslexia mode on the GFM guide (${scheme})`, async ({ page }) => {
      await startGuide(
        page,
        { a11y: { dyslexia: true, dyslexiaFont: 'opendyslexic' } },
        { view: 'preview' },
      );
      await settled(page);
      await expect(page).toHaveScreenshot(`dyslexia-guide-${scheme}.png`, SHOT);
    });

    test(`D36 reading ruler in the editor and the preview (${scheme})`, async ({ page }) => {
      await startGuide(page, { a11y: { ruler: true, rulerTint: 'yellow' } });
      await editor(page).click();
      await page.keyboard.press('ControlOrMeta+Home');
      for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
      const box = await preview(page).locator('p').first().boundingBox();
      if (!box) throw new Error('no paragraph');
      await page.mouse.move(box.x + 40, box.y + 6);
      await expect(page.locator('.wd-preview-ruler')).toBeVisible();
      await settled(page);
      await expect(page).toHaveScreenshot(`ruler-split-${scheme}.png`, SHOT);
    });

    test(`D36 main window at interface scale 1.5 (${scheme})`, async ({ page }) => {
      await startGuide(page, { a11y: { scale: 1.5 } });
      await settled(page);
      await expect(page).toHaveScreenshot(`scale-1-5-split-${scheme}.png`, SHOT);
    });
  });
}
