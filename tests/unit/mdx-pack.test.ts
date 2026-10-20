// The MDX pack sanitizes with DOMPurify, which needs jsdom.
// @vitest-environment jsdom
/**
 * The MDX pack: the fixtures through the
 * pack, the error line, the word counts, the malicious file, and the rule that nothing is run.
 * Expected values come from the fixture files (line numbers counted in them), from the spec, and
 * from word counts done by hand in the comments.
 */
import { describe, expect, it } from 'vitest';
import { createMdxPipeline } from '@/preview/packs/mdx';
import guideSource from '../../src/content/guides/mdx.md?raw';
import indexSource from '../../src/preview/packs/mdx/index.ts?raw';
import parseSource from '../../src/preview/packs/mdx/parse.ts?raw';
import renderSource from '../../src/preview/packs/mdx/render.ts?raw';
import componentsSource from '../fixtures/flavors/mdx/components.mdx?raw';
import errorSource from '../fixtures/flavors/mdx/error.mdx?raw';
import xssSource from '../fixtures/xss/phase2/mdx.mdx?raw';
import { parseHtml } from './preview-helpers';

const pipeline = createMdxPipeline();

function page(source: string): HTMLElement {
  return parseHtml(
    pipeline
      .render(source)
      .blocks.map((block) => block.html)
      .join('\n'),
  );
}

describe('MDX: components.mdx (B23)', () => {
  const result = pipeline.render(componentsSource);
  const root = parseHtml(result.blocks.map((block) => block.html).join('\n'));

  it('parses without an error', () => {
    expect(result.error).toBeUndefined();
    expect(result.blocks.length).toBeGreaterThan(10);
  });

  it('shows the frontmatter header (the document has a heading, so no title in it)', () => {
    expect(root.querySelector('header.wd-frontmatter')).not.toBeNull();
    expect(result.frontmatter).toEqual({ data: { title: 'Components' }, line: 0, endLine: 2 });
  });

  it('collapses ESM into details.mdx-esm with a JavaScript card, not open', () => {
    const esm = [...root.querySelectorAll('details.mdx-esm')];
    expect(esm).toHaveLength(2);
    expect(esm[0]?.hasAttribute('open')).toBe(false);
    expect(esm[0]?.querySelector('summary')?.textContent).toBe('import and export, 2 lines');
    expect(esm[1]?.querySelector('summary')?.textContent).toBe('import and export, 4 lines');
    expect(esm[0]?.querySelector('.code-card[data-lang="js"] code')?.textContent).toContain(
      "import React from 'react'",
    );
  });

  it('draws a component with its name, props (name and literal source) and Markdown children', () => {
    const callout = root.querySelector('div.mdx-component[data-name="Callout"]');
    expect(callout?.querySelector('.mdx-component-header > .mdx-component-name')?.textContent).toBe(
      'Callout',
    );
    const props = [...(callout?.querySelectorAll('.mdx-props > .mdx-prop') ?? [])].map(
      (prop) => prop.textContent,
    );
    expect(props).toEqual(['type="info"', 'count={3}', 'open']);
    const children = callout?.querySelector('.mdx-component-children');
    expect(children?.querySelector('strong')?.textContent).toBe('bold');
    expect(children?.querySelectorAll('ul > li')).toHaveLength(2);
  });

  it('draws a component without children without a children box', () => {
    const chart = root.querySelector('div.mdx-component[data-name="Chart"]');
    const props = [...(chart?.querySelectorAll('.mdx-prop') ?? [])].map((prop) => prop.textContent);
    expect(props).toEqual(['data={[1, 2, 3]}', 'title="Sales"']);
    expect(chart?.querySelector('.mdx-component-children')).toBeNull();
  });

  it('nests components, and draws a component inside a line as span.mdx-component.is-inline', () => {
    const tabs = root.querySelector('div.mdx-component[data-name="Tabs"]');
    expect(tabs?.querySelector('span.mdx-component.is-inline[data-name="Tab"]')).not.toBeNull();
    const kbd = root.querySelector('p > span.mdx-component.is-inline[data-name="Kbd"]');
    expect(kbd?.querySelector('.mdx-component-children')?.textContent).toBe('Cmd');
    expect(kbd?.parentElement?.textContent).toContain('Press');
  });

  it('writes lower-case elements as HTML with the class namespaced', () => {
    expect(root.querySelector('div.doc-note')?.textContent).toBe('plain');
    expect(root.querySelector('div[class="note"]')).toBeNull();
    expect(root.querySelector('details:not(.mdx-esm) > summary')?.textContent).toBe('More');
    // A paragraph that holds only block-level HTML is not wrapped in a p.
    expect(root.querySelector('p > details')).toBeNull();
  });

  it('shows expressions as code and drops comment-only expressions', () => {
    const expressions = [...root.querySelectorAll('code.mdx-expression')].map(
      (code) => code.textContent,
    );
    expect(expressions).toEqual(['{1 + 1}', '{props.name}']);
    expect(root.textContent).not.toContain('Fixture for MDX');
  });

  it('checks for comment-only expressions without catastrophic backtracking', () => {
    // Empty comments, then `x`: the old pattern took seconds on 30 of them.
    const start = performance.now();
    const root = page(`{/*${'*//*'.repeat(30)}*/ x}\n`);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(root.querySelector('code.mdx-expression')).not.toBeNull();
    expect(page('{/* a */ /* b */}\n').querySelector('code.mdx-expression')).toBeNull();
  });

  it('gives GFM constructs the Phase 1 structures', () => {
    expect(root.querySelectorAll('table > thead > tr > th')).toHaveLength(2);
    expect(root.querySelectorAll('table > tbody > tr > td')).toHaveLength(2);
    const tasks = [...root.querySelectorAll('li.task-list-item')];
    expect(tasks.map((task) => task.classList.contains('is-checked'))).toEqual([true, false]);
    const box = tasks[0]?.querySelector('span.task-checkbox');
    expect(box?.getAttribute('role')).toBe('checkbox');
    expect(box?.getAttribute('aria-checked')).toBe('true');
    expect(root.querySelector('ul.contains-task-list')).not.toBeNull();
    expect(root.querySelector('del')?.textContent).toBe('strike');
    expect(root.querySelector('sup.footnote-ref > a[href="#fn1"]')).not.toBeNull();
    expect(root.querySelector('section.footnotes li#fn1')?.textContent).toContain(
      'This is a footnote.',
    );
    expect(root.querySelector('span.math.math-inline[data-tex="x^2"]')).not.toBeNull();
    expect(result.features.math).toBe(true);
  });

  it('gives every block its lines from the source (1-based lines of the file minus one)', () => {
    // Counted in tests/fixtures/flavors/mdx/components.mdx.
    const lines = result.blocks.map((block) => [block.line, block.endLine]);
    expect(lines[0]).toEqual([0, 2]); // frontmatter
    expect(lines).toContainEqual([6, 7]); // the imports
    expect(lines).toContainEqual([9, 12]); // export const meta
    expect(lines).toContainEqual([14, 14]); // # Heading
    expect(lines).toContainEqual([16, 23]); // <Callout> ... </Callout>
    expect(lines).toContainEqual([25, 25]); // <Chart ... />
    expect(lines).toContainEqual([27, 29]); // <Tabs> ... </Tabs>
    expect(lines).toContainEqual([41, 43]); // the table
    // The footnote definition (line 53 of the file) is listed in a block that keeps its line.
    expect(lines).toContainEqual([52, 52]);
    expect(root.querySelector('[data-line]')).not.toBeNull();
  });

  it('lists the heading with its id and line', () => {
    expect(result.headings).toEqual([{ level: 1, text: 'Heading', id: 'heading', line: 14 }]);
  });

  it('wraps blocks the way the preview expects, and keeps the key of a block that only moved', () => {
    const first = pipeline.render('# T\n\n- [x] a\n- [ ] b\n').blocks;
    const moved = pipeline.render('\n\n\nintro\n\n# T\n\n- [x] a\n- [ ] b\n').blocks;
    expect(first[1]?.html).toMatch(/^<div class="wd-block" data-line="2" data-end-line="3"/);
    expect(moved[2]?.key).toBe(first[1]?.key);
    expect(moved[2]?.line).toBe(7);
  });
});

describe('MDX: error.mdx (B24)', () => {
  it('returns the parser error with its 1-based line and no blocks', () => {
    const result = pipeline.render(errorSource);
    // <Callout> is opened on line 15 of the file and never closed (the comment in the fixture
    // says 12, but the parser is right: `grep -n Callout` gives 15).
    expect(errorSource.split('\n')[14]).toBe('<Callout>');
    expect(result.error?.line).toBe(15);
    expect(result.error?.message).toContain('closing tag');
    expect(result.error?.message).toContain('<Callout>');
    expect(result.error?.message).not.toMatch(/\(\d+:\d+/);
    expect(result.blocks).toEqual([]);
  });

  it('takes the line from the parser for other errors too', () => {
    expect(pipeline.render('# T\n\nok\n\n{1 +').error?.line).toBe(5);
    expect(pipeline.render('# T\n\n<a>\n\n</b>\n').error?.line).toBe(5);
    expect(pipeline.render('text\n\n<A b=c />\n').error?.line).toBe(3);
  });

  it('has no error for a document that parses again after the fix', () => {
    const fixed = errorSource.replace('<Callout>', '<Callout>\n\n</Callout>');
    const result = pipeline.render(fixed);
    expect(result.error).toBeUndefined();
    expect(result.blocks.length).toBeGreaterThan(3);
  });

  it('counts the prose of text that does not parse (a selection often is half a tag)', () => {
    const stats = pipeline.analyze('<Callout title="x">hello world').stats;
    expect(stats.words).toBe(2);
  });
});

describe('MDX: the guide', () => {
  it('parses and has its sections as headings', () => {
    const result = pipeline.render(guideSource);
    expect(result.error).toBeUndefined();
    const titles = result.headings.filter((heading) => heading.level === 2).map((h) => h.text);
    expect(titles).toContain('Imports and exports');
    expect(titles).toContain('Inline components');
    expect(titles).toContain('Errors');
  });
});

describe('MDX: GFM constructs and details', () => {
  it('renders alerts as callouts', () => {
    const root = page('> [!WARNING]\n> Careful.\n');
    expect(root.querySelector('div.callout.callout-warning > p.callout-title')?.textContent).toBe(
      'Warning',
    );
    expect(root.querySelector('div.callout > p:not(.callout-title)')?.textContent).toBe('Careful.');
  });

  it('renders aligned tables, loose lists, code cards and display math', () => {
    const root = page(
      '| a | b |\n|:-:|--:|\n| 1 | 2 |\n\n- one\n\n- two\n\n```python\nx = 1\n```\n\n$$\nE = mc^2\n$$\n',
    );
    expect(root.querySelector('th.align-center')).not.toBeNull();
    expect(root.querySelector('td.align-right')).not.toBeNull();
    expect(root.querySelectorAll('li > p')).toHaveLength(2);
    expect(
      root.querySelector('.code-card[data-lang="python"] code.language-python'),
    ).not.toBeNull();
    expect(root.querySelector('div.math.math-display[data-tex="E = mc^2"]')).not.toBeNull();
  });

  it('numbers footnotes in the order of their first reference', () => {
    const root = page('B[^b] and A[^a].\n\n[^a]: Note A.\n\n[^b]: Note B.\n');
    expect(root.querySelector('a#fnref1')?.getAttribute('href')).toBe('#fn1');
    expect(root.querySelector('li#fn1')?.textContent).toContain('Note B.');
    expect(root.querySelector('li#fn2')?.textContent).toContain('Note A.');
  });

  it('puts heading ids on headings, also inside components', () => {
    const result = pipeline.render('# One\n\n<Box>\n\n## Two\n\n</Box>\n\n## Two\n');
    expect(result.headings.map((heading) => heading.id)).toEqual(['one', 'two', 'two-1']);
    const root = parseHtml(result.blocks.map((block) => block.html).join(''));
    expect(root.querySelector('h2#two')).not.toBeNull();
  });

  it('shows a title in the frontmatter header only when there is no heading of level 1', () => {
    expect(
      page('---\ntitle: Hello\n---\n\ntext\n').querySelector('h1.wd-frontmatter-title'),
    ).not.toBeNull();
    expect(
      page('---\ntitle: Hello\n---\n\n# Mine\n').querySelector('h1.wd-frontmatter-title'),
    ).toBeNull();
  });

  it('does not run an indented block as code (MDX has no indented code)', () => {
    expect(page('para\n\n    indented\n').querySelector('.code-card')).toBeNull();
  });
});

describe('MDX: word counts (children count; props, expressions and ESM do not)', () => {
  const words = (source: string) => pipeline.analyze(source).stats.words;

  it('counts the prose of components.mdx', () => {
    // Counted by hand: Heading 1; Callout children "This is a paragraph with bold text." 7,
    // "List item 1" 3, "List item 2" 3; Tab "Text A" 2; "Press Cmd now." 3; "plain" 1;
    // "More" and "Hidden" 2; table 4 cells of 2 words 8; two tasks 2 + 2; "This is strike text." 4;
    // "Note" 1 and the footnote "This is a footnote." 4. The imports, export, props, the two
    // expressions and the formula add nothing. Total 43.
    expect(words(componentsSource)).toBe(43);
  });

  it('counts the children of a component and not its props', () => {
    expect(
      words('<Banner title="Several words in a title" count={42}>\n\ntwo words\n\n</Banner>\n'),
    ).toBe(2);
  });

  it('does not count ESM, expressions or comments', () => {
    expect(
      words(
        "import X from './x'\n\nexport const a = 'one two three'\n\nhello {a + b} world {/* c */}\n",
      ),
    ).toBe(2);
  });

  it('counts the text of inline components', () => {
    expect(words('Press <Kbd>Cmd</Kbd> now.')).toBe(3);
  });

  it('does not count the URL of an autolink, but counts the text of a link', () => {
    expect(words('See https://example.org/page here.')).toBe(2);
    expect(words('See [the page](https://example.org/page) here.')).toBe(4);
  });

  it('does not count frontmatter, code or math', () => {
    expect(
      words('---\ntitle: A title\n---\n\n```js\nlet a = 1\n```\n\n$x$ and $$y + z$$\n\nword\n'),
    ).toBe(2);
  });

  it('counts characters with the spaces and without (graphemes of the prose)', () => {
    const stats = pipeline.analyze('Hello **big** world\n').stats;
    expect(stats).toEqual({ words: 3, characters: 15, charactersNoSpaces: 13 });
  });

  it('keeps the words of block-level HTML apart', () => {
    expect(words('<details><summary>More</summary>Hidden</details>')).toBe(2);
  });
});

describe('MDX: security (B24 corpus)', () => {
  /** The cases of tests/fixtures/xss/phase2/mdx.mdx: the chunks separated by blank lines. */
  const cases = xssSource
    .split(/\n\n+/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk !== '' && !chunk.startsWith('{/*'));

  const FORBIDDEN =
    'script, iframe, object, embed, form, input, button, textarea, select, option, style, meta, base, link, template, dialog, svg, math, video, audio, source, picture, noscript';

  function check(html: string) {
    const root = parseHtml(html);
    expect(root.querySelectorAll(FORBIDDEN)).toHaveLength(0);
    for (const element of root.querySelectorAll('*')) {
      for (const attribute of element.attributes) {
        expect(attribute.name).not.toMatch(/^on/i);
        expect(attribute.name).not.toBe('style');
        expect(attribute.value.replace(/\s/g, '').toLowerCase()).not.toMatch(/^javascript:/);
      }
    }
    expect((globalThis as { __XSS_SENTINEL__?: unknown }).__XSS_SENTINEL__).toBeUndefined();
  }

  it('has the cases of the fixture', () => {
    expect(cases.length).toBeGreaterThanOrEqual(7);
  });

  it('renders no case in a way that runs or keeps anything dangerous', () => {
    for (const source of cases) {
      const result = pipeline.render(source);
      // Some cases are parse errors (an unquoted attribute): nothing is rendered at all.
      check(result.blocks.map((block) => block.html).join('\n'));
    }
    check(
      pipeline
        .render(xssSource)
        .blocks.map((block) => block.html)
        .join('\n'),
    );
  });

  it('draws the cases that do parse, without the payloads', () => {
    const link = page('<a href="javascript:window.__XSS_SENTINEL__ = true">Link</a>\n');
    check(link.innerHTML);
    expect(link.querySelector('a[href]')).toBeNull();
    expect(link.textContent).toContain('Link');

    const expression = page("{eval('window.__XSS_SENTINEL__ = true')}\n");
    expect(expression.querySelector('code.mdx-expression')?.textContent).toBe(
      "{eval('window.__XSS_SENTINEL__ = true')}",
    );

    const esm = page('export const x = (() => { window.__XSS_SENTINEL__ = true })()\n');
    expect(esm.querySelector('details.mdx-esm')).not.toBeNull();
    check(esm.innerHTML);

    const script = page('<script>\n  window.__XSS_SENTINEL__ = true\n</script>\n\ntext\n');
    expect(script.querySelector('script')).toBeNull();
    expect(script.textContent).not.toContain('__XSS_SENTINEL__');

    const inline = page(
      '<div dangerouslySetInnerHTML={{__html: "x"}} onClick="x()" style="color:red" data-line="1">t</div>\n',
    );
    const div = inline.querySelector('.wd-block > div');
    expect(div?.attributes.length ?? 0).toBe(0);
    expect(div?.textContent).toBe('t');

    const component = page('<Foo style={{color: "red"}} onClick={x} />\n');
    expect(component.querySelector('[style]')).toBeNull();
    expect(component.querySelector('.mdx-prop')?.textContent).toBe('style={{color: "red"}}');
  });

  it('namespaces the classes of lower-case elements, so a document cannot claim an app class', () => {
    const root = page('<div className="callout wd-block task-checkbox">x</div>\n');
    expect(root.querySelector('.wd-block > div')?.className).toBe(
      'doc-callout doc-wd-block doc-task-checkbox',
    );
    expect(root.querySelector('.callout')).toBeNull();
  });

  it('turns images into deferred sources like every other image', () => {
    const root = page('<img src="a.png" alt="x" />\n\n![y](b.png)\n');
    for (const image of root.querySelectorAll('img')) {
      expect(image.hasAttribute('src')).toBe(false);
      expect(image.hasAttribute('data-wd-src')).toBe(true);
    }
  });

  it('never evaluates, constructs functions from, or imports anything from the document', () => {
    const code = [indexSource, parseSource, renderSource].join('\n');
    expect(code).not.toMatch(/\beval\s*\(/);
    expect(code).not.toMatch(/new\s+Function\b/);
    expect(code).not.toMatch(/\bFunction\s*\(/);
    expect(code).not.toMatch(/\bimport\s*\(/);
    expect(code).not.toMatch(/\.innerHTML\s*=/);
  });
});

describe('MDX: dollar math follows the Pandoc rule (3.L item 6, C38)', () => {
  const inline = (source: string) => page(source).querySelectorAll('span.math-inline').length;

  it('keeps prices as text', () => {
    expect(inline('It costs $5 and $10 today.\n')).toBe(0);
    expect(page('It costs $5 and $10 today.\n').textContent).toContain('$5 and $10');
  });
  it('accepts "$x$"', () => {
    expect(page('so $x$ here\n').querySelector('span.math-inline')?.getAttribute('data-tex')).toBe(
      'x',
    );
  });
  it('rejects a space after the opening dollar', () => {
    expect(inline('a $ x$ b\n')).toBe(0);
    expect(page('a $ x$ b\n').textContent).toContain('$ x$');
  });
  it('rejects a space before the closing dollar', () => {
    expect(inline('a $x $ b\n')).toBe(0);
    expect(page('a $x $ b\n').textContent).toContain('$x $');
  });
  it('rejects a digit right after the closing dollar', () => {
    expect(inline('a $x$5 b\n')).toBe(0);
    expect(page('a $x$5 b\n').textContent).toContain('$x$5');
  });
  it('keeps display math blocks', () => {
    const root = page('$$\nE = mc^2\n$$\n');
    expect(root.querySelector('div.math-display')?.getAttribute('data-tex')).toBe('E = mc^2');
  });
});
