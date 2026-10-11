/**
 * Mermaid diagrams in real WebKit ("Mermaid", B25 and B30): SVG output, light and dark,
 * a syntax error, no `style` attribute, nothing executed, and Mermaid loaded only when a diagram
 * is shown. Run with WD_UI_PORT=1448.
 */
import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

const read = (relative: string): string =>
  readFileSync(new URL(`../fixtures/${relative}`, import.meta.url), 'utf8');
const DIAGRAMS = read('flavors/mermaid/diagrams.md');
const ERROR = read('flavors/mermaid/error.md');
const XSS = read('xss/phase2/mermaid.md');

async function mount(page: Page, text: string, requests?: string[]): Promise<void> {
  if (requests) page.on('request', (request) => requests.push(request.url()));
  await page.goto('/tests/harness/preview.html');
  await page.waitForFunction(() => window.__harness !== undefined);
  await page.evaluate(async (value) => {
    await window.__harness.mount({ text: value, flavor: 'gfm' });
    await window.__harness.settled();
  }, text);
}

// The renderer module or the package (the small loader in src/preview/mermaid/index.ts is part of the app).
const LOADS_MERMAID =
  /mermaid\/render|\/deps\/mermaid|node_modules\/mermaid|chunk-.*(cytoscape|dagre|elk)/i;

const preview = (page: Page) => page.getByTestId('preview');

test('three diagrams render as SVG with no style attribute, in light and dark', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await mount(page, DIAGRAMS);
  const diagrams = preview(page).locator('.mermaid-diagram');
  await expect(diagrams).toHaveCount(3);
  await expect(preview(page).locator('.mermaid-diagram svg')).toHaveCount(3, { timeout: 20_000 });
  await expect(preview(page).locator('.mermaid-diagram pre')).toHaveCount(0);
  await expect(preview(page).locator('[style]')).toHaveCount(0);
  await expect(preview(page).locator('foreignObject, script, a')).toHaveCount(0);
  // Text from the diagram is in the drawing.
  await expect(diagrams.first()).toContainText('Fifth Node');

  const light = await diagrams.first().locator('svg').innerHTML();
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  await expect
    .poll(async () => diagrams.first().locator('svg').innerHTML(), { timeout: 20_000 })
    .not.toBe(light);
  await expect(preview(page).locator('.mermaid-diagram svg')).toHaveCount(3);
  await expect(preview(page).locator('[style]')).toHaveCount(0);
  expect(consoleErrors.filter((text) => !/favicon/i.test(text))).toEqual([]);
});

test('a syntax error keeps the source and shows a muted message', async ({ page }) => {
  await mount(page, ERROR);
  const diagrams = preview(page).locator('.mermaid-diagram');
  await expect(diagrams).toHaveCount(2);
  await expect(diagrams.first().locator('.mermaid-error')).toBeVisible({ timeout: 20_000 });
  await expect(diagrams.first().locator('pre.mermaid-source')).toContainText('A[Start');
  await expect(diagrams.first().locator('svg')).toHaveCount(0);
  // The valid diagram next to it still renders.
  await expect(diagrams.nth(1).locator('svg')).toHaveCount(1, { timeout: 20_000 });
  await expect(preview(page).locator('[style]')).toHaveCount(0);
  // Mermaid leaves nothing of its own in the page.
  await expect(page.locator('body > [id^="dwd-mmd"], body > [id^="wd-mmd"]')).toHaveCount(0);
});

test('the malicious diagram executes nothing and has no click behavior', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await mount(page, XSS);
  await expect(preview(page).locator('.mermaid-diagram')).toHaveCount(2);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__XSS_SENTINEL__)).toBeUndefined();
  expect(dialogs).toEqual([]);
  await expect(
    preview(page).locator('script, iframe, object, embed, form, input, foreignObject, img, a'),
  ).toHaveCount(0);
  await expect(preview(page).locator('[style]')).toHaveCount(0);
  const bad = await preview(page).evaluate(
    (root) =>
      Array.from(root.querySelectorAll('*')).filter((el) =>
        Array.from(el.attributes).some(
          (a) =>
            /^on/i.test(a.name) ||
            /^(javascript|vbscript):|^data:text\/html/i.test(a.value.trim()) ||
            a.name === 'href',
        ),
      ).length,
  );
  expect(bad).toBe(0);
  // The drawing is still there: the diagram itself is not refused, only what is dangerous in it.
  await expect(preview(page).locator('.mermaid-diagram svg, .mermaid-error')).toHaveCount(2, {
    timeout: 20_000,
  });
  // Values from the document cannot add rules outside the diagram.
  expect(await page.evaluate(() => getComputedStyle(document.body).display)).not.toBe('none');
  const stray = await page.evaluate(() => {
    const bad: string[] = [];
    for (const diagram of document.querySelectorAll('.mermaid-diagram')) {
      const id = diagram.querySelector('svg')?.id;
      for (const style of diagram.querySelectorAll('style')) {
        const sheet = (style as unknown as SVGStyleElement).sheet;
        for (const rule of Array.from(sheet?.cssRules ?? [])) {
          const selectors = (rule as CSSStyleRule).selectorText;
          // A keyframes rule is kept when its name is scoped to the diagram (3.L item 7).
          if (selectors === undefined) {
            const name = (rule as CSSKeyframesRule).name;
            if (!(rule instanceof CSSKeyframesRule) || !name.startsWith(`wd-${id}-`))
              bad.push(rule.cssText);
          } else if (!selectors.split(',').every((s) => s.trim().startsWith(`#${id}`)))
            bad.push(selectors);
        }
      }
    }
    return bad;
  });
  expect(stray).toEqual([]);
});

test('Mermaid is loaded only for a document with a diagram', async ({ page }) => {
  const plain: string[] = [];
  await mount(page, '# Title\n\nJust text.\n\n```js\nconst a = 1;\n```\n', plain);
  await expect(preview(page).locator('.code-card')).toHaveCount(1);
  await page.waitForTimeout(500);
  expect(plain.filter((url) => LOADS_MERMAID.test(url))).toEqual([]);

  const withDiagram: string[] = [];
  const second = await page.context().newPage();
  await mount(second, DIAGRAMS, withDiagram);
  await expect(second.getByTestId('preview').locator('svg')).toHaveCount(3, { timeout: 20_000 });
  expect(withDiagram.some((url) => LOADS_MERMAID.test(url))).toBe(true);
});
