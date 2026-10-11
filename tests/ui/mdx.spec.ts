/**
 * MDX in the real app ("MDX", B23, B24): the components render, an edit that breaks the
 * JSX shows the error banner and keeps the last preview, "Go to line" moves the caret, and the fix
 * removes the banner. Run with WD_UI_PORT=1447.
 */
import { expect, test } from '@playwright/test';
import { editor, fixture, HOME, preview, seedMock, statusText } from './helpers';

const PATH = `${HOME}/Documents/components.mdx`;

test.beforeEach(async ({ page }) => {
  await seedMock(page, {
    launch: { openPath: PATH, view: 'split' },
    files: { [PATH]: fixture('flavors/mdx/components.mdx') },
  });
  await page.goto('/');
  await expect(page.getByTestId('document-name')).toHaveText('components.mdx');
});

test('the components, ESM and expressions render', async ({ page }) => {
  await expect(page.getByTestId('flavor-pill')).toContainText('MDX');
  const pane = preview(page);
  await expect(pane.locator('div.mdx-component[data-name="Callout"]')).toBeVisible();
  await expect(pane.locator('div.mdx-component[data-name="Callout"] .mdx-prop')).toHaveCount(3);
  await expect(pane.locator('span.mdx-component.is-inline[data-name="Kbd"]')).toContainText('Cmd');
  await expect(pane.locator('details.mdx-esm')).toHaveCount(2);
  await expect(pane.locator('code.mdx-expression')).toHaveCount(2);
  await expect(pane.locator('div.doc-note')).toHaveText('plain');
  await expect(pane.locator('.mdx-error-banner')).toHaveCount(0);
  await expect(pane.locator('[style]')).toHaveCount(0);
});

test('a JSX error shows the banner and keeps the last preview; Go to line moves the caret; the fix removes it', async ({
  page,
}) => {
  const pane = preview(page);
  await expect(pane.locator('div.mdx-component[data-name="Callout"]')).toBeVisible();
  const lines = fixture('flavors/mdx/components.mdx').split('\n').length;

  // An unclosed tag at the end of the document.
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n<Broken>\n');
  const banner = page.locator('.mdx-error-banner');
  await expect(banner).toBeVisible();
  await expect(banner.locator('.mdx-error-text')).toContainText('MDX error on line');
  await expect(banner.locator('.mdx-error-text')).toContainText('Broken');
  // The last good preview is still there.
  await expect(pane.locator('div.mdx-component[data-name="Callout"]')).toBeVisible();

  // Move the caret away, then Go to line.
  await page.keyboard.press('ControlOrMeta+Home');
  await expect(page.getByTestId('status-position')).toHaveText('Ln 1, Col 1');
  await banner.getByRole('button', { name: 'Go to line' }).click();
  const position = await statusText(page, 'status-position');
  const line = Number(/Ln (\d+)/.exec(position)?.[1]);
  expect(line).toBeGreaterThan(lines - 1);

  // Fix it: close the tag.
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('</Broken>\n');
  await expect(banner).toHaveCount(0);
  await expect(pane.locator('div.mdx-component[data-name="Broken"]')).toBeVisible();
});
