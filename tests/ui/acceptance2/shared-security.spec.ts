/**
 * Phase 2 acceptance, shared behavior: B29 (the extended malicious corpus executes nothing in
 * every flavor) and B30 (lazy loading seen in the network requests). Run with WD_UI_PORT=1451.
 *
 * B30 runs against the Vite dev server, where every module is its own request, so it names
 * modules by path. Three small modules are loaded by every document in dev and are not counted as
 * another flavor's chunk: `mermaid/index.ts` and `mermaid/theme.ts` (the wrapper, the engine is
 * `mermaid/render.ts` and the package) and `rules/quarto/tabset-enhance.ts` (a trusted enhancer).
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { type Page, test } from '@playwright/test';
import {
  choose,
  DOCS,
  expect,
  FIXTURES,
  fixture,
  launch,
  menu,
  preview,
  setView,
  watchRequests,
} from './support-b2';

// ---- B29 ---------------------------------------------------------------------------------------

const FLAVORS: Array<[string, RegExp]> = [
  ['commonmark', /^CommonMark/],
  ['gfm', /^GitHub Flavored/],
  ['pandoc', /^Pandoc/],
  ['quarto', /^Quarto/],
  ['obsidian', /^Obsidian/],
  ['mdx', /^MDX/],
];

const PHASE2 = readdirSync(join(FIXTURES, 'xss', 'phase2')).sort();
const INPUTS: Array<[string, string]> = [
  ['phase 1 corpus', fixture('xss/corpus.md')],
  ...PHASE2.map((name): [string, string] => [`phase2/${name}`, fixture(`xss/phase2/${name}`)]),
];

async function scan(page: Page) {
  return page.evaluate(() => {
    const article = document.querySelector('[data-testid="preview"]') as Element;
    const all = Array.from(article.querySelectorAll('*'));
    const onAttrs: string[] = [];
    const badUrls: string[] = [];
    const styled: string[] = [];
    for (const el of all) {
      for (const attr of Array.from(el.attributes)) {
        if (/^on/i.test(attr.name)) onAttrs.push(`${el.tagName}.${attr.name}`);
        if (/^(href|src|xlink:href|action|formaction|data|srcdoc|poster)$/i.test(attr.name)) {
          const v = Array.from(attr.value)
            .filter((ch) => ch.charCodeAt(0) > 32)
            .join('')
            .toLowerCase();
          if (/^(javascript|vbscript):/.test(v) || v.startsWith('data:text/html')) {
            badUrls.push(`${el.tagName}.${attr.name}=${attr.value.slice(0, 40)}`);
          }
        }
        if (attr.name.toLowerCase() === 'style') {
          // Sizes of images and columns are applied through CSSOM after sanitizing.
          const sized = el.hasAttribute('data-wd-width') || el.hasAttribute('data-wd-height');
          if (!sized)
            styled.push(`${el.tagName}[${(el.className?.toString() ?? '').slice(0, 20)}]`);
        }
      }
    }
    const trusted = (el: Element) =>
      el.closest('.code-card-actions, .mdx-error-banner, [role="tablist"], .callout-title') !==
      null;
    return {
      sentinel: (window as unknown as { __XSS_SENTINEL__?: unknown }).__XSS_SENTINEL__,
      onAttrs,
      badUrls,
      styled,
      iframes: article.querySelectorAll('iframe').length,
      forms: article.querySelectorAll('form').length,
      objects: article.querySelectorAll('object, embed').length,
      scripts: article.querySelectorAll('script').length,
      inputs: article.querySelectorAll('input, textarea, select').length,
      buttons: Array.from(article.querySelectorAll('button')).filter((b) => !trusted(b)).length,
      // Our own scoped <style> inside a Mermaid SVG is allowed; no other style element is.
      styles: Array.from(
        article.querySelectorAll('style, meta, base, link, template, dialog'),
      ).filter((el) => !el.closest('.mermaid-svg')).length,
      documentIframes: document.querySelectorAll('iframe').length,
      documentForms: document.querySelectorAll('form').length,
    };
  });
}

async function settled(page: Page) {
  await preview(page)
    .locator('.wd-block, .mdx-error-banner')
    .first()
    .waitFor({ state: 'attached' });
  // Mermaid and embeds finish after the first paint: wait until no diagram is still pending.
  await expect
    .poll(() =>
      preview(page).locator('.mermaid-diagram:not(.mermaid-rendered):not(.mermaid-failed)').count(),
    )
    .toBe(0);
  await page.waitForTimeout(600);
}

for (const [flavor, pill] of FLAVORS) {
  for (const [label, text] of INPUTS) {
    test(`B29 ${flavor}: ${label} executes nothing and leaves no active content`, async ({
      page,
    }) => {
      const path = `${DOCS}/xss-${flavor}.md`;
      const dialogs: string[] = [];
      page.on('dialog', (dialog) => {
        dialogs.push(dialog.message());
        void dialog.dismiss();
      });
      await launch(page, { seed: { files: { [path]: text } } });
      const startUrl = page.url();
      const navigations: string[] = [];
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) navigations.push(frame.url());
      });
      await page.evaluate((p) => {
        (
          window as unknown as { __WRITEDOWN_MOCK__: { openFiles(paths: string[]): void } }
        ).__WRITEDOWN_MOCK__.openFiles([p]);
      }, path);
      await expect(page.getByTestId('document-name')).toHaveText(`xss-${flavor}.md`);
      await choose(page, pill);
      await settled(page);

      const check = async (where: string) => {
        const r = await scan(page);
        const tag = `${flavor} ${label} ${where}`;
        expect(r.sentinel, `${tag}: sentinel`).toBeUndefined();
        expect(r.onAttrs, `${tag}: on* attributes`).toEqual([]);
        expect(r.badUrls, `${tag}: script URLs`).toEqual([]);
        expect(r.styled, `${tag}: style attributes`).toEqual([]);
        expect(r.iframes + r.documentIframes, `${tag}: iframes`).toBe(0);
        expect(r.forms + r.documentForms, `${tag}: forms`).toBe(0);
        expect(r.objects, `${tag}: object and embed`).toBe(0);
        expect(r.scripts, `${tag}: scripts`).toBe(0);
        expect(r.inputs, `${tag}: inputs`).toBe(0);
        expect(r.buttons, `${tag}: untrusted buttons`).toBe(0);
        expect(r.styles, `${tag}: style, meta, base, link`).toBe(0);
      };
      await check('preview');
      await setView(page, 'split');
      await settled(page);
      await check('split');
      expect(dialogs).toEqual([]);
      expect(navigations).toEqual([]);
      expect(page.url()).toBe(startUrl);
    });
  }
}

// ---- B30 ---------------------------------------------------------------------------------------

/** What a document of another flavor needs, by dev-server path. */
const FORBIDDEN_FOR_GFM = [
  /\/src\/preview\/packs\/(pandoc|quarto|obsidian|mdx)/,
  /\/src\/preview\/rules\/(pandoc|obsidian|mdx)\//,
  /\/src\/preview\/rules\/quarto\/(?!tabset-enhance)/,
  /\/src\/preview\/bibliography\//,
  /\/src\/preview\/pandoc-preview/,
  /\/src\/editor\/flavors\/(pandoc|quarto|obsidian|mdx)/,
  /\/src\/editor\/inserts/,
  /\/node_modules\/\.vite\/deps\/(micromark|mdast|@retorquere|retorquere|.*bibtex)/,
];
const GRAPHVIZ = [/\/src\/preview\/graphviz\/render/, /\/node_modules\/\.vite\/deps\/@viz-js/];
const MERMAID = [
  /\/src\/preview\/mermaid\/(render|source|styles)/,
  /\/node_modules\/\.vite\/deps\/mermaid/,
];

const matching = (urls: string[], patterns: RegExp[]) =>
  urls.filter((url) => patterns.some((pattern) => pattern.test(url)));

async function loadDoc(page: Page, name: string, text: string, pill?: RegExp, view = 'split') {
  const urls = watchRequests(page);
  const path = `${DOCS}/${name}`;
  await launch(page, {
    seed: { files: { [path]: text } },
    open: path,
    view: view as 'split',
  });
  if (pill) await choose(page, pill);
  await preview(page).locator('.wd-block').first().waitFor({ state: 'attached' });
  await page.waitForTimeout(1500);
  return urls;
}

test.describe('B30 lazy chunks', () => {
  const PLAIN =
    '# Plain\n\nText with a [link](https://example.org) and `code`.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n';

  test('B30 a GFM document loads no other flavor, no bibliography parser, no MDX parser and no Mermaid', async ({
    page,
  }) => {
    const urls = await loadDoc(page, 'plain.md', PLAIN);
    expect(matching(urls, FORBIDDEN_FOR_GFM)).toEqual([]);
    expect(matching(urls, MERMAID)).toEqual([]);
    expect(matching(urls, GRAPHVIZ)).toEqual([]);
    // The GFM pack itself did load, so the patterns above look at the right place.
    expect(urls.some((u) => /\/src\/preview\/packs\/gfm/.test(u))).toBe(true);
  });

  test('B30 a CommonMark document loads nothing of the other flavors either', async ({ page }) => {
    const urls = await loadDoc(page, 'plain.md', PLAIN, /^CommonMark/);
    expect(matching(urls, FORBIDDEN_FOR_GFM)).toEqual([]);
    expect(matching(urls, MERMAID)).toEqual([]);
    expect(matching(urls, GRAPHVIZ)).toEqual([]);
  });

  test('B30 the GFM guide does not load Phase 2 chunks either', async ({ page }) => {
    const urls = watchRequests(page);
    await launch(page, { seed: {} });
    await menu(page, 'markdown-guide');
    await expect(page.getByTestId('document-name')).toHaveText('Markdown Guide');
    await expect(preview(page).locator('.footnotes')).toBeAttached();
    await page.waitForTimeout(1000);
    expect(matching(urls, FORBIDDEN_FOR_GFM)).toEqual([]);
    // The guide has a Mermaid example, so Mermaid itself is allowed here: no other flavor is.
  });

  test('B30 nothing is fetched from another origin', async ({ page }) => {
    const urls = await loadDoc(page, 'plain.md', PLAIN);
    const foreign = urls.filter(
      (u) => !/^(http:\/\/localhost:\d+|data:|blob:|about:)/.test(u) && u !== '',
    );
    expect(foreign).toEqual([]);
  });

  const OTHERS: Array<[string, string, RegExp | undefined, RegExp]> = [
    ['pandoc', '# P\n\nCited [@a].\n', /^Pandoc/, /\/src\/preview\/packs\/pandoc/],
    ['quarto', '# Q\n\n```{r}\n1\n```\n', /^Quarto/, /\/src\/preview\/rules\/quarto\/chunks/],
    ['obsidian', '# O\n\n[[Note]] and ==mark==.\n', /^Obsidian/, /\/src\/preview\/packs\/obsidian/],
    ['mdx', '# M\n\n<A />\n', /^MDX/, /\/node_modules\/\.vite\/deps\/mdast-util-mdx/],
  ];
  for (const [flavor, text, pill, marker] of OTHERS) {
    test(`B30 a ${flavor} document loads its own chunk, and no Mermaid without a fence`, async ({
      page,
    }) => {
      const urls = await loadDoc(page, `doc-${flavor}.md`, text, pill);
      expect(
        urls.some((u) => marker.test(u)),
        `${flavor} chunk requested`,
      ).toBe(true);
      expect(matching(urls, MERMAID)).toEqual([]);
      expect(matching(urls, GRAPHVIZ)).toEqual([]);
    });
  }

  test('B30 a Mermaid fence loads Mermaid, and only then', async ({ page }) => {
    const text = '# D\n\n```mermaid\nflowchart LR\n  A --> B\n```\n';
    const urls = await loadDoc(page, 'diagram.md', text);
    expect(urls.some((u) => /\/node_modules\/\.vite\/deps\/mermaid/.test(u))).toBe(true);
    expect(matching(urls, FORBIDDEN_FOR_GFM)).toEqual([]);
  });
});
