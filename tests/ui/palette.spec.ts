/** Command palette against the mock platform. */
import { expect, type Page, test } from '@playwright/test';
import type { MockSeed } from '../../src/lib/platform-mock';
import { HOME, menu, seedMock } from './helpers';

const DOC = `${HOME}/note.md`;

async function start(page: Page, extra: Partial<MockSeed> = {}) {
  await seedMock(page, { files: { [DOC]: '# Note\n\nbody\n' }, ...extra });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');
}

const rows = (page: Page) => page.getByTestId('picker-row');
const labels = (page: Page) =>
  rows(page).evaluateAll((els) => els.map((el) => el.querySelector('span')?.textContent?.trim()));

test.describe('C20 Command palette', () => {
  test('lists the enabled commands with their shortcuts', async ({ page }) => {
    await start(page, { launch: { openPath: DOC } });
    await expect(page.getByTestId('document-name')).toBeVisible();
    await menu(page, 'command-palette');
    await expect(page.getByTestId('picker')).toBeVisible();
    const row = (name: string) => rows(page).filter({ hasText: name }).first();
    await expect(row('Save As…')).toContainText('⇧⌘S');
    await expect(row('Quick Open…')).toContainText('⇧⌘O');
    await expect(row('Flavor: Pandoc / MMD')).toBeVisible();
    await expect(row('Show Search')).toBeVisible();
    // The palette does not list itself, and a command that needs more than it has is absent.
    expect(await labels(page)).not.toContain('Command Palette…');
    expect(await labels(page)).not.toContain('Show Next Tab'); // needs two tabs
  });

  test('without a document only the commands that need none are listed', async ({ page }) => {
    await start(page, { launch: { welcome: true } });
    await expect(page.getByTestId('welcome')).toBeVisible();
    await menu(page, 'command-palette');
    await expect.poll(() => rows(page).count()).toBeGreaterThan(3);
    const names = await labels(page);
    expect(names).toContain('New');
    expect(names).toContain('Open Folder…');
    expect(names).not.toContain('Save As…');
    expect(names).not.toContain('Bold');
  });

  test('filters by fuzzy match and marks the characters', async ({ page }) => {
    await start(page, { launch: { openPath: DOC } });
    await expect(page.getByTestId('document-name')).toBeVisible();
    await menu(page, 'command-palette');
    await page.getByTestId('picker-input').fill('vsplit');
    await expect(rows(page).first()).toContainText('View: Split');
    expect((await page.getByTestId('picker-match').allTextContents()).join('')).toBe('VSplit');
  });

  test('Return runs a view switch', async ({ page }) => {
    await start(page, { launch: { openPath: DOC } });
    await expect(page.getByTestId('document-name')).toBeVisible();
    await menu(page, 'command-palette');
    await page.getByTestId('picker-input').fill('view: split');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('picker')).toHaveCount(0);
    await expect(page.getByTestId('preview')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Markdown source' })).toBeVisible();
  });

  test('a click runs a flavor choice', async ({ page }) => {
    await start(page, { launch: { openPath: DOC } });
    await expect(page.getByTestId('document-name')).toBeVisible();
    await menu(page, 'command-palette');
    await page.getByTestId('picker-input').fill('Flavor: Pandoc');
    await rows(page).first().click();
    await expect(page.getByTestId('status-flavor')).toContainText('Pandoc');
  });

  test('a sidebar tab command shows that tab', async ({ page }) => {
    await start(page, { launch: { openPath: DOC } });
    await expect(page.getByTestId('document-name')).toBeVisible();
    await menu(page, 'command-palette');
    await page.getByTestId('picker-input').fill('Show Files');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('sidebar-tab-files')).toHaveAttribute('aria-selected', 'true');
  });

  test('Escape closes the palette', async ({ page }) => {
    await start(page, { launch: { openPath: DOC } });
    await expect(page.getByTestId('document-name')).toBeVisible();
    await menu(page, 'command-palette');
    await expect(page.getByTestId('picker-input')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('picker')).toHaveCount(0);
  });
});
