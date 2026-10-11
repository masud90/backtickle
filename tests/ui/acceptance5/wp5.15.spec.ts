/** WP5.15: shortcut labels follow the overrides. Run with WD_UI_PORT=1504. */
import { expect, test } from '@playwright/test';
import { HOME, seedMock } from '../helpers';

const DOC = `${HOME}/docs/a.md`;

test('E5.15-1 toolbar tooltips and the Save key label use the effective shortcut table', async ({
  page,
}) => {
  await seedMock(page, {
    files: { [DOC]: '# T\n\nText.\n' },
    launch: { openPath: DOC, view: 'split' },
    settings: { shortcuts: { bold: '⌥⌘J', save: null, 'view-split': '⌥⌘2' } },
  });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');
  await expect(page.getByTestId('preview').locator('h1').first()).toBeVisible();
  await expect(page.getByTestId('tool-bold')).toHaveAttribute('title', 'Bold (⌥⌘J)');
  await expect(page.getByTestId('tool-italic')).toHaveAttribute('title', 'Italic (⌘I)');
  await expect(page.getByTestId('view-split')).toHaveAttribute('title', 'Split (⌥⌘2)');
  await expect(page.getByTestId('save-button').locator('kbd')).toHaveCount(0);
});
