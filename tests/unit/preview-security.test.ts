// @vitest-environment jsdom
/**
 * The malicious corpus (tests/fixtures/xss) through the block pipeline, for both flavors. Nothing
 * that executes, navigates, loads or restyles may survive. A real WebKit run of the same corpus is in
 * tests/ui/preview-security.spec.ts.
 */
import { describe, expect, it } from 'vitest';
import { createCommonMarkPipeline } from '@/preview/packs/commonmark';
import { createGfmPipeline } from '@/preview/packs/gfm';
import corpus from '../fixtures/xss/corpus.md?raw';
import { parseHtml } from './preview-helpers';

const FORBIDDEN_ELEMENTS =
  'script, iframe, object, embed, form, input, button, textarea, select, option, style, meta, base, link, template, dialog, svg, math, video, audio, source, picture, noscript';

function sanitizedCorpus(pipeline: { render(source: string): { blocks: { html: string }[] } }) {
  return pipeline
    .render(corpus)
    .blocks.map((block) => block.html)
    .join('\n');
}

describe.each([
  ['GFM', createGfmPipeline],
  ['CommonMark', createCommonMarkPipeline],
])('the XSS corpus, %s pack', (_name, create) => {
  const html = sanitizedCorpus(create());
  const root = parseHtml(html);

  it('has the whole corpus in it (the headings of the payload sections survive)', () => {
    expect(root.querySelectorAll('h2').length).toBeGreaterThanOrEqual(40);
  });

  it('has no script, iframe, object, embed, form control, style, meta, base, link, template or dialog', () => {
    expect(root.querySelectorAll(FORBIDDEN_ELEMENTS)).toHaveLength(0);
  });

  it('has no attribute that starts with "on"', () => {
    const offenders: string[] = [];
    for (const element of root.querySelectorAll('*')) {
      for (const attribute of element.attributes) {
        if (/^on/i.test(attribute.name)) offenders.push(`${element.tagName}[${attribute.name}]`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has no style attribute', () => {
    expect(root.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('has no javascript:, vbscript: or data:text/html URL in any attribute', () => {
    const offenders: string[] = [];
    for (const element of root.querySelectorAll('*')) {
      for (const attribute of element.attributes) {
        const value = attribute.value.replace(/[\s\p{Cc}]/gu, '').toLowerCase();
        if (/^(javascript|vbscript):/.test(value) || value.startsWith('data:text/html')) {
          offenders.push(`${element.tagName}[${attribute.name}]=${attribute.value}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has no srcdoc, formaction or target attribute, and no link opens a new window', () => {
    expect(root.querySelectorAll('[srcdoc], [formaction], [target]')).toHaveLength(0);
  });

  it('keeps no image source that the network or the app origin could load: every img is https, data, or deferred', () => {
    for (const image of root.querySelectorAll('img')) {
      const source = image.getAttribute('src');
      if (source !== null) expect(source).toMatch(/^(https:|data:image\/)/);
    }
  });

  it('does not let the document set the attributes the preview owns', () => {
    const risky = parseHtml(
      create().render('<img src="x.png" data-wd-src="/etc/passwd" srcset="a.png 1x">\n').blocks[0]
        ?.html ?? '',
    ).querySelector('img');
    expect(risky?.getAttribute('data-wd-src')).toBe('x.png');
    expect(risky?.hasAttribute('srcset')).toBe(false);
    expect(risky?.hasAttribute('src')).toBe(false);
  });

  it('keeps the harmless text around the payloads', () => {
    expect(root.textContent).toContain('Paragraph');
    expect(root.textContent).toContain('External link');
  });
});

describe('sanitizing details', () => {
  const pipeline = createGfmPipeline();
  const render = (markdown: string) =>
    parseHtml(
      pipeline
        .render(markdown)
        .blocks.map((block) => block.html)
        .join(''),
    );

  it('keeps heading ids that are names of document properties, but not such ids of raw HTML', () => {
    const root = render('# Links\n\n<h2 id="images">raw</h2>\n\n<p id="location">x</p>\n');
    expect(root.querySelector('h1')?.id).toBe('links');
    expect(root.querySelector('h2')?.hasAttribute('id')).toBe(false);
    expect(root.querySelector('p[id]')).toBeNull();
  });

  it('allows ordinary ids of raw HTML', () => {
    expect(render('<div id="custom">x</div>\n').querySelector('#custom')).not.toBeNull();
  });

  it('removes checkboxes and every other input of raw HTML (task boxes are spans)', () => {
    expect(render('<input type="checkbox" checked>\n').querySelectorAll('input')).toHaveLength(0);
  });

  it('removes media elements that the app cannot play', () => {
    expect(
      render('<video src="https://example.org/a.mp4" controls></video>\n').querySelector('video'),
    ).toBeNull();
  });

  it('refuses javascript: links in Markdown and raw HTML alike', () => {
    const root = render('[a](javascript:alert(1))\n\n<a href="JaVaScRiPt:alert(2)">b</a>\n');
    expect(root.querySelectorAll('a[href]')).toHaveLength(0);
  });

  it('keeps the text of a document that explains the preview attributes', () => {
    const root = render('Use `data-wd-rl="3"` as an example, and data-wd-trl="2" too.\n');
    expect(root.textContent).toContain('data-wd-trl="2"');
  });

  it('puts raw HTML of one block into that block only (an open tag does not swallow later blocks)', () => {
    const blocks = pipeline.render('<div>\n\nnext block\n').blocks;
    expect(blocks).toHaveLength(2);
    expect(parseHtml(blocks[1]?.html ?? '').querySelector('p')?.textContent).toBe('next block');
  });
});
