/**
 * The Phase 3 shell framework: the sidebar tab host, the command
 * registry behind the menu, the banner slot, Copy Path through the clipboard method, the lazy
 * modules and `[[Note#` heading completion. Run with WD_UI_PORT=1463.
 */
import { expect, type Page, test } from '@playwright/test';
import { editor, HOME, menu, seedMock } from './helpers';

const NOTE = `${HOME}/note.md`;
const VAULT = `${HOME}/Vault`;

/** The URLs of every script the page has loaded so far. */
async function loadedModules(page: Page): Promise<string[]> {
  return page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
}

const PHASE3_MODULES = [
  '/src/shell/files/',
  '/src/shell/search/',
  '/src/shell/quickopen/',
  '/src/shell/palette/',
  '/src/shell/watch',
  '/src/shell/session',
  '/src/export/',
  '/src/preview/find/',
  '/src/editor/paste/',
];

test.describe('sidebar tabs', () => {
  test.beforeEach(async ({ page }) => {
    await seedMock(page, {
      files: { [NOTE]: '# Alpha\n\n## Beta\n' },
      launch: { openPath: NOTE, view: 'split' },
    });
    await page.goto('/');
    await expect(page.getByTestId('outline-item')).toHaveCount(2);
  });

  test('Outline, Files, Search and Snippets form a tab list, and Outline is selected', async ({
    page,
  }) => {
    const list = page.getByRole('tablist', { name: 'Sidebar' });
    // Only the selected tab shows its label; the others are icons with the label as their name.
    expect(
      await list
        .getByRole('tab')
        .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('aria-label'))),
    ).toEqual(['Outline', 'Files', 'Search', 'Snippets']);
    await expect(page.getByRole('tab', { name: 'Outline' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tabpanel')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Document outline' })).toBeVisible();
  });

  test('the arrow keys move between the tabs and show their panels', async ({ page }) => {
    await page.getByRole('tab', { name: 'Outline' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Files' })).toBeFocused();
    await expect(page.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('files-empty')).toContainText('No folder open');
    await expect(page.getByRole('button', { name: 'Open Folder…' })).toBeVisible();

    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('search-empty')).toHaveText('Open a folder to search it');

    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Snippets' })).toBeFocused();
    await expect(page.getByTestId('snippets-panel')).toBeVisible();

    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Outline' })).toBeFocused();
    await expect(page.getByTestId('outline-item')).toHaveCount(2);
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'Snippets' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('only the selected tab is a tab stop', async ({ page }) => {
    const stops = await page
      .getByRole('tab')
      .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('tabindex')));
    expect(stops).toEqual(['0', '-1', '-1', '-1']);
  });

  test('Open Folder… in the empty Files tab asks for a folder; cancelling keeps the empty state', async ({
    page,
  }) => {
    await page.getByRole('tab', { name: 'Files' }).click();
    await page.getByRole('button', { name: 'Open Folder…' }).click();
    await expect
      .poll(() => page.evaluate(() => window.__BACKTICKLE_MOCK__?.folderDialogs))
      .toEqual(['open']);
    await expect(page.getByTestId('files-empty')).toBeVisible();
  });
});

test.describe('commands', () => {
  test.beforeEach(async ({ page }) => {
    await seedMock(page, {
      files: { [NOTE]: '# Alpha\n\nBody text.\n' },
      launch: { openPath: NOTE, view: 'split' },
      pandoc: { path: '/mock/pandoc', version: '3.8.3' },
    });
    await page.goto('/');
    await expect(page.getByTestId('document-name')).toHaveText('note.md');
  });

  test('C35: the menu state carries hasPath and canExportDocx', async ({ page }) => {
    await expect
      .poll(() =>
        page.evaluate(() => {
          const last = window.__BACKTICKLE_MOCK__?.menuStates.at(-1);
          return last ? [last.hasPath, last.canExportDocx] : null;
        }),
      )
      .toEqual([true, true]);
  });

  test('Search in Folder shows the Search tab', async ({ page }) => {
    await menu(page, 'search-folder');
    await expect(page.getByRole('tab', { name: 'Search' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByTestId('search-empty')).toBeVisible();
  });

  test('Copy Path in the document menu writes the path through the clipboard method', async ({
    page,
  }) => {
    await page.getByTestId('document-menu-button').click();
    await page.getByRole('menuitem', { name: 'Copy Path' }).click();
    await expect
      .poll(() => page.evaluate(() => window.__BACKTICKLE_MOCK__?.clipboardWrites.at(-1)))
      .toEqual({ text: NOTE, html: null });
  });

  test('the flavor menu has no "Renders as GFM" note', async ({ page }) => {
    await page.getByTestId('flavor-pill').click();
    await expect(page.getByTestId('flavor-menu')).not.toContainText('Renders as GFM');
    await expect(page.getByTestId('flavor-note')).toHaveCount(0);
  });

  test('C35: a GFM document loads none of the Phase 3 modules', async ({ page }) => {
    const loaded = await loadedModules(page);
    for (const part of PHASE3_MODULES) {
      expect(
        loaded.filter((url) => url.includes(part)),
        part,
      ).toEqual([]);
    }
  });
});

test('the welcome screen loads none of the Phase 3 modules', async ({ page }) => {
  await seedMock(page, { launch: { welcome: true } });
  await page.goto('/');
  await expect(page.getByTestId('welcome')).toBeVisible();
  const loaded = await loadedModules(page);
  for (const part of PHASE3_MODULES) {
    expect(
      loaded.filter((url) => url.includes(part)),
      part,
    ).toEqual([]);
  }
});

test('[[Note# offers the headings of that note in an Obsidian document', async ({ page }) => {
  await seedMock(page, {
    files: {
      [`${VAULT}/Home.md`]: '# Home\n',
      [`${VAULT}/Notes/Plan.md`]: '# Plan\n\n## Goals\n\n## Risks\n',
    },
    vault: { root: VAULT },
    vaults: [VAULT],
    launch: { openPath: `${VAULT}/Home.md`, view: 'split' },
  });
  await page.goto('/');
  await expect(page.getByTestId('flavor-pill')).toContainText('Obsidian');
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n[[Plan#');

  await expect(page.getByRole('option', { name: /Goals/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /Risks/ })).toBeVisible();
});
