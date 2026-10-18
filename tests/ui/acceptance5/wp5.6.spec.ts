/**
 * Graphviz diagrams. Run with WD_UI_PORT=1496.
 */
import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { HOME, menu, seedMock } from '../helpers';

const read = (name: string): string =>
  readFileSync(new URL(`../../fixtures/graphviz/${name}`, import.meta.url), 'utf8');
const GRAPHS = read('graphs.md');
const XSS = read('xss.md');

const GRAPHVIZ_CHUNKS = [
  /\/src\/preview\/graphviz\/render/,
  /\/node_modules\/\.vite\/deps\/@viz-js/,
];

async function mount(
  page: Page,
  text: string,
  flavor: 'gfm' | 'pandoc' | 'quarto' | 'obsidian' | 'commonmark' = 'gfm',
  requests?: string[],
): Promise<void> {
  if (requests) page.on('request', (request) => requests.push(request.url()));
  await page.goto('/tests/harness/preview.html');
  await page.waitForFunction(() => window.__harness !== undefined);
  await page.evaluate(
    async ({ value, kind }) => {
      await window.__harness.mount({ text: value, flavor: kind });
      await window.__harness.settled();
    },
    { value: text, kind: flavor },
  );
}

const preview = (page: Page) => page.getByTestId('preview');

test.describe('Graphviz', () => {
  test('E5.6-1: three graphs, two drawn and the syntax error shown with its source', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await mount(page, GRAPHS);
    const graphs = preview(page).locator('.graphviz-diagram');
    await expect(graphs).toHaveCount(3);
    await expect(graphs.nth(0).locator('svg')).toHaveCount(1, { timeout: 30_000 });
    await expect(graphs.nth(1).locator('svg')).toHaveCount(1);
    await expect(graphs.nth(0)).toContainText('shortcut');
    await expect(graphs.nth(1)).toContainText('Front end');
    // The error: Graphviz's message, the source stays, no drawing.
    await expect(graphs.nth(2).locator('.graphviz-error')).toBeVisible({ timeout: 30_000 });
    await expect(graphs.nth(2).locator('pre.graphviz-source')).toContainText('Broken');
    await expect(graphs.nth(2).locator('svg')).toHaveCount(0);
    await expect(preview(page).locator('[style]')).toHaveCount(0);
    expect(errors.filter((text) => !/favicon/i.test(text))).toEqual([]);
  });

  test('E5.6-2: the drawing follows light and dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await mount(page, GRAPHS);
    const first = preview(page).locator('.graphviz-diagram').first();
    await expect(first.locator('svg')).toHaveCount(1, { timeout: 30_000 });
    const light = await first.locator('svg').innerHTML();
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    await expect
      .poll(async () => first.locator('svg').innerHTML(), { timeout: 30_000 })
      .not.toBe(light);
    await expect(first.locator('svg')).toHaveCount(1);
    await expect(preview(page).locator('[style]')).toHaveCount(0);
  });

  test('E5.6-3: ids are unique across graphs on the page', async ({ page }) => {
    await mount(page, GRAPHS);
    await expect(preview(page).locator('.graphviz-diagram svg')).toHaveCount(2, {
      timeout: 30_000,
    });
    const duplicates = await page.evaluate(() => {
      const seen = new Map<string, number>();
      for (const el of document.querySelectorAll('[id]')) {
        seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
      }
      return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
    });
    expect(duplicates).toEqual([]);
  });

  test('E5.6-4: links, scripts and event attributes in a graph draw no active content', async ({
    page,
  }) => {
    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });
    const requests: string[] = [];
    await mount(page, XSS, 'gfm', requests);
    await expect(preview(page).locator('.graphviz-diagram svg')).toHaveCount(1, {
      timeout: 30_000,
    });
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => window.__XSS_SENTINEL__)).toBeUndefined();
    expect(dialogs).toEqual([]);
    // Parse the SVG: elements and attributes.
    const found = await preview(page)
      .locator('.graphviz-diagram svg')
      .evaluate((svg) => {
        const tags = new Set<string>();
        const attributes: string[] = [];
        for (const el of [svg, ...svg.querySelectorAll('*')]) {
          tags.add(el.localName.toLowerCase());
          for (const a of Array.from(el.attributes)) {
            // Namespace declarations are inert.
            if (a.name.startsWith('xmlns')) continue;
            if (
              /^on/i.test(a.name) ||
              /href$/i.test(a.name) ||
              a.name === 'style' ||
              /^\s*(javascript|vbscript|data):/i.test(a.value) ||
              /https?:\/\//i.test(a.value)
            )
              attributes.push(`${el.localName}@${a.name}`);
          }
        }
        return { tags: [...tags], attributes };
      });
    for (const forbidden of ['script', 'foreignobject', 'a', 'image', 'use', 'iframe', 'style']) {
      expect(found.tags).not.toContain(forbidden);
    }
    expect(found.attributes).toEqual([]);
    // The label text stays visible as text, not as markup.
    await expect(preview(page).locator('.graphviz-diagram')).toContainText('<script>');
    // Nothing outside the page was asked for.
    expect(requests.filter((url) => /example\.org/.test(url))).toEqual([]);
    await expect(preview(page).locator('[style]')).toHaveCount(0);
    expect(await page.evaluate(() => getComputedStyle(document.body).display)).not.toBe('none');
  });

  for (const [flavor, fence] of [
    ['pandoc', '```{.dot}'],
    ['quarto', '```{dot}'],
    ['obsidian', '```dot'],
  ] as const) {
    test(`E5.6-5: ${flavor} draws a graph`, async ({ page }) => {
      await mount(page, `${fence}\ndigraph { Left -> Right }\n\`\`\`\n`, flavor);
      await expect(preview(page).locator('.graphviz-diagram svg')).toHaveCount(1, {
        timeout: 30_000,
      });
      await expect(preview(page).locator('.graphviz-diagram')).toContainText('Right');
    });
  }

  test('E5.6-6: CommonMark keeps a code block', async ({ page }) => {
    await mount(page, '```dot\ndigraph { A -> B }\n```\n', 'commonmark');
    await expect(preview(page).locator('.code-card')).toHaveCount(1);
    await expect(preview(page).locator('.graphviz-diagram')).toHaveCount(0);
  });

  test('E5.6-7: Graphviz loads only for a document with a dot fence', async ({ page }) => {
    const plain: string[] = [];
    await mount(page, '# Title\n\n```js\nconst a = 1;\n```\n', 'gfm', plain);
    await expect(preview(page).locator('.code-card')).toHaveCount(1);
    await page.waitForTimeout(500);
    expect(plain.filter((url) => GRAPHVIZ_CHUNKS.some((p) => p.test(url)))).toEqual([]);

    const withGraph: string[] = [];
    const second = await page.context().newPage();
    await mount(second, GRAPHS, 'gfm', withGraph);
    await expect(second.getByTestId('preview').locator('.graphviz-diagram svg')).toHaveCount(2, {
      timeout: 30_000,
    });
    expect(withGraph.some((url) => GRAPHVIZ_CHUNKS.some((p) => p.test(url)))).toBe(true);
    // Mermaid was not needed for it.
    expect(withGraph.filter((url) => /\/mermaid\/render|deps\/mermaid/.test(url))).toEqual([]);
  });
});

test.describe('Graphviz export', () => {
  const DOC = `${HOME}/docs/Graph.md`;
  test('E5.6-8: HTML export includes the SVG', async ({ page }) => {
    await seedMock(page, {
      files: { [DOC]: GRAPHS },
      saveDialog: `${HOME}/docs/Graph.html`,
      launch: { openPath: DOC, view: 'preview' },
    });
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.goto('/');
    await expect(preview(page).locator('.graphviz-diagram svg')).toHaveCount(2, {
      timeout: 30_000,
    });
    await menu(page, 'export-html');
    await expect
      .poll(
        () => page.evaluate(() => window.__BACKTICKLE_MOCK__?.exports.at(-1)?.contents ?? null),
        {
          timeout: 30_000,
        },
      )
      .not.toBeNull();
    const html = (await page.evaluate(
      () => window.__BACKTICKLE_MOCK__?.exports.at(-1)?.contents ?? '',
    )) as string;
    expect(html).toContain('<svg');
    expect(html).toContain('shortcut');
    expect(html).not.toMatch(/<script|<foreignObject|\sstyle="/i);
  });
});
