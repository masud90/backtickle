/**
 * Phase 4 accessibility audit: axe-core with the WCAG 2.0 to 2.2 A and AA tags on every
 * surface, light and dark, at interface scale 1.0 and 1.5 and with dyslexia mode on.
 * Run with WD_UI_PORT=1485.
 */

import { test } from '@playwright/test';
import { SETTING_CATEGORIES } from '../../../src/lib/settings-meta';
import {
  CONFIGS,
  DOCS,
  expect,
  FLAVOR_DOCS,
  launch,
  menu,
  openMain,
  openPrefsWith,
  VAULT_ROOT,
  vaultSeed,
  violations,
} from './support';

for (const config of CONFIGS) {
  test.describe(`axe ${config.name}`, () => {
    test(`welcome screen (${config.name})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: config.scheme });
      await launch(page, { seed: { settings: { a11y: config.a11y } } });
      expect(await violations(page)).toEqual([]);
    });

    for (const view of ['editor', 'split', 'preview'] as const) {
      test(`main window in ${view} (${config.name})`, async ({ page }) => {
        await openMain(page, config, { view });
        expect(await violations(page)).toEqual([]);
      });
    }

    for (const [flavor, path] of Object.entries(FLAVOR_DOCS)) {
      test(`${flavor} guide in split (${config.name})`, async ({ page }) => {
        await openMain(page, config, { path, seed: { files: { [path]: '# S\n\nText.\n' } } });
        await menu(page, 'markdown-guide');
        await page.getByTestId('tab').nth(1).waitFor();
        expect(await violations(page)).toEqual([]);
      });
    }

    test(`Obsidian guide (${config.name})`, async ({ page }) => {
      await openMain(page, config, { path: `${VAULT_ROOT}/Home.md`, seed: vaultSeed() });
      await menu(page, 'markdown-guide');
      await page.getByTestId('tab').nth(1).waitFor();
      expect(await violations(page)).toEqual([]);
    });

    for (const tab of ['outline', 'files', 'search']) {
      test(`sidebar ${tab} tab (${config.name})`, async ({ page }) => {
        await openMain(page, config);
        await page.getByTestId(`sidebar-tab-${tab}`).click();
        await expect(page.getByTestId('sidebar-panel')).toBeVisible();
        expect(await violations(page)).toEqual([]);
      });
    }

    test(`Quick Open and the palette (${config.name})`, async ({ page }) => {
      await openMain(page, config);
      await menu(page, 'quick-open');
      await expect(page.getByTestId('picker')).toBeVisible();
      expect(await violations(page), 'Quick Open').toEqual([]);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('picker')).toHaveCount(0);
      await menu(page, 'command-palette');
      await expect(page.getByTestId('picker')).toBeVisible();
      expect(await violations(page), 'palette').toEqual([]);
    });

    test(`both find bars (${config.name})`, async ({ page }) => {
      await openMain(page, config);
      await page.getByTestId('editor').click();
      await menu(page, 'find-replace');
      await expect(page.locator('.cm-search')).toBeVisible();
      expect(await violations(page), 'editor find and replace').toEqual([]);
      await openMain(page, config, { view: 'preview' });
      await menu(page, 'find');
      await expect(page.getByTestId('preview-find')).toBeVisible();
      expect(await violations(page), 'preview find').toEqual([]);
    });

    test(`title menu (${config.name})`, async ({ page }) => {
      await openMain(page, config);
      await page.getByTestId('document-menu-button').click();
      await expect(page.getByRole('menu').first()).toBeVisible();
      // The open menu covers some toolbar buttons on purpose, so target-size is off for this surface.
      expect(await violations(page, undefined, ['target-size']), 'title menu').toEqual([]);
    });

    test(`banner: read-only (${config.name})`, async ({ page }) => {
      const path = `${DOCS}/locked.md`;
      await openMain(page, config, {
        path,
        seed: { files: { [path]: { text: '# T\n\nText.\n', readOnly: true } } },
      });
      await expect(page.getByTestId('banner-readOnly')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    for (const category of SETTING_CATEGORIES) {
      test(`Preferences ${category.id} (${config.name})`, async ({ page }) => {
        await openPrefsWith(page, config);
        await page.getByTestId(`category-${category.id}`).click();
        expect(await violations(page)).toEqual([]);
      });
    }

    test(`Preferences search results (${config.name})`, async ({ page }) => {
      await openPrefsWith(page, config);
      await page.getByTestId('prefs-search').fill('font');
      await expect(page.getByTestId('prefs-content')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  });
}
