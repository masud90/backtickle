/**
 * Closing a tab keeps the other tabs' documents. With auto-save on, the active tab used to
 * vanish for a moment while the next one was activated, the workspace was taken down and made
 * again, and every other tab came back empty.
 */
import { expect, test } from '@playwright/test';
import { editor, HOME, menu, preview, seedMock, tabs } from './helpers';

const DOCS = `${HOME}/Documents`;
const FILES: Record<string, string> = {
  [`${DOCS}/a.md`]: '# Alpha\n\nText of a.\n',
  [`${DOCS}/b.md`]: '# Beta\n\nText of b.\n',
  [`${DOCS}/c.md`]: '# Gamma\n\nText of c.\n',
};

for (const autoSave of [false, true]) {
  test(`closing a tab leaves the others as they were (auto-save ${autoSave ? 'on' : 'off'})`, async ({
    page,
  }) => {
    await seedMock(page, {
      files: FILES,
      settings: { openExistingIn: 'split', saving: { autoSave } },
      launch: { welcome: true },
    });
    await page.goto('/');
    // The welcome screen means the shell listens for opened files.
    await expect(page.getByTestId('recent-empty')).toBeVisible();
    for (const path of Object.keys(FILES)) {
      await page.evaluate((p) => window.__BACKTICKLE_MOCK__?.openFiles([p]), path);
      await expect(preview(page)).toContainText(
        path.endsWith('a.md') ? 'Alpha' : path.endsWith('b.md') ? 'Beta' : 'Gamma',
      );
    }
    // An unsaved edit in the first tab must survive too (with its undo history).
    await tabs(page).first().click();
    await expect(preview(page)).toContainText('Alpha');
    if (!autoSave) {
      await editor(page).click();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.type('Edited.');
    }

    await tabs(page).nth(1).click();
    await expect(preview(page)).toContainText('Beta');
    await menu(page, 'close-tab');

    await expect(tabs(page)).toHaveCount(2);
    await expect(preview(page)).toContainText('Gamma');
    await expect(editor(page)).toContainText('Text of c.');
    await tabs(page).first().click();
    await expect(preview(page)).toContainText('Alpha');
    await expect(editor(page)).toContainText('Text of a.');
    if (!autoSave) {
      await expect(editor(page)).toContainText('Edited.');
      await editor(page).click();
      await page.keyboard.press('ControlOrMeta+z');
      await expect(editor(page)).not.toContainText('Edited.');
    }
  });
}
