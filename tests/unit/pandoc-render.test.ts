// @vitest-environment jsdom
/**
 * The Pandoc pack. Structure is compared with the HTML of Pandoc
 * 3.8.3 for the same input; the rest is checked against the fixtures and the spec.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canon, HAS_PANDOC, ours, pandocHtml, pipeline, sanitized } from './pandoc-helpers';

const fixture = (name: string) =>
  readFileSync(resolve(process.cwd(), 'tests/fixtures/flavors/pandoc', name), 'utf8');

const same = (source: string, attributes: string[] = []) =>
  expect(canon(ours(source), attributes)).toBe(canon(pandocHtml(source), attributes));

describe.skipIf(!HAS_PANDOC)('structure equals Pandoc (B08, B10)', () => {
  it('headings and ids', () => {
    const doc =
      '# Intro\n\n## Intro\n\n## 1. Numbers & Things\n\n### Über uns!\n\n# 123\n\n## Section 1.2 a_b-c\n\n## Intro\n';
    same(doc, ['id']);
  });

  it('definition lists, tight and loose', () => {
    same('Term\n\n: def a\n\nTerm2\n: def b\n: def c\n\nTerm3\n: x\n\n: y\n\nEnd.\n');
    same('A\n: one\n\nB\n: two\n\nC\n\n: three\n');
  });

  it('sub, sup, strikeout', () => {
    same('H~2~O, x^2^, ~~gone~~, a ~5 and ~6, 2^10 and 3^, H~2\\ O~.\n');
  });

  it('line blocks', () => {
    same('| The first line\n| And the second\n| A third\n');
  });

  it('lists with type and start', () => {
    same('1) a\n2) b\n\n(1) c\n\ni. x\nii. y\n\nA.  big\nB.  big2\n\nb. alpha\nc. next\n\n- x\n', [
      'type',
      'start',
    ]);
    same('(@) e1\n\n(@) e2\n\n- x\n\n(@foo) e3\n(@bar) e4\n\nSee (@foo) and (@bar).\n', [
      'type',
      'start',
    ]);
  });

  it('divs and spans carry the same ids and classes except the doc- prefix', () => {
    const source = '::: {#box .note}\nText [x]{.sc}.\n\n:::: inner\nIn.\n::::\n:::\n';
    const mine = ours(source)
      .replace(/doc-/g, '')
      .replace(/fenced-div ?/g, '');
    expect(canon(mine, ['id', 'class'])).toBe(canon(pandocHtml(source), ['id', 'class']));
  });

  it('smart punctuation', () => {
    same("He said, \"Quotes.\" And 'single' too. A -- b --- c... don't.\n");
  });

  it('inline footnote text and count', () => {
    const html = ours('Text^[An inline note.] and more.\n');
    expect(html).toContain('An inline note.');
    expect(html.match(/footnote-item/g)).toHaveLength(1);
  });
});

describe('syntax fixture', () => {
  const html = ours(fixture('syntax.md'));
  it('abbreviations', () => {
    expect(html).toContain('<abbr title="Hyper Text Markup Language">HTML</abbr>');
    expect(html).not.toContain('*[HTML]');
  });
  it('example list numbers and references run through the document', () => {
    expect(html).toContain('(2).</p>');
  });
  it('attributes: heading id, namespaced classes, image width', () => {
    expect(html).toContain('<h2 id="custom-id" class="doc-doc-class">');
    expect(html).toContain('data-wd-width="50%"');
    expect(html).toContain('<div class="fenced-div doc-note" id="box">');
  });
  it('B10: application classes from a document stay namespaced', () => {
    const blocks = sanitized(fixture('syntax.md'));
    const root = document.createElement('div');
    root.innerHTML = blocks;
    expect(root.querySelector('.callout, .task-checkbox')).toBeNull();
    expect(root.querySelectorAll('.wd-block')).toHaveLength(root.children.length);
    expect(html).toContain('doc-callout doc-task-checkbox doc-wd-block');
  });
  it('B12: raw html is part of the page, raw latex is a labelled code card', () => {
    expect(html).toContain('<b>Bold text');
    expect(html).toContain('Raw LaTeX');
    expect(html).toContain('class="language-latex"');
  });
  it('code attributes give language and id', () => {
    expect(html).toContain('id="code-id" data-lang="python"');
  });
});

describe('B06 title blocks', () => {
  it('YAML', () => {
    const html = ours(fixture('title-yaml.md'));
    expect(html).toContain('<h1 class="title">Learning and Evidence in Practice</h1>');
    expect(html).toContain('<p class="subtitle">A Comprehensive Study</p>');
    expect(html).toContain(
      '<p class="author">Jane Smith <span class="affiliation">Institute for Research</span></p>',
    );
    expect(html).toContain('<p class="author">Robert Jones');
    expect(html).toContain('<p class="date">2024-10-06</p>');
    expect(html).toContain('<div class="abstract">');
  });
  it('percent lines', () => {
    const html = ours(fixture('title-percent.md'));
    expect(html).toContain('<h1 class="title">Learning and Evidence in Practice</h1>');
    expect(html).toContain('<p class="author">Jane Smith</p>');
    expect(html).toContain('<p class="date">2024-10-06</p>');
  });
  it('MMD header only in .mmd documents', () => {
    const source = fixture('title-mmd.mmd');
    const html = ours(source, '/x/a.mmd');
    expect(html).toContain('<h1 class="title">Learning and Evidence in Practice</h1>');
    expect(html).toContain('<p class="author">Jane Smith</p>');
    expect(ours(source, '/x/a.md')).not.toContain('wd-title-block');
  });
  it('is not in the outline or the counts', () => {
    const p = pipeline();
    const result = p.render('% Title\n% Me\n\nOne two.\n');
    expect(result.headings).toEqual([]);
    expect(result.stats.words).toBe(2);
  });
});

describe('B11 CriticMarkup', () => {
  const html = ours('{++add++} {--del--} {~~old~>new~~} {==mark==} {>>note<<}\n');
  it('all five forms', () => {
    expect(html).toContain('<ins class="critic">add</ins>');
    expect(html).toContain('<del class="critic">del</del>');
    expect(html).toContain('<span class="critic-sub"><del>old</del><ins>new</ins></span>');
    expect(html).toContain('<mark class="critic">mark</mark>');
    expect(html).toContain('<span class="critic-comment">note</span>');
  });
  it('counts additions, new text and highlights, not deletions, old text or comments', () => {
    const stats = pipeline().render(
      '{++add++} {--del--} {~~old~>new~~} {==mark==} {>>note<<}\n',
    ).stats;
    expect(stats.words).toBe(3);
    expect(stats.characters).toBe('add new mark'.length);
  });
});

describe('word counts', () => {
  it('sub, sup, abbreviations and line blocks count as text; code and raw do not', () => {
    const doc = 'H~2~O is [wet]{.x}.\n\n| a b\n| c\n\n```{=latex}\n\\x y z\n```\n\n    code here\n';
    expect(pipeline().render(doc).stats.words).toBe(6);
  });
});

describe('security', () => {
  it('XSS fixture leaves nothing executable', () => {
    const html = sanitized(
      readFileSync(resolve(process.cwd(), 'tests/fixtures/xss/phase2/pandoc.md'), 'utf8'),
    );
    const root = document.createElement('div');
    root.innerHTML = html;
    expect(root.querySelectorAll('script, iframe, form, input, svg, [style]')).toHaveLength(0);
    for (const element of root.querySelectorAll('*')) {
      for (const attribute of element.attributes) {
        expect(attribute.name.startsWith('on')).toBe(false);
        expect(attribute.value.replace(/\s/g, '').toLowerCase().startsWith('javascript:')).toBe(
          false,
        );
      }
    }
    expect((window as unknown as Record<string, unknown>).__XSS_SENTINEL__).toBeUndefined();
  });
});

describe('B12 raw, B10 spans, windows', () => {
  it('keeps only width and height pairs', () => {
    const html = ours('![a](b.png){width=300 onclick=x height="2em"}\n');
    expect(html).toContain('data-wd-width="300px"');
    expect(html).toContain('data-wd-height="2em"');
    expect(html).not.toContain('onclick');
  });
});
