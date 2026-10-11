/**
 * Phase 2 acceptance, Mermaid: B25. Fixtures in
 * `tests/fixtures/flavors/mermaid/`. Run with WD_UI_PORT=1451.
 */
import { test } from '@playwright/test';
import {
  DOCS,
  expect,
  fixture,
  launch,
  openDoc,
  preview,
  squash,
  VAULT_ROOT,
  vaultSeed,
} from './support-b2';

const DIAGRAMS = fixture('flavors/mermaid/diagrams.md');
const rendered = (page: import('@playwright/test').Page) =>
  preview(page).locator('.mermaid-diagram.mermaid-rendered svg');

/** A document with one flowchart per flavor fence style. */
const QUARTO = [
  '---',
  'title: Chart',
  '---',
  '',
  '```{mermaid}',
  'flowchart LR',
  '    Q1[Quarto one] --> Q2[Quarto two]',
  '```',
  '',
].join('\n');

test.describe('B25 Mermaid', () => {
  test('B25 GFM: flowchart, sequence and class diagrams render as SVG', async ({ page }) => {
    await openDoc({ page, path: `${DOCS}/diagrams.md`, text: DIAGRAMS });
    await expect(rendered(page)).toHaveCount(3);
    const kinds = await rendered(page).evaluateAll((svgs) =>
      svgs.map((s) => s.getAttribute('aria-roledescription')),
    );
    expect(kinds).toEqual(['flowchart-v2', 'sequence', 'classDiagram']);
    // The labels of the source are in the pictures.
    const first = squash((await rendered(page).nth(0).textContent()) ?? '');
    for (const label of ['First Node', 'Second Node', 'Third Node', 'Fourth Node', 'Fifth Node']) {
      expect(first).toContain(label);
    }
    const second = squash((await rendered(page).nth(1).textContent()) ?? '');
    for (const label of ['Alice', 'Bob', 'Charlie', 'Hello Bob', 'Hi Alice']) {
      expect(second).toContain(label);
    }
    // The fallback source is replaced by the SVG.
    await expect(
      preview(page).locator('.mermaid-diagram.mermaid-rendered pre.mermaid-source'),
    ).toHaveCount(0);
    await expect(preview(page).locator('.mermaid-diagram[data-diagram-key]')).toHaveCount(3);
  });

  test('B25 Obsidian: the vault note renders its diagram', async ({ page }) => {
    await launch(page, { seed: vaultSeed(), open: `${VAULT_ROOT}/Home.md`, view: 'preview' });
    await expect(rendered(page)).toHaveCount(1);
    const text = squash((await rendered(page).textContent()) ?? '');
    for (const label of ['Node A', 'Node B', 'Node C']) expect(text).toContain(label);
  });

  test('B25 Quarto: a {mermaid} chunk renders as a diagram, not as a code chunk', async ({
    page,
  }) => {
    await openDoc({ page, path: `${DOCS}/chart.qmd`, text: QUARTO });
    await expect(rendered(page)).toHaveCount(1);
    const text = squash((await rendered(page).textContent()) ?? '');
    expect(text).toContain('Quarto one');
    expect(text).toContain('Quarto two');
    await expect(preview(page).locator('.code-chunk[data-lang="mermaid"]')).toHaveCount(0);
  });

  test('B25 a syntax error shows the source and a muted message; the valid diagram still renders', async ({
    page,
  }) => {
    await openDoc({ page, path: `${DOCS}/error.md`, text: fixture('flavors/mermaid/error.md') });
    const failed = preview(page).locator('.mermaid-diagram.mermaid-failed');
    await expect(failed).toHaveCount(1);
    await expect(failed.locator('pre.mermaid-source')).toContainText('A[Start');
    await expect(failed.locator('pre.mermaid-source')).toContainText('A --> B');
    await expect(failed.locator('.mermaid-error')).toContainText(/error/i);
    await expect(failed.locator('svg')).toHaveCount(0);
    await expect(rendered(page)).toHaveCount(1);
    expect(squash((await rendered(page).textContent()) ?? '')).toContain('Another');
  });

  test('B25 the SVG carries no style attribute, no script and no foreignObject', async ({
    page,
  }) => {
    await openDoc({ page, path: `${DOCS}/diagrams.md`, text: DIAGRAMS });
    await expect(rendered(page)).toHaveCount(3);
    const found = await preview(page).evaluate((root) => {
      const svgs = [...root.querySelectorAll('.mermaid-diagram svg')];
      let styled = 0;
      let scripts = 0;
      let foreign = 0;
      let handlers = 0;
      for (const svg of svgs) {
        for (const el of [svg, ...svg.querySelectorAll('*')]) {
          if (el.hasAttribute('style')) styled++;
          for (const attr of el.attributes) if (/^on/i.test(attr.name)) handlers++;
        }
        scripts += svg.querySelectorAll('script').length;
        foreign += svg.querySelectorAll('foreignObject').length;
      }
      return { svgs: svgs.length, styled, scripts, foreign, handlers };
    });
    expect(found).toEqual({ svgs: 3, styled: 0, scripts: 0, foreign: 0, handlers: 0 });
  });

  test('B25 light and dark differ, and the diagram re-renders when the appearance changes', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await openDoc({ page, path: `${DOCS}/diagrams.md`, text: DIAGRAMS });
    await expect(rendered(page)).toHaveCount(3);
    const look = () =>
      rendered(page)
        .first()
        .evaluate((svg) => {
          const node = svg.querySelector('.node rect, .node polygon, .node path') as Element;
          const label = svg.querySelector('.nodeLabel, text') as Element;
          return {
            fill: getComputedStyle(node).fill,
            text: getComputedStyle(label).color || getComputedStyle(label).fill,
          };
        });
    const light = await look();
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(async () => JSON.stringify(await look())).not.toBe(JSON.stringify(light));
    const dark = await look();
    expect(dark.fill).not.toBe(light.fill);
    await expect(rendered(page)).toHaveCount(3);
    // And back again.
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(async () => (await look()).fill).toBe(light.fill);
  });

  test('B25 a dark start renders dark from the first picture', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openDoc({ page, path: `${DOCS}/diagrams.md`, text: DIAGRAMS });
    await expect(rendered(page)).toHaveCount(3);
    const fill = await rendered(page)
      .first()
      .evaluate((svg) => {
        const node = svg.querySelector('.node rect, .node polygon, .node path') as Element;
        return getComputedStyle(node).fill;
      });
    await page.emulateMedia({ colorScheme: 'light' });
    await expect
      .poll(() =>
        rendered(page)
          .first()
          .evaluate((svg) => {
            const node = svg.querySelector('.node rect, .node polygon, .node path') as Element;
            return getComputedStyle(node).fill;
          }),
      )
      .not.toBe(fill);
  });
});
