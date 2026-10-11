// @vitest-environment jsdom
/**
 * A large source is parsed one window at a time (src/preview/windows.ts). The result must be the
 * same as that of one parse of the whole document: the cuts are made only where nothing can reach
 * across them. These tests cut at the places the rules allow, and compare everything the pipeline
 * returns (blocks with their keys, lines and HTML, headings, counts, frontmatter, features) with
 * the result for the document as a whole, on the fixtures and on random documents that are full
 * of the constructs that make a cut unsafe.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCommonMarkPipeline } from '@/preview/packs/commonmark';
import { createGfmPipeline } from '@/preview/packs/gfm';
import type { RenderResult } from '@/preview/types';
import { splitSource } from '@/preview/windows';

const SMALL = { minChars: 0, windowChars: 1 };

function cuts(text: string, options = SMALL): number[] | null {
  const windows = splitSource(text, options);
  return windows ? windows.map((window) => window.line) : null;
}

describe('where a source is cut', () => {
  it('leaves a short source alone', () => {
    expect(splitSource('a\n\nb\n\nc\n')).toBeNull();
    expect(splitSource('a\n\nb\n\nc\n', { minChars: 1 << 20 })).toBeNull();
  });

  it('cuts in front of a paragraph that follows a blank line, and counts the lines', () => {
    expect(cuts('one\n\ntwo\n\nthree\n')).toEqual([0, 2, 4]);
    const windows = splitSource('one\n\ntwo\n\nthree\n', SMALL);
    expect(windows?.map((window) => window.text)).toEqual(['one\n\n', 'two\n\n', 'three\n']);
  });

  it('does not cut without a blank line, or before an indented line', () => {
    expect(cuts('one\ntwo\nthree\n')).toBeNull();
    expect(cuts('one\n\n  two\n\nthree\n')).toEqual([0, 4]);
    expect(cuts('one\n\n\ttwo\n\nthree\n')).toEqual([0, 4]);
    expect(cuts('    code\n\n    more code\n\nafter\n')).toEqual([0, 4]);
  });

  it('does not cut in front of a list marker: a list goes on across blank lines', () => {
    expect(cuts('- a\n\n- b\n\n* c\n\n+ d\n\n1. e\n\n2) f\n')).toBeNull();
    expect(cuts('text\n\n-not a marker\n\nmore\n')).toEqual([0, 2, 4]);
  });

  it('does not cut inside a fenced code block, whatever it contains', () => {
    expect(cuts('```\na\n\nb\n```\n\nafter\n')).toEqual([0, 6]);
    expect(cuts('~~~\na\n\nb\n~~~\n\nafter\n')).toEqual([0, 6]);
    // A shorter or different marker does not close it.
    expect(cuts('````\na\n```\n\nb\n````\n\nafter\n')).toEqual([0, 7]);
    expect(cuts('```\na\n~~~\n\nb\n```\n\nafter\n')).toEqual([0, 7]);
    // An unclosed fence runs to the end of the document.
    expect(cuts('```\na\n\nb\n\nc\n')).toBeNull();
  });

  it('does not cut in an HTML block that only a closing marker ends', () => {
    expect(cuts('<!--\na\n\nb\n-->\n\nafter\n')).toEqual([0, 6]);
    expect(cuts('<pre>\na\n\nb\n</pre>\n\nafter\n')).toEqual([0, 6]);
    // Indented, so a list item or a quote may hold it, and where that ends is unclear.
    expect(cuts('- a\n  <!--\n\n  b\n  -->\n\nafter\n')).toBeNull();
    expect(cuts('<script>\na\n\nb\n</SCRIPT>\n\nafter\n')).toEqual([0, 6]);
    // Closed on the same line: nothing stays open.
    expect(cuts('<!-- a -->\n\nb\n\nc\n')).toEqual([0, 2, 4]);
    // A block that a blank line ends can be cut after.
    expect(cuts('<div>\na\n\nb\n</div>\n\nafter\n')).toEqual([0, 3, 6]);
    // A fence opener right after HTML, with no blank line between, is HTML or a fence, unclear.
    expect(cuts('<div>\n```\n\nx\n\nafter\n')).toBeNull();
  });

  it('gives up on a $$ that opens a formula over several lines, not on one-line formulas', () => {
    expect(cuts('$$\na\n\nb\n$$\n\nafter\n')).toBeNull();
    expect(cuts('text\n\n$$ a\n\nb $$\n\nafter\n')).toBeNull();
    expect(cuts('text\n\n> $$\n> a\n> $$\n\nafter\n')).toBeNull();
    expect(cuts('$$ a $$\n\nb\n\nc\n')).toEqual([0, 2, 4]);
    expect(cuts('text with $$ inside\n\nb\n\nc\n')).toEqual([0, 2, 4]);
  });

  it('does not cut in the frontmatter', () => {
    expect(cuts('---\ntitle: x\n\ntags: y\n---\n\nbody\n\nmore\n')).toEqual([0, 6, 8]);
  });

  it('gives up on a document with a link definition or a footnote, and on an unclear fence', () => {
    expect(cuts('a\n\n[x]: http://example.org\n\nb\n')).toBeNull();
    expect(cuts('a\n\ntext[^1]\n\n[^1]: note\n\nb\n')).toBeNull();
    expect(cuts('a\n\n> [x]: http://example.org\n\nb\n')).toBeNull();
    expect(cuts('a\n\n- [x]: http://example.org\n\nb\n')).toBeNull();
    // A fence that is indented and then closed (or left) at a smaller indent.
    expect(cuts('- item\n\n  ```\n  code\n```\n\ntext\n\nmore\n')).toBeNull();
    expect(cuts('- item\n\n  ```\n  code\n\nless\n\nmore\n')).toBeNull();
    // An indented fence that is closed properly is fine.
    expect(cuts('- item\n\n  ```\n  code\n\n  more\n  ```\n\ntext\n')).toEqual([0, 8]);
  });
});

// ---- the result is the same as that of one parse ---------------------------------------------

function makePair(flavor: 'gfm' | 'commonmark') {
  const make = flavor === 'gfm' ? createGfmPipeline : createCommonMarkPipeline;
  return {
    whole: make({ windowMinChars: Number.POSITIVE_INFINITY }),
    windowed: make({ windowMinChars: 0, windowChars: 1 }),
  };
}

// One pair per flavor for all documents: a pipeline is expensive to make, and its caches are keyed
// by content, so sharing them does not change a result.
const pairs: Partial<Record<'gfm' | 'commonmark', ReturnType<typeof makePair>>> = {};
function pipelines(flavor: 'gfm' | 'commonmark') {
  let pair = pairs[flavor];
  if (!pair) {
    pair = makePair(flavor);
    pairs[flavor] = pair;
  }
  return pair;
}

function plain(result: RenderResult) {
  return {
    blocks: result.blocks.map((block) => ({
      key: block.key,
      line: block.line,
      endLine: block.endLine,
      html: block.html,
    })),
    headings: result.headings,
    stats: result.stats,
    frontmatter: result.frontmatter,
    features: result.features,
  };
}

/** Compares a document rendered whole and in windows. Returns the number of windows used. */
function compare(source: string, flavor: 'gfm' | 'commonmark' = 'gfm', label = ''): number {
  const { whole, windowed } = pipelines(flavor);
  const wholeResult = whole.render(source);
  const before = (windowed as unknown as { counters: { windows: number } }).counters.windows;
  const windowedResult = windowed.render(source);
  const used = (windowed as unknown as { counters: { windows: number } }).counters.windows - before;
  expect(plain(windowedResult), label).toEqual(plain(wholeResult));
  const wholeAnalysis = whole.analyze(source);
  const windowedAnalysis = windowed.analyze(source);
  expect(windowedAnalysis, label).toEqual(wholeAnalysis);
  return used;
}

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('windows give the result of one parse', () => {
  it('the built-in guides and the sample documents', () => {
    for (const path of [
      'src/content/guides/gfm.md',
      'src/content/guides/commonmark.md',
      'tests/fixtures/wireframe-sample.md',
      'tests/fixtures/perf/wireframe-sample-phase0.md',
    ]) {
      compare(read(path), 'gfm', path);
      compare(read(path), 'commonmark', path);
    }
  });

  it('the generated 100 KiB document, cut into many windows', () => {
    const used = compare(read('tests/fixtures/generated/large-100k.md'), 'gfm', 'large-100k');
    expect(used).toBeGreaterThan(10);
  });

  it('a heading that repeats in a later window gets the same id', () => {
    const source = '# Intro\n\ntext\n\n## Intro\n\ntext\n\n## Intro\n\nmore\n';
    expect(compare(source)).toBeGreaterThan(2);
  });

  it('lines of headings and of task items are lines of the document', () => {
    const source = 'para\n\n# One\n\n- [ ] a\n- [x] b\n\npara\n\n## Two\n\n- [ ] c\n';
    expect(compare(source)).toBeGreaterThan(2);
    const heading = pipelines('gfm').windowed.render(source).headings;
    expect(heading.map((h) => h.line)).toEqual([2, 9]);
  });

  it('the frontmatter shows its title unless a later window has an H1', () => {
    const body = 'text\n\nmore\n\n# Page heading\n\nend\n';
    const without = '---\ntitle: The title\n---\n\ntext\n\nmore\n\nend\n';
    expect(compare(`---\ntitle: The title\ntags: [a, b]\n---\n\n${body}`)).toBeGreaterThan(2);
    expect(compare(without)).toBeGreaterThan(2);
    const html = pipelines('gfm').windowed.render(without).blocks[0]?.html ?? '';
    expect(html).toContain('wd-frontmatter-title');
    const html2 = pipelines('gfm').windowed.render(`---\ntitle: T\n---\n\n${body}`).blocks[0]?.html;
    expect(html2).not.toContain('wd-frontmatter-title');
  });

  it('a window that starts with --- is not frontmatter', () => {
    const source = 'first\n\n---\ntitle: x\n---\n\nlast\n';
    expect(compare(source)).toBeGreaterThan(1);
  });

  it('constructs that go across blank lines stay in one piece', () => {
    const sources = [
      '- a\n\n  still a\n\n- b\n\ntext\n',
      '1. a\n\n   code\n\n2. b\n\ntext\n',
      '```\na\n\n\nb\n```\n\ntext\n',
      '    indented\n\n    code\n\ntext\n',
      '<!-- a\n\nb -->\n\ntext\n',
      '<pre>\na\n\nb\n</pre>\n\ntext\n',
      '$$\na\n\nb\n$$\n\ntext\n',
      '> quote\n\n> another quote\n\ntext\n',
      '> quote\ncontinued\n\ntext\n',
      '| a | b |\n|---|---|\n| 1 | 2 |\n\ntext\n',
      'Setext\n======\n\ntext\n\nSetext 2\n--------\n\nend\n',
      'text\n<!-- c\n\nd -->\nafter\n\nend\n',
      '- a\n- b\n\n\n- c\n\ntext\n',
      '* * *\n\ntext\n\n---\n\nend\n',
      '$$ unclosed\n\ntext\n\nmore\n',
      '```js\nunclosed\n\ntext\n',
    ];
    for (const source of sources) compare(source, 'gfm', source);
    for (const source of sources) compare(source, 'commonmark', source);
  });
});

// ---- windows that did not change are not parsed again ------------------------------------------

describe('the window cache', () => {
  const counters = (pipeline: unknown) =>
    (pipeline as { counters: { rendered: number; windows: number } }).counters;
  const document = Array.from(
    { length: 40 },
    (_, i) => `## Section ${i % 5}\n\nParagraph ${i} with some words.\n\n- one\n- two\n`,
  ).join('\n');

  it('parses only the window that changed', () => {
    const { windowed } = makePair('gfm');
    windowed.clearCaches?.();
    const first = windowed.render(document);
    const renderedAfterFirst = counters(windowed).rendered;
    expect(first.blocks.length).toBeGreaterThan(100);
    expect(counters(windowed).rendered).toBe(renderedAfterFirst);

    // The same text again: nothing is parsed.
    windowed.render(document);
    expect(counters(windowed).rendered).toBe(renderedAfterFirst);

    // One word in the middle: the blocks of one window are made again, not those of 39 others.
    const edited = document.replace('Paragraph 20 with', 'Paragraph 20 changed with');
    const second = windowed.render(edited);
    const added = counters(windowed).rendered - renderedAfterFirst;
    expect(added).toBeGreaterThan(0);
    expect(added).toBeLessThan(first.blocks.length / 10);
    expect(plain(second)).toEqual(plain(makePair('gfm').whole.render(edited)));
  });

  it('keeps the lines right when lines are added above a window that is kept', () => {
    const { windowed, whole } = makePair('gfm');
    windowed.render(document);
    const edited = `an added first paragraph\n\nand another\n\n${document}`;
    expect(plain(windowed.render(edited))).toEqual(plain(whole.render(edited)));
  });

  it('parses the windows after a heading that changed, if a repeated heading changes its id', () => {
    const { windowed, whole } = makePair('gfm');
    windowed.render(document);
    // Section 0 now has another name: the second "Section 1" is the first one, and so on.
    const edited = document.replace('## Section 0', '## Section 1');
    expect(plain(windowed.render(edited))).toEqual(plain(whole.render(edited)));
    expect(windowed.analyze(edited)).toEqual(whole.analyze(edited));
  });

  it('analyzing does not need the blocks, and rendering after it does', () => {
    const { windowed, whole } = makePair('gfm');
    windowed.analyze(document);
    expect(plain(windowed.render(document))).toEqual(plain(whole.render(document)));
    expect(windowed.analyze(document)).toEqual(whole.analyze(document));
  });

  it('the frontmatter window is parsed every time and shows the title by the later headings', () => {
    const { windowed, whole } = makePair('gfm');
    const withMatter = `---\ntitle: A title\n---\n\n${document}`;
    expect(plain(windowed.render(withMatter))).toEqual(plain(whole.render(withMatter)));
    expect(plain(windowed.render(withMatter))).toEqual(plain(whole.render(withMatter)));
    const withH1 = `${withMatter}\n# A heading\n`;
    expect(plain(windowed.render(withH1))).toEqual(plain(whole.render(withH1)));
  });

  it('clearCaches forgets the windows', () => {
    const { windowed } = makePair('gfm');
    windowed.render(document);
    const before = counters(windowed).rendered;
    windowed.clearCaches?.();
    windowed.render(document);
    expect(counters(windowed).rendered).toBe(before * 2);
  });
});

// ---- random documents ----------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS =
  'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron'.split(' ');

function generator(seed: number) {
  const random = mulberry32(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const chance = (p: number) => random() < p;
  const count = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));
  const words = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join(' ');

  const inline = (): string => {
    const text = words(count(2, 9));
    return pick([
      text,
      `${text} **bold** and *em*`,
      `${text} \`code\` and [link](https://example.org)`,
      `${text} https://example.org/x`,
      `${text} :tada: and $x^2$`,
      `${text}  `,
      `${text} <span>inline</span>`,
    ]);
  };
  const paragraph = () => Array.from({ length: count(1, 4) }, inline).join('\n');
  const indent = (text: string, spaces: string) =>
    text
      .split('\n')
      .map((line) => (line === '' ? line : `${spaces}${line}`))
      .join('\n');

  const fence = (): string => {
    const mark = pick(['```', '~~~', '````', '```']);
    const body = Array.from({ length: count(1, 5) }, () =>
      chance(0.3) ? '' : pick([words(3), '```', '    x', '# not a heading', '- not a list']),
    ).join('\n');
    const closing = chance(0.05) ? '' : `\n${mark}`;
    return `${mark}${pick(['', 'js', 'python'])}\n${body}${closing}`;
  };
  const listItem = (marker: string, nested: boolean): string => {
    let item = `${marker} ${inline()}`;
    if (chance(0.3)) item += `\n\n${indent(paragraph(), '  ')}`;
    if (chance(0.15)) item += `\n\n${indent(fence(), '  ')}`;
    if (chance(0.1)) item += `\n\n${indent(fence(), '    ')}`;
    if (nested && chance(0.3)) item += `\n${indent(list(false), '  ')}`;
    return item;
  };
  function list(nested = true): string {
    const marker = pick(['-', '*', '+', '1.', '2)']);
    const items = Array.from({ length: count(1, 4) }, (_, i) =>
      listItem(/\d/.test(marker) ? `${i + 1}${marker.slice(1)}` : marker, nested),
    );
    return items.join(pick(['\n', '\n', '\n\n']));
  }
  const tasks = () =>
    Array.from({ length: count(1, 4) }, () => `- [${pick([' ', 'x'])}] ${inline()}`).join('\n');
  const table = () =>
    `| a | b |\n|:--|--:|\n${Array.from({ length: count(1, 3) }, () => `| ${pick(WORDS)} | ${pick(WORDS)} |`).join('\n')}`;
  const quote = () => {
    const lines = paragraph().split('\n');
    const body = lines.map((line, i) => (i > 0 && chance(0.25) ? line : `> ${line}`)).join('\n');
    return chance(0.2) ? `${body}\n>\n> > nested ${words(2)}` : body;
  };
  const html = () =>
    pick([
      `<div>\n${words(3)}\n</div>`,
      `<!-- ${words(2)}\n\n${words(2)} -->`,
      `<!-- ${words(2)} -->`,
      `<pre>\n${words(2)}\n\n${words(2)}\n</pre>`,
      `<script>\nvar a = 1;\n\nvar b = 2;\n</script>`,
      `<details>\n<summary>S</summary>\n\n${words(4)}\n\n</details>`,
      `text ${words(2)}\n<!-- c\n\nd -->\nafter`,
    ]);
  const math = () =>
    pick([
      `$$\n${words(1)}\n\n${words(1)}\n$$`,
      `$$ ${words(1)} $$`,
      '```math\nx\n\ny\n```',
      `$$ unclosed ${words(1)}`,
    ]);
  const heading = () => {
    if (chance(0.25)) return `${pick(['Intro', 'Intro', 'Notes'])}\n${pick(['===', '---'])}`;
    return `${'#'.repeat(count(1, 4))} ${pick(['Intro', 'Intro', 'Notes', words(2)])}`;
  };
  const indentedCode = () =>
    Array.from({ length: count(1, 3) }, () => `    ${words(2)}`).join('\n\n');
  const oddities = () =>
    pick([
      `<img src="a.png">\n${words(2)}`,
      `<span>\n\`\`\`\n${words(2)}\n\n${words(2)}\n\`\`\``,
      `${words(2)}\n<span>${words(1)}</span>\n\`\`\`\nx\n\`\`\``,
      `> \`\`\`\n> ${words(2)}\n>\n> ${words(2)}\n> \`\`\``,
      `\tindented by a tab\n\n\tand again`,
      `10. ten\n\n    code under ten\n\n11. eleven`,
      `- a\n  \`\`\`\n  x\n\n  y\n  \`\`\`\nafter the list`,
      `1. one\n   \`\`\`\n   x\n\ndedented\n\`\`\``,
      `  \`\`\`\nindented fence\n\nwith a blank\n  \`\`\``,
      `[not a definition] ${words(2)}`,
      `<details><summary>S</summary>\n\n${words(3)}\n\n</details>`,
    ]);
  const callout = () => `> [!${pick(['NOTE', 'TIP', 'WARNING'])}]\n> ${words(4)}`;

  const piece = (): string =>
    pick([
      paragraph,
      paragraph,
      paragraph,
      heading,
      list,
      list,
      tasks,
      table,
      quote,
      fence,
      fence,
      html,
      () => (chance(0.3) ? math() : paragraph()),
      indentedCode,
      callout,
      oddities,
      oddities,
      () => pick(['---', '***', '* * *']),
    ])();

  return {
    document(): string {
      const parts: string[] = [];
      if (chance(0.15)) parts.push(`---\ntitle: ${words(2)}\ntags: [a, b]\n---`);
      for (let i = count(4, 22); i > 0; i--) parts.push(piece());
      if (chance(0.03)) parts.push(`[ref]: https://example.org "t"`);
      let text = parts[0] ?? '';
      for (const part of parts.slice(1)) {
        text += pick(['\n\n', '\n\n', '\n\n', '\n\n\n', '\n \n', '\n\t\n', '\n']) + part;
      }
      return `${text}\n`;
    },
  };
}

function edited(source: string, seed: number): string {
  const random = mulberry32(seed * 7919 + 13);
  const lines = source.split('\n');
  const at = Math.floor(random() * lines.length);
  const kind = Math.floor(random() * 6);
  switch (kind) {
    case 0:
      lines[at] = `${lines[at]} edited`;
      break;
    case 1:
      lines.splice(at, 0, '', `## Intro`, '', 'new paragraph', '');
      break;
    case 2:
      lines.splice(at, 1);
      break;
    case 3:
      for (let i = 0; i < lines.length; i++) {
        if (/^#{1,4} /.test(lines[i] ?? '')) {
          lines[i] = `${lines[i]} changed`;
          break;
        }
      }
      break;
    case 4:
      lines.splice(at, 0, '');
      break;
    default:
      lines.splice(at, 0, '```', 'code', '```');
      break;
  }
  return lines.join('\n');
}

describe('random edits', () => {
  it('give the same result from the window cache as from a whole parse', () => {
    // Every document is sanitized several times, which jsdom does not give back quickly.
    const seeds = Number(process.env.WD_FUZZ_SEEDS ?? 120);
    const from = Number(process.env.WD_FUZZ_FROM ?? 1) + 5000;
    const { windowed, whole } = pipelines('gfm');
    for (let seed = from; seed < from + seeds; seed++) {
      const source = generator(seed).document();
      windowed.clearCaches?.();
      windowed.render(source);
      let current = source;
      for (let step = 0; step < 3; step++) {
        current = edited(current, seed * 10 + step);
        expect(plain(windowed.render(current)), `seed ${seed} step ${step}`).toEqual(
          plain(whole.render(current)),
        );
        expect(windowed.analyze(current), `seed ${seed} step ${step}`).toEqual(
          whole.analyze(current),
        );
      }
    }
  }, 900_000);
});

describe('random documents', () => {
  it('give the same result in windows as in one piece (GFM)', () => {
    let windowed = 0;
    const seeds = Number(process.env.WD_FUZZ_SEEDS ?? 250);
    const from = Number(process.env.WD_FUZZ_FROM ?? 1);
    for (let seed = from; seed < from + seeds; seed++) {
      const source = generator(seed).document();
      if (compare(source, 'gfm', `seed ${seed}`) > 1) windowed++;
    }
    // Most documents have places to cut: the test is about those.
    expect(windowed).toBeGreaterThan(seeds * 0.3);
  }, 900_000);

  it('give the same result in windows as in one piece (CommonMark)', () => {
    const seeds = Number(process.env.WD_FUZZ_SEEDS ?? 100);
    const from = Number(process.env.WD_FUZZ_FROM ?? 1) + 1000;
    for (let seed = from; seed < from + seeds; seed++) {
      compare(generator(seed).document(), 'commonmark', `seed ${seed}`);
    }
  }, 900_000);
});
