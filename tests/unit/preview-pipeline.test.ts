// @vitest-environment jsdom
/** The block pipeline: blocks, lines, keys, analysis, flavors, caches. */
import { describe, expect, it } from 'vitest';
import { flavorInfo } from '@/flavors';
import { createCommonMarkPipeline } from '@/preview/packs/commonmark';
import { createGfmPipeline } from '@/preview/packs/gfm';
import { loadPipeline, renderableFlavor } from '@/preview/pipeline';
import { parseHtml } from './preview-helpers';

const gfm = () => createGfmPipeline();

function blocksOf(source: string, pipeline = gfm()) {
  return pipeline.render(source).blocks;
}

describe('blocks and lines', () => {
  it('one block per top-level element, with 0-based inclusive lines', () => {
    const blocks = blocksOf(
      '# Title\n\npara one\nstill one\n\n- a\n- b\n\n> quote\n\n```\ncode\n```\n',
    );
    expect(blocks.map((b) => [b.line, b.endLine])).toEqual([
      [0, 0],
      [2, 3],
      [5, 6],
      [8, 8],
      [10, 12],
    ]);
  });

  it('leaves trailing blank lines out of a list or a quote', () => {
    const [list, quote] = blocksOf('- a\n- b\n\n\n> q\n\n\n');
    expect([list?.line, list?.endLine]).toEqual([0, 1]);
    expect([quote?.line, quote?.endLine]).toEqual([4, 4]);
  });

  it('wraps every block as div.wd-block with data-line, data-end-line and data-key', () => {
    const [block] = blocksOf('# Hi\n');
    const wrapper = parseHtml(block?.html ?? '').firstElementChild;
    expect(wrapper?.className).toBe('wd-block');
    expect(wrapper?.getAttribute('data-line')).toBe('0');
    expect(wrapper?.getAttribute('data-end-line')).toBe('0');
    expect(wrapper?.getAttribute('data-key')).toBe(block?.key);
  });

  it('works with CRLF and with a missing final newline', () => {
    const blocks = blocksOf('a\r\n\r\nb');
    expect(blocks.map((b) => [b.line, b.endLine])).toEqual([
      [0, 0],
      [2, 2],
    ]);
  });

  it('an empty document has no blocks', () => {
    const result = gfm().render('');
    expect(result.blocks).toEqual([]);
    expect(result.stats).toEqual({ words: 0, characters: 0, charactersNoSpaces: 0 });
    expect(result.headings).toEqual([]);
    expect(result.frontmatter).toBeNull();
  });

  it('footnote definitions move to one block at the end that keeps their lines', () => {
    const blocks = blocksOf('a[^1]\n\n[^1]: note\n\nlast paragraph\n');
    expect(blocks.map((b) => [b.line, b.endLine])).toEqual([
      [0, 0],
      [4, 4],
      [2, 2],
    ]);
    expect(blocks[2]?.html).toContain('section class="footnotes"');
  });
});

describe('keys', () => {
  it('a block that only moved keeps its key; a changed block gets a new one', () => {
    const before = blocksOf('one\n\ntwo\n\n- x\n- y\n');
    const after = blocksOf('new\n\none\n\ntwo\n\n- x\n- y\n');
    expect(after.slice(1).map((b) => b.key)).toEqual(before.map((b) => b.key));
    expect(after[0]?.key).not.toBe(before[0]?.key);
    const edited = blocksOf('one\n\ntwo!\n\n- x\n- y\n');
    expect(edited.map((b, i) => b.key === before[i]?.key)).toEqual([true, false, true]);
  });

  it('identical blocks have the same key', () => {
    const [a, , b] = blocksOf('same\n\nother\n\nsame\n');
    expect(a?.key).toBe(b?.key);
  });

  it('the html of a block does not contain absolute line numbers of inner elements', () => {
    const [block] = blocksOf('- a\n- b\n');
    expect(block?.html).toContain('data-wd-rl="0"');
    expect(block?.html).toContain('data-wd-rl="1"');
    const moved = blocksOf('x\n\n- a\n- b\n')[1];
    expect(moved?.html.replace(/data-line="\d+" data-end-line="\d+"/, '')).toBe(
      block?.html.replace(/data-line="\d+" data-end-line="\d+"/, ''),
    );
  });
});

describe('sanitizing is lazy and remembered', () => {
  it('sanitizes a block when its html is read, once, and takes repeats from the cache', () => {
    const pipeline = gfm();
    const first = pipeline.render('a\n\nb\n\na\n');
    expect(pipeline.counters.sanitized).toBe(0);
    expect(first.blocks[0]?.html).toContain('<p>a</p>');
    expect(pipeline.counters.sanitized).toBe(1);
    expect(first.blocks[2]?.html).toContain('<p>a</p>');
    expect(pipeline.counters.sanitized).toBe(1);
    expect(pipeline.counters.cacheHits).toBe(1);

    const second = pipeline.render('a\n\nb\n\na\n\nc\n');
    for (const block of second.blocks) block.html;
    // only "b" and the new "c" are new: "a" was seen
    expect(pipeline.counters.sanitized).toBe(3);
  });

  it('the cache is bounded', () => {
    const pipeline = createGfmPipeline({ cacheEntries: 3 });
    const source = Array.from({ length: 10 }, (_, i) => `paragraph ${i}`).join('\n\n');
    for (const block of pipeline.render(source).blocks) block.html;
    const again = pipeline.render(source);
    for (const block of again.blocks) block.html;
    expect(pipeline.counters.sanitized).toBeGreaterThan(10);
  });

  it('a property read gives the same string every time', () => {
    const [block] = blocksOf('x\n');
    expect(block?.html).toBe(block?.html);
    expect(Object.keys(block ?? {}).sort()).toEqual(['endLine', 'html', 'key', 'line']);
  });
});

describe('analysis', () => {
  it('lists headings with level, text, id and line, also inside quotes, ignoring # in code', () => {
    const { headings } = gfm().analyze(
      '# One\n\n```\n# not a heading\n```\n\n## Two *em* `code`\n\n> ### Quoted\n\nSetext\n======\n',
    );
    expect(headings).toEqual([
      { level: 1, text: 'One', id: 'one', line: 0 },
      { level: 2, text: 'Two em code', id: 'two-em-code', line: 6 },
      { level: 3, text: 'Quoted', id: 'quoted', line: 8 },
      { level: 1, text: 'Setext', id: 'setext', line: 10 },
    ]);
  });

  it('gives duplicates -1, -2 and keeps Unicode letters, digits, hyphens and underscores', () => {
    const { headings } = gfm().analyze(
      '# Same\n# Same\n# Same\n# Ünï cödé 日本語 a_b-c 3.5!\n# Same-1\n',
    );
    expect(headings.map((h) => h.id)).toEqual([
      'same',
      'same-1',
      'same-2',
      'ünï-cödé-日本語-a_b-c-35',
      'same-1-1',
    ]);
  });

  it('frontmatter counts only for a mapping at the very top', () => {
    const mapping = gfm().analyze('---\ntitle: T\ntags: [a, b]\n---\n\n# H\n');
    expect(mapping.frontmatter).toEqual({
      data: { title: 'T', tags: ['a', 'b'] },
      line: 0,
      endLine: 3,
    });
    for (const text of [
      '---\n- a\n- b\n---\n\ntext\n',
      '---\njust a string\n---\n\ntext\n',
      '---\n---\n\ntext\n',
      '---\nkey: [unclosed\n---\n\ntext\n',
      '\n---\ntitle: T\n---\n\ntext\n',
      'text\n\n---\ntitle: T\n---\n',
      '---\ntitle: T\n\ntext, never closed\n',
    ]) {
      expect(gfm().analyze(text).frontmatter, JSON.stringify(text)).toBeNull();
    }
  });

  it('frontmatter is not an element when it is not a mapping: the rule and heading stay', () => {
    const html = blocksOf('---\n- a\n---\n\ntext\n')
      .map((b) => b.html)
      .join('');
    expect(html).not.toContain('wd-frontmatter');
    expect(html).toContain('<hr>');
  });

  it('the title is the page heading only when the document has no H1', () => {
    const withoutH1 = gfm().render('---\ntitle: My Title\n---\n\ntext\n');
    expect(withoutH1.blocks[0]?.html).toContain('<h1 class="wd-frontmatter-title">My Title</h1>');
    const withH1 = gfm().render('---\ntitle: My Title\n---\n\n# Own heading\n');
    expect(withH1.blocks[0]?.html).not.toContain('<h1');
  });

  it('shows tags from a list, a comma string and hash tags, and version, date, author, other keys', () => {
    const html = gfm().render(
      '---\ntags: "a, b"\nkeywords: [k1]\ntag: "#x #y"\nversion: 2.4.0\ndate: 2024-05-01\nauthor: [Ann, Bo]\nowner: Team\nnested: {a: 1}\n---\n\n# T\n',
    ).blocks[0]?.html;
    const root = parseHtml(html ?? '');
    expect(Array.from(root.querySelectorAll('.wd-tag')).map((el) => el.textContent)).toEqual([
      '#a',
      '#b',
      '#x',
      '#y',
      'k1',
    ]);
    expect(
      Array.from(root.querySelectorAll('.wd-frontmatter-info')).map((el) => el.textContent),
    ).toEqual(['Version 2.4.0', '2024-05-01', 'Ann, Bo']);
    expect(root.querySelector('.wd-frontmatter-fields')?.textContent).toBe('ownerTeam');
  });

  it('features: math, and the code languages of the document', () => {
    const none = gfm().render('plain\n');
    expect(none.features).toEqual({ math: false, languages: [] });
    const rich = gfm().render('$x$\n\n```Python\na\n```\n\n```ts\nb\n```\n\n```\nc\n```\n');
    expect(rich.features).toEqual({ math: true, languages: ['python', 'ts'] });
    expect(gfm().render('```math\nx\n```\n').features.math).toBe(true);
    expect(gfm().render('costs $5 and $10\n').features.math).toBe(false);
  });
});

describe('flavors', () => {
  const table = '| a | b |\n| - | - |\n| 1 | 2 |\n';
  const html = (pipeline: ReturnType<typeof gfm>, source: string) =>
    pipeline
      .render(source)
      .blocks.map((b) => b.html)
      .join('');

  it('CommonMark renders a GFM table and a task list as plain paragraphs and lists', () => {
    const common = createCommonMarkPipeline();
    expect(html(common, table)).toContain('<p>| a | b |');
    expect(html(common, table)).not.toContain('<table');
    const tasks = parseHtml(html(common, '- [ ] open\n- [x] done\n'));
    expect(tasks.querySelector('.task-checkbox')).toBeNull();
    expect(tasks.querySelector('li')?.textContent?.trim()).toBe('[ ] open');
  });

  it('CommonMark has no strikethrough, autolink literals, footnotes, alerts, math or emoji', () => {
    const common = createCommonMarkPipeline();
    const out = html(
      common,
      '~~gone~~ www.example.com\n\n[^1]\n\n> [!NOTE]\n> text\n\n$x$ :tada:\n',
    );
    expect(out).not.toMatch(/<del|<a |footnote|callout|class="math/);
    expect(out).toContain('~~gone~~');
    expect(out).toContain('[!NOTE]');
    expect(out).toContain(':tada:');
  });

  it('GFM has them', () => {
    const out = html(gfm(), table);
    expect(out).toContain('<table');
  });

  it('commonmark and gfm packs keep code cards and heading ids', () => {
    for (const pipeline of [createCommonMarkPipeline(), gfm()]) {
      const out = html(pipeline, '# Head\n\n```js\nx\n```\n');
      expect(out).toContain('id="head"');
      expect(out).toContain('class="code-card"');
    }
  });

  it('loadPipeline loads a pack per renderable flavor; unavailable flavors render as GFM', async () => {
    expect(renderableFlavor('commonmark')).toBe('commonmark');
    expect(renderableFlavor('pandoc')).toBe('pandoc');
    expect(renderableFlavor('mdx')).toBe('mdx');
    expect(renderableFlavor('obsidian')).toBe('obsidian');
    expect(renderableFlavor('quarto')).toBe('quarto');
    for (const id of ['gfm'] as const) {
      expect(renderableFlavor(id)).toBe('gfm');
      expect(flavorInfo(id).renderAs === 'gfm' || id === 'gfm').toBe(true);
    }
    const common = await loadPipeline('commonmark');
    const github = await loadPipeline('gfm');
    expect(common.flavor).toBe('commonmark');
    expect(github.flavor).toBe('gfm');
    expect(renderableFlavor('mdx')).toBe('mdx');
    const mdx = await loadPipeline('mdx');
    expect(mdx.flavor).toBe('mdx');
    expect(await loadPipeline('mdx')).toBe(mdx);
    expect(await loadPipeline('commonmark')).toBe(common);
  });
});

describe('emoji shortcodes', () => {
  const text = (markdown: string) => {
    const [block] = blocksOf(markdown);
    return parseHtml(block?.html ?? '').textContent?.trim();
  };

  it('replaces known shortcodes with the character, also with + in the name', () => {
    expect(text('a :tada: b :+1: c\n')).toBe('a \u{1F389} b \u{1F44D} c');
  });

  it('leaves unknown names, text shortcuts, times and addresses alone', () => {
    expect(text(':nosuchemoji: :) 10:30:45\n')).toBe(':nosuchemoji: :) 10:30:45');
    expect(text('http://example.org:8080/a:b:c\n')).toContain('8080/a:b:c');
  });

  it('does not replace inside code, after an escape, or inside an autolink', () => {
    expect(text('`:tada:` and \\:tada: and <https://example.org/:tada:>\n')).toBe(
      ':tada: and :tada: and https://example.org/:tada:',
    );
  });

  it('finds a shortcode that starts at the second colon of an unknown one', () => {
    expect(text('a:nosuch:tada:\n')).toBe('a:nosuch\u{1F389}');
  });

  it('does not touch the colons of a web address in plain text', () => {
    expect(text('see https://example.org/a:b:c and www.example.org/:tada: now\n')).toBe(
      'see https://example.org/a:b:c and www.example.org/:tada: now',
    );
  });

  it('is GFM only: CommonMark keeps the text', () => {
    const [block] = blocksOf(':tada:\n', createCommonMarkPipeline());
    expect(block?.html).toContain(':tada:');
  });
});

describe('raw HTML and edge cases', () => {
  it('a raw HTML block is one block, sanitized inside its wrapper', () => {
    const [block] = blocksOf('<details>\n<summary>S</summary>\nbody\n</details>\n');
    expect(
      parseHtml(block?.html ?? '').querySelector('.wd-block > details > summary')?.textContent,
    ).toBe('S');
  });

  it('link reference definitions produce no block of their own but resolve links', () => {
    const blocks = blocksOf('[a][x]\n\n[x]: https://example.org\n');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.html).toContain('href="https://example.org"');
  });

  it('the same HTML from different tokens is counted by its tokens: autolink text is not prose, link text is', () => {
    const pipeline = gfm();
    const autolink = pipeline.render('<https://example.org>\n').stats.words;
    const link = pipeline.render('[https://example.org](https://example.org)\n').stats.words;
    expect(autolink).toBe(0);
    expect(link).toBeGreaterThan(0);
    // and a raw HTML paragraph is not prose, the same markup as Markdown is
    expect(pipeline.render('<p>text</p>\n').stats.words).toBe(0);
    expect(pipeline.render('text\n').stats.words).toBe(1);
  });

  it('a very long document keeps strictly increasing lines', () => {
    const source = Array.from({ length: 2000 }, (_, i) => `paragraph ${i}`).join('\n\n');
    const { blocks } = gfm().render(source);
    expect(blocks).toHaveLength(2000);
    for (let i = 1; i < blocks.length; i++) {
      expect((blocks[i]?.line ?? 0) > (blocks[i - 1]?.line ?? 0)).toBe(true);
    }
  });
});
