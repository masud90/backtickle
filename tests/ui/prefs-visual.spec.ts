/**
 * D36 (Preferences part): a baseline of each category in light and dark at 960 x 720, the
 * window's opening size. Animations are off and the caret is hidden. The first baselines are
 * approved by a person against the Stitch wireframe.
 */
import { expect, test } from '@playwright/test';
import { SETTING_CATEGORIES } from '../../src/lib/settings-meta';
import { openPrefs } from './prefs-helpers';

const SHOT = { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.002 } as const;

for (const scheme of ['light', 'dark'] as const) {
  for (const entry of SETTING_CATEGORIES) {
    test(`D36 Preferences ${entry.id} (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 960, height: 720 });
      await openPrefs(page);
      await page.getByTestId(`category-${entry.id}`).click();
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      await expect(page).toHaveScreenshot(`prefs-${entry.id}-${scheme}.png`, SHOT);
    });
  }
}
