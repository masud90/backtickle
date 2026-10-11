/**
 * Phase 5 accessibility sweep: the surfaces added after the Phase 4
 * audit, with the same axe rules and the same six configurations as `axe.spec.ts`.
 * Run with WD_UI_PORT=1504.
 */
import { readFileSync } from 'node:fs';
import { test } from '@playwright/test';
import { CONFIGS, DOCS, expect, menu, openMain, openPrefsWith, violations } from './support';

const GRAPHS = readFileSync(new URL('../../fixtures/graphviz/graphs.md', import.meta.url), 'utf8');

for (const config of CONFIGS) {
  test.describe(`axe phase 5 ${config.name}`, () => {
    for (const flavor of ['commonmark', 'pandoc']) {
      test(`${flavor} guide in split (${config.name})`, async ({ page }) => {
        await openMain(page, config);
        await menu(page, 'command-palette');
        await page.getByTestId('picker-input').fill(flavor);
        await page.keyboard.press('Enter');
        await menu(page, 'markdown-guide');
        await page.getByTestId('tab').nth(1).waitFor();
        expect(await violations(page)).toEqual([]);
      });
    }

    test(`flavor pill menu open (${config.name})`, async ({ page }) => {
      await openMain(page, config);
      await page.getByTestId('flavor-pill').click();
      await expect(page.getByTestId('flavor-menu')).toBeVisible();
      // The open menu covers some controls on purpose, so target-size is off for this surface.
      expect(await violations(page, undefined, ['target-size'])).toEqual([]);
    });

    test(`Snippets tab (${config.name})`, async ({ page }) => {
      await openMain(page, config);
      await page.getByTestId('sidebar-tab-snippets').click();
      await expect(page.getByTestId('snippets-panel')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`Keyboard Shortcuts while recording (${config.name})`, async ({ page }) => {
      await openPrefsWith(page, config);
      await page.getByTestId('category-shortcuts').click();
      await page.getByTestId('shortcuts-File').waitFor();
      await page.locator('[data-command="bold"]').getByTestId('shortcut-change').click();
      expect(await violations(page)).toEqual([]);
    });

    test(`Graphviz document (${config.name})`, async ({ page }) => {
      const path = `${DOCS}/graphs.md`;
      await openMain(page, config, { path, seed: { files: { [path]: GRAPHS } } });
      await expect(page.getByTestId('preview').locator('.graphviz-diagram')).toHaveCount(3);
      expect(await violations(page)).toEqual([]);
    });

    test(`Pandoc preview with the mock (${config.name})`, async ({ page }) => {
      const path = `${DOCS}/start.md`;
      await openMain(page, config, {
        path,
        seed: {
          files: { [path]: '# Title\n\nText with a [link](https://example.org).\n' },
          pandoc: { path: '/mock/pandoc', version: '3.8.3' },
          pandocPreview: {
            html: '<h1 id="title">Title</h1><p>Text with a <a href="https://example.org">link</a>.</p>',
          },
        },
      });
      await menu(page, 'toggle-exact-preview');
      await expect(page.getByTestId('pandoc-preview-content')).toContainText('Title');
      expect(await violations(page)).toEqual([]);
    });
  });
}
