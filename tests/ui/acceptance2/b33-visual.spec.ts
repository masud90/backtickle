/**
 * Phase 2 acceptance B33: visual baselines, light and dark, at 1280 x 820: the Pandoc, Quarto,
 * Obsidian and MDX guides in Split view, and a Mermaid diagram. Animations are off, the caret is
 * hidden and the clock is frozen. The baselines are generated with `--update-snapshots` and
 * approved by a person; after that a difference fails the test. Run with WD_UI_PORT=1451.
 */
import { type Page, test } from '@playwright/test';
import {
  DOCS,
  expect,
  launch,
  menu,
  openDoc,
  preview,
  setView,
  VAULT_ROOT,
  vaultSeed,
} from './support-b2';

const FROZEN = new Date('2026-10-05T09:00:00Z');
const SHOT = { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.002 } as const;

async function prepare(page: Page, scheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.clock.setFixedTime(FROZEN);
}

const settled = async (page: Page) => {
  await expect
    .poll(() =>
      preview(page).locator('.mermaid-diagram:not(.mermaid-rendered):not(.mermaid-failed)').count(),
    )
    .toBe(0);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.waitForTimeout(400);
};

/** Opens the flavor's guide as the only tab, in Split view. */
async function guide(page: Page, start: { path: string; text: string } | 'vault', title: string) {
  if (start === 'vault') {
    await launch(page, { seed: vaultSeed(), open: `${VAULT_ROOT}/Home.md`, view: 'split' });
  } else {
    await launch(page, {
      seed: { files: { [start.path]: start.text } },
      open: start.path,
      view: 'split',
    });
  }
  await menu(page, 'markdown-guide');
  await expect(page.getByTestId('document-name')).toHaveText(title);
  await page.getByTestId('tab').first().click();
  await menu(page, 'close-tab');
  await expect(page.getByTestId('tab-strip')).toHaveCount(0);
  await expect(page.getByTestId('document-name')).toHaveText(title);
  await setView(page, 'split');
  await expect(page.getByTestId('outline-item').first()).toBeVisible();
}

const GUIDES: Array<{
  id: string;
  title: string;
  start: { path: string; text: string } | 'vault';
  ready: string;
}> = [
  {
    id: 'pandoc',
    title: 'Pandoc / MMD Guide',
    start: { path: `${DOCS}/start.mmd`, text: 'Title: Start\n\nText.\n' },
    ready: '.footnotes',
  },
  {
    id: 'quarto',
    title: 'Quarto / RMD Guide',
    start: { path: `${DOCS}/start.qmd`, text: '# Q\n\nText.\n' },
    ready: '.tabset [role="tab"]',
  },
  { id: 'obsidian', title: 'Obsidian Guide', start: 'vault', ready: '.callout' },
  {
    id: 'mdx',
    title: 'MDX Guide',
    start: { path: `${DOCS}/start.mdx`, text: '# M\n\nText.\n' },
    ready: '.mdx-component',
  },
];

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`B33 visual baselines, ${scheme}`, () => {
    for (const g of GUIDES) {
      test(`B33 ${g.id} guide in Split (${scheme})`, async ({ page }) => {
        await prepare(page, scheme);
        await guide(page, g.start, g.title);
        await expect(preview(page).locator(g.ready).first()).toBeAttached();
        await settled(page);
        await expect(page).toHaveScreenshot(`guide-${g.id}-split-${scheme}.png`, SHOT);
      });
    }

    test(`B33 a Mermaid diagram (${scheme})`, async ({ page }) => {
      await prepare(page, scheme);
      const text = [
        '# Diagram',
        '',
        '```mermaid',
        'flowchart LR',
        '    A[Draft] --> B{Review}',
        '    B -->|approved| C[Publish]',
        '    B -->|changes| A',
        '```',
        '',
      ].join('\n');
      await openDoc({ page, path: `${DOCS}/diagram.md`, text });
      await settled(page);
      await expect(preview(page).locator('.mermaid-diagram.mermaid-rendered')).toHaveCount(1);
      await expect(preview(page).locator('.mermaid-diagram')).toHaveScreenshot(
        `mermaid-${scheme}.png`,
        SHOT,
      );
    });
  });
}
