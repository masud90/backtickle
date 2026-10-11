// @vitest-environment jsdom
/** Mermaid: the fence rule, the cleaning of diagram text, and the style-to-sheet step. */
import { describe, expect, it } from 'vitest';
import { hashString } from '@/preview/hash';
import { cleanDiagramSource } from '@/preview/mermaid/source';
import { moveStylesToSheet, parseDeclarations, safeCss, safeValue } from '@/preview/mermaid/styles';
import { createCommonMarkPipeline } from '@/preview/packs/commonmark';
import { createGfmPipeline } from '@/preview/packs/gfm';

const wrap = (md: string): string =>
  createGfmPipeline()
    .render(md)
    .blocks.map((b) => b.html)
    .join('');

describe('mermaid fence rule', () => {
  const source = 'flowchart TD\n  A[<b>x</b>] --> B\n';
  it('makes the placeholder with the escaped source and a key', () => {
    const doc = new DOMParser().parseFromString(
      wrap(`\`\`\`mermaid\n${source}\`\`\`\n`),
      'text/html',
    );
    const div = doc.querySelector('div.mermaid-diagram');
    expect(div?.getAttribute('data-diagram-key')).toBe(hashString(source));
    expect(div?.querySelector('pre.mermaid-source')?.textContent).toBe(source);
    expect(div?.querySelector('b')).toBeNull();
    expect(doc.querySelector('.code-card')).toBeNull();
  });
  it('sets features.mermaid only for a document with a diagram', () => {
    expect(createGfmPipeline().render('```mermaid\ngraph TD\n```\n').features.mermaid).toBe(true);
    expect(createGfmPipeline().render('```js\nx\n```\n').features.mermaid).toBeUndefined();
  });
  it('leaves other fences and CommonMark alone', () => {
    expect(wrap('```js\nx\n```\n')).toContain('code-card');
    const cm = createCommonMarkPipeline().render('```mermaid\ngraph TD\n```\n');
    expect(cm.blocks[0]?.html).toContain('code-card');
  });
});

describe('cleanDiagramSource', () => {
  it('removes directives, click and link lines, and config frontmatter', () => {
    const text =
      '---\ntitle: T\nconfig:\n  securityLevel: loose\n---\n%%{init: {"securityLevel":"loose","htmlLabels":true}}%%\nflowchart LR\n  A --> B\n  click A callback "x"\n  click B "javascript:alert(1)"\n';
    const out = cleanDiagramSource(text);
    expect(out).not.toMatch(/securityLevel|htmlLabels|click|javascript|config/);
    expect(out).toContain('title: T');
    expect(out).toContain('A --> B');
  });
});

describe('style to sheet', () => {
  it('parses declarations and refuses loading values', () => {
    expect(parseDeclarations('fill:#f9f;stroke : red ;bad')).toEqual([
      ['fill', '#f9f'],
      ['stroke', 'red'],
    ]);
    expect(safeValue('url(https://x.test/a.png)')).toBe(false);
    expect(safeValue('url(#marker)')).toBe(true);
    expect(parseDeclarations('background:url(https://x.test/a)')).toEqual([]);
    expect(safeCss('@import "x"; #m a{b:url(http://x)}', 'm')).toBe('');
    expect(parseDeclarations('content:"abc;fill:red')).toEqual([]);
    // A comment opened in one value could swallow the rules after it.
    expect(safeValue('red/*')).toBe(false);
    expect(safeValue('*/ red')).toBe(false);
  });
  it('moves every style attribute into the svg style element', () => {
    const doc = document.implementation.createHTMLDocument('');
    doc.body.innerHTML =
      '<svg id="m1" style="max-width: 300px"><g><rect style="fill:#f00; stroke:blue"/></g><text style="x:1;background:url(http://e.test/a)">t</text></svg>';
    const svg = doc.querySelector('svg') as Element;
    moveStylesToSheet(svg);
    expect(svg.querySelectorAll('[style]').length).toBe(0);
    expect(svg.hasAttribute('style')).toBe(false);
    const css = svg.querySelector('style')?.textContent ?? '';
    expect(css).toContain('#m1[data-wd-s="0"]{max-width:300px !important}');
    expect(css).toContain('#m1 [data-wd-s="1"]{fill:#f00 !important;stroke:blue !important}');
    expect(css).not.toContain('http');
  });
});

describe('safeCss (parse and rebuild)', () => {
  it('keeps rules scoped to the diagram id and drops everything else', () => {
    const css =
      '#m1{font:14px x !important}#m1 .a,#m1 .b>g{fill:red}#m1 .c{fill:red} body{display:none} x{;}' +
      '@media print{#m1 a{b:c}}@import "x";body,#m1 p{color:red}#m10 q{fill:red}' +
      '#m1 .d{background:url(https://e.test/a);stroke:blue}';
    const out = safeCss(css, 'm1');
    expect(out).toContain('#m1{font:14px x !important}');
    expect(out).toContain('#m1 .a,#m1 .b>g{fill:red}');
    expect(out).toContain('#m1 .d{stroke:blue}');
    expect(out).not.toMatch(/body|display|media|@import|#m10|x\{/);
  });
  it('keeps @keyframes with names scoped to the diagram id (3.L item 7, C38)', () => {
    const css =
      '@keyframes dashdraw{from{stroke-dashoffset:10}to{stroke-dashoffset:0}}' +
      '#m1 .edge{animation:dashdraw .5s linear infinite;animation-name:dashdraw}' +
      '@keyframes evil{from{background:url(https://e.test/a)}}';
    const out = safeCss(css, 'm1');
    expect(out).toContain(
      '@keyframes wd-m1-dashdraw{from{stroke-dashoffset:10}to{stroke-dashoffset:0}}',
    );
    expect(out).toContain(
      '#m1 .edge{animation:wd-m1-dashdraw .5s linear infinite;animation-name:wd-m1-dashdraw}',
    );
    expect(out).not.toMatch(/@keyframes dashdraw|e\.test/);
    expect(out).not.toContain('style=');
  });
  it('keeps a hostile classDef value inside its own rule', () => {
    const out = safeCss('#m1 .x{fill:red} body{display:none} x{;}', 'm1');
    expect(out).toBe('#m1 .x{fill:red}');
  });
});
