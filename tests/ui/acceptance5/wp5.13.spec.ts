/** WP5.13 acceptance: Render with Quarto, on the mock. Run with WD_UI_PORT=1503. */
import { expect, type Page, test } from '@playwright/test';
import { HOME, menu, seedMock } from '../helpers';

async function open(
  page: Page,
  name: string,
  extra: Record<string, unknown> = {},
  text = '# Title\n\nText.\n',
): Promise<string> {
  const doc = `${HOME}/docs/${name}`;
  await seedMock(page, {
    files: { [doc]: text },
    launch: { openPath: doc, view: 'split' },
    ...extra,
  });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');
  await expect(page.getByTestId('preview').locator('h1').first()).toBeVisible();
  return doc;
}

const can = (page: Page) =>
  page.evaluate(() => window.__BACKTICKLE_MOCK__?.menuStates.at(-1)?.canRender);
const renders = (page: Page) =>
  page.evaluate(() => window.__BACKTICKLE_MOCK__?.renderRequests ?? []);

test.describe('E5.13 Render with Quarto', () => {
  for (const [name, expected] of [
    ['a.qmd', true],
    ['b.Rmd', true],
    ['c.md', false],
    ['d.mdx', false],
  ] as const) {
    test(`E5.13-1 enabled state for ${name}`, async ({ page }) => {
      await open(page, name);
      await expect.poll(() => can(page)).toBe(expected);
    });
  }

  test('E5.13-2 an untitled document cannot be rendered', async ({ page }) => {
    await seedMock(page, {});
    await page.goto('/');
    await menu(page, 'new');
    await expect.poll(() => can(page)).toBe(false);
  });

  test('E5.13-3 with RStudio the banner says to press Render there', async ({ page }) => {
    const doc = await open(page, 'a.qmd', { renderWithQuarto: { target: 'rstudio' } });
    await menu(page, 'render-quarto');
    await expect(page.getByTestId('notice-banner')).toContainText(
      'Opened in RStudio. Press Render (⇧⌘K) there.',
    );
    expect(await renders(page)).toEqual([doc]);
    await page.getByTestId('notice-banner').getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByTestId('notice-banner')).toHaveCount(0);
  });

  test('E5.13-4 without RStudio the render goes to Terminal', async ({ page }) => {
    const doc = await open(page, 'b.Rmd', { renderWithQuarto: { target: 'terminal' } });
    await menu(page, 'render-quarto');
    await expect(page.getByTestId('notice-banner')).toContainText('Terminal');
    expect(await renders(page)).toEqual([doc]);
  });

  test('E5.13-5 unsaved changes ask first; Cancel renders nothing', async ({ page }) => {
    await open(page, 'a.qmd', { ask: false });
    await page.getByTestId('editor').click();
    await page.keyboard.type('more ');
    await menu(page, 'render-quarto');
    await expect
      .poll(() => page.evaluate(() => window.__BACKTICKLE_MOCK__?.asks.at(-1)?.ok))
      .toBe('Save and Render');
    expect(await renders(page)).toEqual([]);
    expect(await page.evaluate(() => window.__BACKTICKLE_MOCK__?.saves.length)).toBe(0);
  });

  test('E5.13-6 Save and Render saves, then renders', async ({ page }) => {
    const doc = await open(page, 'a.qmd', { ask: true });
    await page.getByTestId('editor').click();
    await page.keyboard.type('more ');
    await menu(page, 'render-quarto');
    await expect.poll(() => renders(page)).toEqual([doc]);
    expect(await page.evaluate(() => window.__BACKTICKLE_MOCK__?.saves.length)).toBe(1);
  });

  test('E5.13-7 a failure shows the error banner', async ({ page }) => {
    await open(page, 'a.qmd', { renderWithQuarto: { error: 'Terminal could not be found.' } });
    await menu(page, 'render-quarto');
    await expect(page.getByRole('alert')).toContainText('Terminal could not be found.');
  });

  test('E5.13-8 the palette lists the command', async ({ page }) => {
    await open(page, 'a.qmd');
    await menu(page, 'command-palette');
    await page.getByTestId('picker-input').fill('render with');
    await expect(page.getByTestId('picker')).toContainText('Render with Quarto');
  });
});
