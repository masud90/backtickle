/** The flavor framework in the shell: the guide follows the flavor. */
import { expect, test } from '@playwright/test';
import { HOME, menu, seedMock } from './helpers';

const QMD = `${HOME}/Documents/analysis.qmd`;

test.describe('flavor guides', () => {
  test('Help > Markdown Guide opens the guide of the active document flavor', async ({ page }) => {
    await seedMock(page, {
      launch: { openPath: QMD, view: 'split' },
      files: { [QMD]: '# Analysis\n\nText.\n' },
    });
    await page.goto('/');
    await expect(page.getByTestId('document-name')).toHaveText('analysis.qmd');
    await menu(page, 'markdown-guide');
    await expect(page.getByTestId('document-name')).toHaveText('Quarto / RMD Guide');
    await expect(page.getByTestId('flavor-pill')).toContainText('Quarto / RMD');
    // Asking again activates the same guide instead of opening another tab.
    await page.getByTestId('tab-strip').getByRole('tab', { name: 'analysis.qmd' }).click();
    await menu(page, 'markdown-guide');
    await expect(page.getByTestId('document-name')).toHaveText('Quarto / RMD Guide');
    await expect(page.getByTestId('tab')).toHaveCount(2);
  });

  test('without a document the guide is the GFM Markdown Guide', async ({ page }) => {
    await seedMock(page, {});
    await page.goto('/');
    await menu(page, 'markdown-guide');
    await expect(page.getByTestId('document-name')).toHaveText('Markdown Guide');
    await expect(page.getByTestId('flavor-pill')).toContainText('GFM');
  });
});
