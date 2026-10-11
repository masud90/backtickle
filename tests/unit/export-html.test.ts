// @vitest-environment jsdom
/**
 * Document HTML, the exported page, images and the cleaner. Expected values come from the spec, not from the code's own output.
 */
import { describe, expect, it } from 'vitest';
import { cleanForExport } from '@/export/clean';
import { cutBlocks, lightCss } from '@/export/css';
import { documentHtml } from '@/export/document-html';
import { directoryOf, suggestedHtmlName } from '@/export/html';
import { dataUriResolver, fileUrlOf, imageType, toBase64 } from '@/export/images';
import { buildPage, pageTitle } from '@/export/page';
import { FLAVORS, type FlavorId } from '@/flavors';
import { createMockPlatform } from '@/lib/platform-mock';
import { loadPipeline } from '@/preview/pipeline';
import corpus from '../fixtures/xss/corpus.md?raw';
import { parseHtml } from './preview-helpers';

const GUIDES = import.meta.glob('/src/content/guides/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const FLAVOR_IDS = FLAVORS.map((flavor) => flavor.id) as FlavorId[];

describe('cleanForExport', () => {
  it('turns task boxes into ☑ and ☐, and drops buttons, line numbers and tabindex', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="wd-block" data-line="3" data-end-line="4" data-key="k">' +
      '<ul class="contains-task-list"><li class="task-list-item">' +
      '<span class="task-checkbox" role="checkbox" aria-checked="true" tabindex="0" data-task-line="3"></span> done</li>' +
      '<li class="task-list-item"><span class="task-checkbox" role="checkbox" aria-checked="false"></span> open</li></ul>' +
      '<div class="code-card"><div class="code-card-actions"><button class="code-copy">Copy</button></div><pre tabindex="0"><code>x</code></pre></div></div>';

    cleanForExport(root);

    expect(root.querySelectorAll('.task-mark')).toHaveLength(2);
    expect([...root.querySelectorAll('.task-mark')].map((mark) => mark.textContent)).toEqual([
      '☑',
      '☐',
    ]);
    expect(
      root.querySelectorAll('button, input, [data-line], [data-end-line], [data-key], [tabindex]'),
    ).toHaveLength(0);
    expect(root.querySelector('.code-card-actions')).toBeNull();
  });

  it('shows every panel of a tabset under its title and removes the tab buttons', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="tabset"><div class="tabset-tabs" role="tablist"><button role="tab">A</button></div>' +
      '<section class="tabset-panel" data-tab-title="A" hidden><p>one</p></section>' +
      '<section class="tabset-panel" data-tab-title="B" hidden><p>two</p></section></div>';

    cleanForExport(root);

    expect(root.querySelector('.tabset-tabs')).toBeNull();
    expect(root.querySelectorAll('[hidden]')).toHaveLength(0);
    expect([...root.querySelectorAll('.tabset-title')].map((title) => title.textContent)).toEqual([
      'A',
      'B',
    ]);
  });
});

describe('the page', () => {
  it('takes the title from the title block, else the first H1, else the file name', () => {
    const heading = { level: 1 as const, text: 'First  heading', id: 'first', line: 2 };
    const frontmatter = { data: { title: ' Report 2026 ' }, line: 0, endLine: 2 };
    expect(pageTitle({ frontmatter, headings: [heading] }, 'a.md')).toBe('Report 2026');
    expect(pageTitle({ frontmatter: null, headings: [heading] }, 'a.md')).toBe('First heading');
    expect(pageTitle({ frontmatter: null, headings: [] }, 'My notes.md')).toBe('My notes');
  });

  it('is a complete page with the title escaped, the light theme and no script', () => {
    const page = buildPage('A <b> & "c"', '<p>body</p>');
    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page).toContain('<meta charset="utf-8">');
    expect(page).toContain('<title>A &lt;b&gt; &amp; &quot;c&quot;</title>');
    expect(page).toContain('data-theme="light"');
    expect(page).toContain('<article class="wd-preview"><p>body</p></article>');
    expect(page).not.toMatch(/<script|<link|@import|prefers-color-scheme: dark|data-theme="dark"/);
  });

  it('suggests the document name with .html in the document folder', () => {
    expect(suggestedHtmlName('notes.md')).toBe('notes.html');
    expect(suggestedHtmlName('')).toBe('Untitled.html');
    expect(directoryOf('/a/b/c.md')).toBe('/a/b');
    expect(directoryOf(null)).toBeNull();
  });
});

describe('the CSS', () => {
  it('cuts the dark blocks and keeps the rest', () => {
    const css =
      ':root{--a:1}\n@media (prefers-color-scheme: dark){:root:not([x]){--a:2}}\n:root[data-theme="dark"]{--a:3}\n.x{color:red}';
    expect(
      cutBlocks(css, ['@media (prefers-color-scheme: dark)', ':root[data-theme="dark"]']).replace(
        /\s+/g,
        '',
      ),
    ).toBe(':root{--a:1}.x{color:red}');
  });

  it('has the light tokens and no dark rule', () => {
    const css = lightCss();
    expect(css).toContain('--wd-surface: #fcf8fb');
    expect(css).not.toContain('prefers-color-scheme: dark');
    expect(css).not.toContain('[data-theme="dark"]');
  });
});

describe('images', () => {
  it('names the type from the first bytes, else the extension', () => {
    expect(imageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0]), 'x.bin')).toBe('image/png');
    expect(imageType(new Uint8Array([0xff, 0xd8, 0xff, 0]), 'x.bin')).toBe('image/jpeg');
    expect(imageType(new Uint8Array([1, 2]), 'pic.SVG?x=1')).toBe('image/svg+xml');
    expect(toBase64(new Uint8Array([72, 105]))).toBe('SGk=');
  });

  it('builds a file URL relative to the document', () => {
    expect(fileUrlOf('/a/b/doc.md', '../img/big pic.png')).toBe('file:///a/img/big%20pic.png');
    expect(fileUrlOf('/a/b/doc.md', '/abs/p.png')).toBe('file:///abs/p.png');
  });

  it('embeds a local image as a data URI, and keeps a file URL for one over the limit', async () => {
    const doc = '/n/doc.md';
    const platform = createMockPlatform({
      files: { [doc]: '' },
      existing: ['/n/p.png', '/n/big.png'],
      imageBytes: { '/n/big.png': [137, 80, 78, 71, 0, 0, 0, 0, 0, 0, 0, 0] },
    });
    await platform.openFileDialog();
    // The default image is the 1x1 PNG of 67 bytes.
    const tight = dataUriResolver(platform, doc, 10);
    expect(await tight('p.png')).toBe('file:///n/p.png');
    const roomy = dataUriResolver(platform, doc, 1000);
    expect(await roomy('p.png')).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
    await expect(roomy('missing.png')).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('documentHtml', () => {
  it('has every block, without line numbers or controls, in order', async () => {
    const pipeline = await loadPipeline('gfm');
    const source =
      '# T\n\n- [x] done\n- [ ] open\n\n```js\nconst a = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n$$x^2$$\n';
    const result = pipeline.render(source);

    const html = await documentHtml(result.blocks, { batch: 2 });
    const root = parseHtml(html);

    expect(root.querySelectorAll('.wd-block')).toHaveLength(result.blocks.length);
    expect(
      root.querySelectorAll('[data-line], [data-end-line], [data-key], button, input'),
    ).toHaveLength(0);
    expect(root.querySelector('h1')?.textContent).toBe('T');
    expect([...root.querySelectorAll('.task-mark')].map((mark) => mark.textContent)).toEqual([
      '☑',
      '☐',
    ]);
    expect(root.querySelector('.code-card code')?.textContent).toContain('const a = 1;');
    expect(root.querySelector('table')).not.toBeNull();
  });
});

describe('C27: the guide of each flavor as an exported page', () => {
  it.each(FLAVOR_IDS)(
    '%s: self-contained, titled, every block, no controls',
    async (flavor) => {
      const text = GUIDES[`/src/content/guides/${flavor}.md`];
      expect(text, flavor).toBeTruthy();
      const pipeline = await loadPipeline(flavor);
      const result = pipeline.render(text as string);

      const body = await documentHtml(result.blocks);
      const page = buildPage(pageTitle(result, `${flavor}.md`), body);
      const root = parseHtml(page);

      expect(page).toMatch(/^<!doctype html>/);
      expect(parseHtml(body).querySelectorAll('.wd-block')).toHaveLength(result.blocks.length);
      expect(page).not.toMatch(/<script|<link |<iframe|<form|data-line=|data-end-line=/);
      expect(root.querySelectorAll('button, input')).toHaveLength(0);
      expect(root.querySelector('title')?.textContent?.length).toBeGreaterThan(0);
      expect(page).toContain('data-theme="light"');
    },
    30_000,
  );
});

describe('C28: the malicious corpus in every flavor, exported', () => {
  it.each(FLAVOR_IDS)(
    '%s: no script, on* attribute, javascript: URL, iframe or form',
    async (flavor) => {
      const pipeline = await loadPipeline(flavor);
      const result = pipeline.render(corpus);
      const page = buildPage('x', await documentHtml(result.blocks));
      const root = parseHtml(page);

      expect(
        root.querySelectorAll('script, iframe, object, embed, form, base, meta[http-equiv]'),
      ).toHaveLength(0);
      const offenders: string[] = [];
      for (const element of root.querySelectorAll('*')) {
        for (const attribute of element.attributes) {
          const value = attribute.value.replace(/[\s\p{Cc}]/gu, '').toLowerCase();
          if (/^on/i.test(attribute.name)) offenders.push(`${element.tagName}[${attribute.name}]`);
          if (/^(javascript|vbscript):/.test(value) || value.startsWith('data:text/html')) {
            offenders.push(`${element.tagName}[${attribute.name}]=${attribute.value}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    },
    30_000,
  );
});

describe('cleanForExport data attributes', () => {
  it('removes every data-* attribute, keeping id and class', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<p id="p1"><a class="wikilink is-unresolved" data-target="javascript:alert(1)" data-x="1">Note</a></p>';
    cleanForExport(root);
    const link = root.querySelector('a') as HTMLElement;
    expect(link.getAttributeNames()).toEqual(['class']);
    expect(root.querySelector('p')?.getAttribute('id')).toBe('p1');
    expect(root.innerHTML).not.toContain('javascript:');
  });
});
