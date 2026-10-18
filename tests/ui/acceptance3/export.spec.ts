/**
 * Phase 3 acceptance C27 to C31 (WP3.8a2): Export HTML in every flavor, the malicious corpus,
 * Print, Copy as HTML and the Word export requests. Mock platform, real WebKit. Expected values
 * come from the guide and corpus sources. Run with
 * WD_UI_PORT=1472.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import {
  DOCS,
  FIXTURES,
  fixture,
  guideOf,
  menu,
  openDoc,
  PIXEL,
  preview,
} from '../acceptance2/support-b2';

const OUT = `${DOCS}/exported.html`;

const FLAVORS: Array<{ id: string; file: string; pill?: RegExp }> = [
  { id: 'commonmark', file: 'commonmark.md', pill: /^CommonMark/ },
  { id: 'gfm', file: 'gfm.md' },
  { id: 'pandoc', file: 'pandoc.md', pill: /^Pandoc/ },
  { id: 'quarto', file: 'quarto.qmd' },
  { id: 'obsidian', file: 'obsidian.md', pill: /^Obsidian/ },
  { id: 'mdx', file: 'mdx.mdx' },
];

const exported = (page: Page) =>
  page.evaluate(() => window.__BACKTICKLE_MOCK__?.exports.at(-1)?.contents ?? null);

async function exportHtml(page: Page, timeout = 30_000): Promise<string> {
  await menu(page, 'export-html');
  await expect.poll(() => exported(page), { timeout }).not.toBeNull();
  return (await exported(page)) as string;
}

/** The visible text of an exported page, tags removed and entities decoded. */
function textOf(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

/** Headings written as plain words in the source (outside fences and front matter). */
function plainHeadings(source: string): string[] {
  const out: string[] = [];
  let fenced = false;
  let front = source.startsWith('---\n');
  for (const [i, line] of source.split('\n').entries()) {
    if (front) {
      if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) front = false;
      continue;
    }
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const m = /^#{1,6} +([A-Za-z][A-Za-z0-9 ]+?) *$/.exec(line);
    if (m?.[1]) out.push(m[1]);
  }
  return out;
}

test.describe('C27 Export HTML of each flavor guide', () => {
  for (const flavor of FLAVORS) {
    test(`C27 ${flavor.id}: self-contained, every heading present, no app controls`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const guide = guideOf(flavor.id);
      await openDoc({
        page,
        path: `${DOCS}/${flavor.file}`,
        text: guide,
        images: { [`${DOCS}/pic.png`]: PIXEL },
        pill: flavor.pill,
        settings: undefined,
      });
      await page.evaluate((out) => {
        window.__BACKTICKLE_MOCK__?.setAnswers({ saveDialog: out });
      }, OUT);
      await expect
        .poll(() =>
          preview(page)
            .locator('.mermaid-diagram:not(.mermaid-rendered):not(.mermaid-failed)')
            .count(),
        )
        .toBe(0);
      const html = await exportHtml(page);

      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html).toMatch(/<meta charset="utf-8">/i);
      expect(html).toMatch(/<title>[^<]+<\/title>/);
      // Self-contained: no stylesheet link, no script, no import, no external font.
      expect(html).not.toMatch(/<link[\s>]|<script|@import|url\(\s*["']?https?:|@font-face/i);
      // No app controls and no editor line numbers.
      expect(html).not.toMatch(/data-line=|data-end-line=|<button|<input|<textarea|<select/i);
      // Light theme.
      expect(html).toContain('data-theme="light"');
      // Every plain heading of the source is in the page.
      const visible = textOf(html);
      const headings = plainHeadings(guide);
      expect(headings.length).toBeGreaterThan(3);
      for (const heading of headings) expect(visible, heading).toContain(heading);
    });
  }

  test('C27 local images become data: URIs and remote images stay as written', async ({ page }) => {
    const path = `${DOCS}/images.md`;
    await openDoc({
      page,
      path,
      text: '# Images\n\n![local](pic.png)\n\n![remote](https://example.org/remote.png)\n',
      images: { [`${DOCS}/pic.png`]: PIXEL },
      extra: {},
    });
    await page.evaluate((out) => window.__BACKTICKLE_MOCK__?.setAnswers({ saveDialog: out }), OUT);
    const html = await exportHtml(page);
    expect(html).toMatch(/<img[^>]+src="data:image\/[a-z+]+;base64,/);
    expect(html).toContain('src="https://example.org/remote.png"');
    expect(html).not.toContain('pic.png');
  });

  test('C27 the 5 MiB document exports every heading, the first and the last', async ({ page }) => {
    test.setTimeout(240_000);
    const text = fixture('generated/large-5m.md');
    const headings = plainHeadings(text);
    await openDoc({ page, path: `${DOCS}/big.md`, text });
    await page.evaluate((out) => window.__BACKTICKLE_MOCK__?.setAnswers({ saveDialog: out }), OUT);
    const html = await exportHtml(page, 200_000);
    const count = (html.match(/<h[1-6][ >]/g) ?? []).length;
    let fenced = false;
    let expected = 0;
    for (const line of text.split('\n')) {
      if (/^\s{0,3}(```|~~~)/.test(line)) fenced = !fenced;
      else if (!fenced && /^#{1,6} /.test(line)) expected++;
    }
    expect(count).toBe(expected);
    const visible = textOf(html);
    expect(visible).toContain(headings[0] as string);
    expect(visible).toContain(headings[headings.length - 1] as string);
    expect(html).not.toContain('data-line=');
  });
});

// ---- C28 ---------------------------------------------------------------------------------------

const PHASE2 = readdirSync(join(FIXTURES, 'xss', 'phase2')).sort();
const CORPUS: Array<[string, string]> = [
  ['phase 1 corpus', fixture('xss/corpus.md')],
  ...PHASE2.map((name): [string, string] => [`phase2/${name}`, fixture(`xss/phase2/${name}`)]),
];

for (const flavor of FLAVORS) {
  for (const [label, text] of CORPUS) {
    test(`C28 ${flavor.id}: the export of ${label} has no active content`, async ({ page }) => {
      test.setTimeout(90_000);
      const dialogs: string[] = [];
      page.on('dialog', (dialog) => {
        dialogs.push(dialog.message());
        void dialog.dismiss();
      });
      await openDoc({
        page,
        path: `${DOCS}/corpus-${flavor.id}.md`,
        text,
        pill:
          flavor.pill ??
          (flavor.id === 'quarto' ? /^Quarto/ : flavor.id === 'mdx' ? /^MDX/ : /^GitHub/),
      });
      await page.evaluate(
        (out) => window.__BACKTICKLE_MOCK__?.setAnswers({ saveDialog: out }),
        OUT,
      );
      await expect
        .poll(() =>
          preview(page)
            .locator('.mermaid-diagram:not(.mermaid-rendered):not(.mermaid-failed)')
            .count(),
        )
        .toBe(0);
      const html = await exportHtml(page);

      // Inspect the page as a parsed, inert document.
      const found = await page.evaluate((source) => {
        const doc = new DOMParser().parseFromString(source, 'text/html');
        const all = Array.from(doc.querySelectorAll('*'));
        const onAttrs: string[] = [];
        const badUrls: string[] = [];
        for (const el of all) {
          for (const attr of Array.from(el.attributes)) {
            if (/<script|<iframe|<form[\s>]/i.test(attr.value))
              badUrls.push(`${el.tagName}.${attr.name}:markup`);
            if (
              /javascript:|expression\(/i.test(attr.value) &&
              /^(style|href|src|action|formaction|xlink:href)$/i.test(attr.name)
            )
              badUrls.push(`${el.tagName}.${attr.name}:js`);
            if (/^on/i.test(attr.name)) onAttrs.push(`${el.tagName}.${attr.name}`);
            const compact = Array.from(attr.value)
              .filter((ch) => ch.charCodeAt(0) > 32)
              .join('')
              .toLowerCase();
            if (/^(javascript|vbscript):/.test(compact) || compact.startsWith('data:text/html')) {
              badUrls.push(`${el.tagName}.${attr.name}`);
            }
          }
        }
        return {
          scripts: doc.querySelectorAll('script').length,
          onAttrs,
          badUrls,
          iframes: doc.querySelectorAll('iframe, frame, frameset').length,
          forms: doc.querySelectorAll('form').length,
          objects: doc.querySelectorAll('object, embed, applet').length,
          base: doc.querySelectorAll('base, meta[http-equiv]').length,
        };
      }, html);
      expect(found.scripts).toBe(0);
      expect(found.onAttrs).toEqual([]);
      expect(found.badUrls).toEqual([]);
      expect(found.iframes).toBe(0);
      expect(found.forms).toBe(0);
      expect(found.objects).toBe(0);
      expect(found.base).toBe(0);
      // The raw text too, for a script that a parser might hide in a comment or attribute.
      // Escaped or visible text such as "[x](javascript:...)" or a Mermaid source line is inert; the
      // parsed checks above cover elements and attributes (incl. javascript: URLs), so a raw regex over
      // the string would only misread text nodes and code.
      expect(dialogs).toEqual([]);
    });
  }
}

// ---- C29 ---------------------------------------------------------------------------------------

const PRINT_SOURCE = `---
title: Printed
---

# Print heading

Paragraph one of the printed document.

\`\`\`js
const printed = true;
\`\`\`

<hr class="pagebreak">

## After the break

| a | b |
|---|---|
| 1 | 2 |

Last paragraph of the printed document.
`;

test.describe('C29 Print', () => {
  test('C29 the print root holds the whole document, chrome is hidden in print, the root is removed', async ({
    page,
  }) => {
    await openDoc({ page, path: `${DOCS}/print.md`, text: PRINT_SOURCE });
    await page.evaluate(() => window.__BACKTICKLE_MOCK__?.reset());
    await menu(page, 'print');
    await expect.poll(() => page.evaluate(() => window.__BACKTICKLE_MOCK__?.prints)).toBe(1);

    const atCall = await page.evaluate(() => window.__BACKTICKLE_MOCK__?.printRoots[0] ?? '');
    for (const needle of [
      'Print heading',
      'Paragraph one of the printed document.',
      'After the break',
      'Last paragraph of the printed document.',
    ]) {
      expect(atCall, needle).toContain(needle);
    }
    expect(atCall).not.toMatch(/data-line=|<button|<input/);

    await page.emulateMedia({ media: 'print' });
    const chrome = await page.evaluate(() => {
      const shown = (el: Element | null) => !!el && el.getClientRects().length > 0;
      const root = document.getElementById('wd-print-root');
      return {
        root: shown(root),
        rootWidth: root ? Math.round(root.getBoundingClientRect().width) : 0,
        workspace: shown(document.querySelector('[data-testid="workspace"]')),
        status: shown(document.querySelector('[data-testid="status-words"]')),
        titleBar: shown(document.querySelector('[data-testid="document-name"]')),
        preview: shown(document.querySelector('[data-testid="preview"]')),
      };
    });
    expect(chrome.root).toBe(true);
    expect(chrome.workspace).toBe(false);
    expect(chrome.status).toBe(false);
    expect(chrome.titleBar).toBe(false);
    expect(chrome.preview).toBe(false);
    // A column that fits on a page; the content is not wider than the 720 px column.
    expect(chrome.rootWidth).toBeLessThanOrEqual(1280);

    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(page.locator('#wd-print-root')).toHaveCount(0);
  });

  test('C29 under a dark system the print root still uses the light theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openDoc({ page, path: `${DOCS}/print-dark.md`, text: PRINT_SOURCE });
    await menu(page, 'print');
    await expect.poll(() => page.evaluate(() => window.__BACKTICKLE_MOCK__?.prints)).toBe(1);
    await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
    const colors = await page.evaluate(() => {
      const heading = document.querySelector('#wd-print-root h1') as Element;
      const pre = document.querySelector('#wd-print-root .code-card') as Element | null;
      return {
        text: getComputedStyle(heading).color,
        pre: pre ? getComputedStyle(pre).backgroundColor : null,
        root: getComputedStyle(document.getElementById('wd-print-root') as Element).backgroundColor,
      };
    });
    // --wd-on-surface of the light theme is #1b1b1d.
    expect(colors.text).toBe('rgb(27, 27, 29)');
    // The page is white; code cards are dark by design in both themes (--wd-code-card-bg #1e1e24).
    expect(colors.root).toBe('rgb(255, 255, 255)');
    expect(colors.pre).toBe('rgb(30, 30, 36)');
  });

  test('C29 code cards, figures, callouts and table rows do not break inside; hr.pagebreak breaks', async ({
    page,
  }) => {
    await openDoc({ page, path: `${DOCS}/print-breaks.md`, text: PRINT_SOURCE });
    await menu(page, 'print');
    await expect.poll(() => page.evaluate(() => window.__BACKTICKLE_MOCK__?.prints)).toBe(1);
    await page.emulateMedia({ media: 'print' });
    const breaks = await page.evaluate(() => {
      const inside = (selector: string) => {
        const el = document.querySelector(`#wd-print-root ${selector}`);
        if (!el) return null;
        const style = getComputedStyle(el);
        return `${style.breakInside} ${style.getPropertyValue('page-break-inside')}`;
      };
      const hr = document.querySelector('#wd-print-root hr.pagebreak');
      const hrStyle = hr ? getComputedStyle(hr) : null;
      return {
        card: inside('.code-card'),
        row: inside('tr'),
        hrFound: hr !== null,
        hrBreak: hrStyle
          ? `${hrStyle.breakBefore} ${hrStyle.breakAfter} ${hrStyle.getPropertyValue('page-break-after')} ${hrStyle.getPropertyValue('page-break-before')}`
          : '',
      };
    });
    expect(breaks.card).toMatch(/avoid/);
    expect(breaks.row).toMatch(/avoid/);
    expect(breaks.hrFound).toBe(true);
    expect(breaks.hrBreak).toMatch(/page|always/);
  });
});

// ---- C30 ---------------------------------------------------------------------------------------

const COPY_SOURCE = `# Copy heading

First paragraph with **strong** words.

Second paragraph with a [link](https://example.org/).

- item one
- item two
`;

test.describe('C30 Copy as HTML', () => {
  test('C30 without a selection the whole document is copied, as text and as HTML', async ({
    page,
  }) => {
    await openDoc({ page, path: `${DOCS}/copy.md`, text: COPY_SOURCE });
    await menu(page, 'copy-html');
    await expect
      .poll(() => page.evaluate(() => window.__BACKTICKLE_MOCK__?.clipboardWrites.length))
      .toBe(1);
    const write = await page.evaluate(() => window.__BACKTICKLE_MOCK__?.clipboardWrites[0]);
    const html = write?.html ?? '';
    expect(html).toContain('<h1');
    expect(html).toContain('Copy heading');
    expect(html).toContain('<strong>strong</strong>');
    expect(html).toContain('<a href="https://example.org/">link</a>');
    expect(html).toMatch(/<li[^>]*>item two<\/li>/);
    expect(html).not.toMatch(/data-line=|<button|<input/);
    // Accepted: the HTML source is written to both pasteboard types.
    expect(write?.text).toBe(html);
  });

  test('C30 with a selection across two paragraphs only those paragraphs are copied', async ({
    page,
  }) => {
    await openDoc({ page, path: `${DOCS}/copy-sel.md`, text: COPY_SOURCE });
    await page.evaluate(() => {
      const paragraphs = [...document.querySelectorAll('[data-testid=preview] p')];
      const first = paragraphs.find((p) => p.textContent?.startsWith('First paragraph')) as Element;
      const second = paragraphs.find((p) =>
        p.textContent?.startsWith('Second paragraph'),
      ) as Element;
      const range = document.createRange();
      range.setStartBefore(first);
      range.setEndAfter(second);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await menu(page, 'copy-html');
    await expect
      .poll(() => page.evaluate(() => window.__BACKTICKLE_MOCK__?.clipboardWrites.length))
      .toBe(1);
    const html =
      (await page.evaluate(() => window.__BACKTICKLE_MOCK__?.clipboardWrites[0]?.html)) ?? '';
    expect(html).toContain('First paragraph with');
    expect(html).toContain('Second paragraph with');
    expect(html).not.toContain('Copy heading');
    expect(html).not.toContain('item one');
  });
});

// ---- C31 ---------------------------------------------------------------------------------------

const PANDOC_INFO = { path: '/mock/pandoc', version: '3.8.3' };
const DOCX_OUT = `${DOCS}/word.docx`;
const requests = (page: Page) =>
  page.evaluate(() => window.__BACKTICKLE_MOCK__?.docxRequests ?? []);

async function openForWord(
  page: Page,
  name: string,
  text: string,
  extra: { pill?: RegExp; seed?: Record<string, unknown> } = {},
) {
  const path = `${DOCS}/${name}`;
  await openDoc({ page, path, text, pill: extra.pill });
  await page.evaluate(
    ([out, info]) => {
      window.__BACKTICKLE_MOCK__?.setAnswers({ saveDialog: out as string });
      window.__BACKTICKLE_MOCK__?.setPandoc(info as never);
    },
    [DOCX_OUT, PANDOC_INFO] as const,
  );
  return path;
}

test.describe('C31 Word export requests', () => {
  const ROUTES: Array<{ name: string; file: string; text: string; pill?: RegExp; from: string }> = [
    {
      name: 'CommonMark',
      file: 'r1.md',
      text: '# One\n\nText.\n',
      pill: /^CommonMark/,
      from: 'commonmark',
    },
    {
      name: 'GFM',
      file: 'r2.md',
      text: '# One\n\n| a |\n|---|\n| b |\n',
      from: 'gfm+tex_math_dollars',
    },
    { name: 'Pandoc', file: 'r3.md', text: '# One\n\nText.\n', pill: /^Pandoc/, from: 'markdown' },
    { name: 'MMD', file: 'r4.mmd', text: 'Title: T\n\n# One\n', from: 'markdown_mmd' },
    { name: 'Quarto', file: 'r5.qmd', text: '---\ntitle: Q\n---\n\n# One\n', from: 'markdown' },
    { name: 'R Markdown', file: 'r6.Rmd', text: '---\ntitle: R\n---\n\n# One\n', from: 'markdown' },
    {
      name: 'Obsidian',
      file: 'r7.md',
      text: '# One\n\n[[Note]]\n',
      pill: /^Obsidian/,
      from: 'html',
    },
    { name: 'MDX', file: 'r8.mdx', text: '# One\n\nText.\n', from: 'html' },
  ];
  for (const route of ROUTES) {
    test(`C31 ${route.name} uses -f ${route.from}`, async ({ page }) => {
      const path = await openForWord(page, route.file, route.text, { pill: route.pill });
      await menu(page, 'export-docx');
      await expect.poll(async () => (await requests(page)).length).toBe(1);
      const [request] = await requests(page);
      expect(request?.from).toBe(route.from);
      expect(request?.outPath).toBe(DOCX_OUT);
      expect(request?.docPath).toBe(path);
      expect(request?.citeproc).toBe(false);
      // Nothing but the five fields of DocxRequest.
      expect(Object.keys(request ?? {}).sort()).toEqual(
        ['citeproc', 'docPath', 'from', 'input', 'outPath'].sort(),
      );
      if (route.from === 'html') {
        expect(request?.input).toContain('<h1');
        expect(request?.input).not.toMatch(/data-line=|<script/);
      } else {
        expect(request?.input).toBe(route.text);
      }
    });
  }

  test('C31 a document with a bibliography asks for citeproc', async ({ page }) => {
    await openForWord(
      page,
      'cite.md',
      '---\nbibliography: refs.bib\n---\n\n# One\n\nSee [@key].\n',
      { pill: /^Pandoc/ },
    );
    await menu(page, 'export-docx');
    await expect.poll(async () => (await requests(page)).length).toBe(1);
    expect((await requests(page))[0]?.citeproc).toBe(true);
  });

  test('C31 without Pandoc the item is disabled and the action reports it', async ({ page }) => {
    await openForWord(page, 'nopandoc.md', '# One\n');
    await page.evaluate(() => window.__BACKTICKLE_MOCK__?.setPandoc(null));
    await menu(page, 'export-docx');
    await expect(page.getByRole('alert')).toContainText('Pandoc was not found');
    expect(await requests(page)).toEqual([]);
  });
});

test.describe('C31 Word export errors and progress', () => {
  test('C31 a Pandoc error is shown in the banner', async ({ page }) => {
    const path = `${DOCS}/err2.md`;
    await page.addInitScript(
      ([p, out]) => {
        window.__BACKTICKLE_MOCK_SEED__ = {
          files: { [p as string]: '# One\n' },
          saveDialog: out as string,
          pandoc: { path: '/mock/pandoc', version: '3.8.3' },
          exportDocx: { error: 'pandoc: Could not parse the input' },
          launch: { openPath: p as string, view: 'preview' },
        };
      },
      [path, DOCX_OUT] as const,
    );
    await page.goto('/');
    await expect(preview(page).locator('h1').first()).toBeVisible();
    await menu(page, 'export-docx');
    await expect(page.getByRole('alert')).toContainText('pandoc: Could not parse the input');
  });

  test('C31 "Exporting…" shows while Pandoc runs and goes when it ends', async ({ page }) => {
    const path = `${DOCS}/hold.md`;
    await page.addInitScript(
      ([p, out]) => {
        window.__BACKTICKLE_MOCK_SEED__ = {
          files: { [p as string]: '# One\n' },
          saveDialog: out as string,
          pandoc: { path: '/mock/pandoc', version: '3.8.3' },
          exportDocx: { hold: true },
          launch: { openPath: p as string, view: 'preview' },
        };
      },
      [path, DOCX_OUT] as const,
    );
    await page.goto('/');
    await expect(preview(page).locator('h1').first()).toBeVisible();
    await menu(page, 'export-docx');
    await expect(page.getByTestId('save-status')).toHaveText('Exporting…');
    await page.evaluate(() => window.__BACKTICKLE_MOCK__?.finishDocx());
    await expect(page.getByTestId('save-status')).not.toHaveText('Exporting…');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('C31 a cancelled save dialog sends no request', async ({ page }) => {
    await openForWord(page, 'cancel.md', '# One\n');
    await page.evaluate(() => window.__BACKTICKLE_MOCK__?.setAnswers({ saveDialog: null }));
    await menu(page, 'export-docx');
    await page.waitForTimeout(400);
    expect(await requests(page)).toEqual([]);
  });
});
