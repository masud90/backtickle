/**
 * Phase 2 acceptance B32: axe-core finds no serious or critical issue (light and dark) on the
 * Quarto guide (with a tabset and a collapsed callout), the Obsidian guide, and the MDX guide with
 * the error banner showing. Run with WD_UI_PORT=1451.
 */
import AxeBuilder from '@axe-core/playwright';
import { type Page, test } from '@playwright/test';
import {
  DOCS,
  editorText,
  expect,
  insertAt,
  launch,
  menu,
  preview,
  VAULT_ROOT,
  vaultSeed,
} from './support-b2';

async function seriousViolations(page: Page): Promise<string[]> {
  // Mermaid diagrams render after the first paint: axe must see the finished pictures.
  await expect
    .poll(() =>
      page
        .locator(
          '[data-testid="preview"] .mermaid-diagram:not(.mermaid-rendered):not(.mermaid-failed)',
        )
        .count(),
    )
    .toBe(0);
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.impact} ${v.id}: ${v.help} (${v.nodes.length} nodes, first: ${v.nodes[0]?.target.join(' ')})`,
    );
}

/**
 * Opens the flavor's guide as the only tab: the guide opens next to the start document (which
 * gives the flavor), and the start document is then closed. Two tabs are checked on their own
 * below, because the tab strip has its own finding.
 */
async function guideAlone(page: Page, title: string): Promise<void> {
  await menu(page, 'markdown-guide');
  await expect(page.getByTestId('document-name')).toHaveText(title);
  await page.getByTestId('tab').first().click();
  await menu(page, 'close-tab');
  await expect(page.getByTestId('tab-strip')).toHaveCount(0);
  await expect(page.getByTestId('document-name')).toHaveText(title);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`B32 axe (${scheme})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
    });

    test(`B32 the Quarto guide with a tabset and a collapsed callout (${scheme})`, async ({
      page,
    }) => {
      const start = `${DOCS}/start.qmd`;
      await launch(page, {
        seed: { files: { [start]: '# Q\n\nText.\n' } },
        open: start,
        view: 'split',
      });
      await guideAlone(page, 'Quarto / RMD Guide');
      await expect(preview(page).locator('.tabset [role="tab"]').first()).toBeAttached();
      await expect(preview(page).locator('details.callout:not([open])').first()).toBeAttached();
      await expect(preview(page).locator('.code-chunk').first()).toBeAttached();
      expect(await seriousViolations(page), 'Quarto guide in split view').toEqual([]);
    });

    test(`B32 the Obsidian guide (${scheme})`, async ({ page }) => {
      await launch(page, { seed: vaultSeed(), open: `${VAULT_ROOT}/Home.md`, view: 'split' });
      await guideAlone(page, 'Obsidian Guide');
      await expect(preview(page).locator('.callout').first()).toBeAttached();
      await expect(preview(page).locator('a.wikilink').first()).toBeAttached();
      expect(await seriousViolations(page), 'Obsidian guide in split view').toEqual([]);
    });

    test(`B32 the MDX guide with the error banner (${scheme})`, async ({ page }) => {
      const start = `${DOCS}/start.mdx`;
      await launch(page, {
        seed: { files: { [start]: '# M\n\nText.\n' } },
        open: start,
        view: 'split',
      });
      await guideAlone(page, 'MDX Guide');
      await expect(preview(page).locator('.mdx-component').first()).toBeAttached();
      expect(await seriousViolations(page), 'MDX guide, no error').toEqual([]);
      const text = await editorText(page);
      await insertAt(page, text.length, '\n<Broken>\n');
      await expect(page.locator('.mdx-error-banner')).toBeVisible();
      expect(await seriousViolations(page), 'MDX guide with the error banner').toEqual([]);
    });
  });
}

test('B32 two open documents: the tab strip has no serious or critical issue', async ({ page }) => {
  const a = `${DOCS}/a.md`;
  const b = `${DOCS}/b.md`;
  await launch(page, { seed: { files: { [a]: '# A\n\ntext\n', [b]: '# B\n\ntext\n' } } });
  await page.evaluate(
    (paths) => {
      (
        window as unknown as { __BACKTICKLE_MOCK__: { openFiles(p: string[]): void } }
      ).__BACKTICKLE_MOCK__.openFiles(paths);
    },
    [a, b],
  );
  await expect(page.getByTestId('tab')).toHaveCount(2);
  expect(await seriousViolations(page), 'tab strip with two tabs').toEqual([]);
});
