// The GFM pack sanitizes with DOMPurify, which needs jsdom.
// @vitest-environment jsdom
/**
 * Words, characters and reading time: the prose that is extracted from
 * the fixtures equals the expected prose, and the numbers equal Intl.Segmenter counts of that prose.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCommonMarkPipeline } from '@/preview/packs/commonmark';
import { createGfmPipeline } from '@/preview/packs/gfm';
import { countProse, proseWords, readingMinutes } from '@/preview/stats';

const FIXTURES = resolve(__dirname, '../fixtures/stats');
const names = readdirSync(FIXTURES)
  .filter((file) => file.endsWith('.md'))
  .sort();

/** Counts straight from Intl.Segmenter, written independently of the code under test. */
function reference(blocks: string[]) {
  const words = new Intl.Segmenter('en', { granularity: 'word' });
  const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
  let wordCount = 0;
  let characters = 0;
  let noSpaces = 0;
  for (const block of blocks) {
    for (const part of words.segment(block)) if (part.isWordLike) wordCount++;
    for (const part of graphemes.segment(block)) {
      characters++;
      if (!/^\s+$/.test(part.segment)) noSpaces++;
    }
  }
  return { words: wordCount, characters, charactersNoSpaces: noSpaces };
}

describe('stats fixtures', () => {
  it('has the four fixtures', () => {
    expect(names).toEqual(['arabic.md', 'cjk.md', 'english.md', 'mixed.md']);
  });

  for (const name of names) {
    const text = readFileSync(resolve(FIXTURES, name), 'utf8');
    const expected = JSON.parse(readFileSync(resolve(FIXTURES, `${name}.prose.json`), 'utf8')) as {
      blocks: string[];
      words?: string[];
    };

    describe(name, () => {
      const pipeline = createGfmPipeline();

      it('extracts the expected prose, block by block', () => {
        expect(pipeline.proseBlocks(text)).toEqual(expected.blocks);
      });

      it('counts words, characters and characters without spaces like Intl.Segmenter', () => {
        const analysis = pipeline.analyze(text);
        expect(analysis.stats).toEqual(reference(expected.blocks));
        // render() reports the same numbers as analyze()
        expect(pipeline.render(text).stats).toEqual(analysis.stats);
      });

      if (expected.words) {
        it('finds exactly the listed words', () => {
          expect(expected.blocks.flatMap((block) => proseWords(block))).toEqual(expected.words);
        });
      }
    });
  }

  it('the English fixture has the numbers worked out by hand', () => {
    const text = readFileSync(resolve(FIXTURES, 'english.md'), 'utf8');
    const { stats } = createGfmPipeline().analyze(text);
    expect(stats.words).toBe(67); // 2+14+6+7+8+6+5+3+3+1+8+4 counted by hand
  });
});

describe('what is and is not prose', () => {
  const pipeline = createGfmPipeline();
  const prose = (markdown: string) => pipeline.proseBlocks(markdown);

  it('counts inline code, link text and table cells including the header; not URLs or code blocks', () => {
    expect(prose('a `b` [c d](https://example.org) <https://example.org>\n')).toEqual(['a b c d']);
    expect(prose('| h1 | h2 |\n| - | - |\n| c1 | c2 |\n')).toEqual(['h1 h2 c1 c2']);
    expect(prose('```js\nconst x = 1;\n```\n\n    indented code\n')).toEqual([]);
    expect(prose('www.example.org and foo@bar.example\n')).toEqual(['and']);
  });

  it('leaves out frontmatter, raw HTML blocks, comments, math, image alt text', () => {
    expect(prose('---\ntitle: T\n---\n\ntext\n')).toEqual(['text']);
    expect(prose('<div>raw block</div>\n\ntext\n')).toEqual(['text']);
    expect(prose('a <!-- gone --> b <span>kept</span>\n')).toEqual(['a b kept']);
    expect(prose('a $x^2$ b\n\n$$\ny\n$$\n')).toEqual(['a b']);
    expect(prose('![alt text](x.png) after\n')).toEqual(['after']);
  });

  it('leaves out generated markers: footnote numbers, back-links, the title of an alert', () => {
    expect(prose('ref[^1].\n\n[^1]: the note\n')).toEqual(['ref.', 'the note']);
    expect(prose('> [!NOTE]\n> body text\n')).toEqual(['body text']);
  });

  it('collects footnotes last, as one block, joined with a space', () => {
    expect(prose('a[^1] b[^2]\n\n[^1]: one\n[^2]: two\n\nlast\n')).toEqual([
      'a b',
      'last',
      'one two',
    ]);
  });

  it('treats soft and hard breaks as one space and collapses white space', () => {
    expect(prose('one\ntwo  \nthree\\\nfour   five\n')).toEqual(['one two three four five']);
  });

  it('joins list items and paragraphs inside a quote with one space', () => {
    expect(prose('- a\n- b\n\n> p\n>\n> q\n')).toEqual(['a b', 'p q']);
  });

  it('counts the text of task items without the box', () => {
    expect(prose('- [x] done\n- [ ] open\n')).toEqual(['done open']);
  });

  it('counts the characters of the prose including spaces, and without', () => {
    expect(countProse('ab cd')).toEqual({ words: 2, characters: 5, charactersNoSpaces: 4 });
    // A grapheme is a user-perceived character: a flag, a family and e with an accent each count once.
    expect(countProse('é').characters).toBe(1);
    expect(countProse('\u{1F1E9}\u{1F1EA}').characters).toBe(1);
    expect(countProse('')).toEqual({ words: 0, characters: 0, charactersNoSpaces: 0 });
  });

  it('remembers counts: a repeated block is not counted twice, and an update counts only what changed', () => {
    const fresh = createGfmPipeline();
    const source = 'first paragraph\n\nsecond paragraph\n\nthird paragraph\n';
    fresh.analyze(source);
    const counted = fresh.counters.counted;
    fresh.analyze(source);
    expect(fresh.counters.counted).toBe(counted);
    fresh.analyze(source.replace('second', 'changed'));
    expect(fresh.counters.counted).toBe(counted + 1);
  });

  it('CommonMark has no frontmatter, tables or task markers: they are text', () => {
    const common = createCommonMarkPipeline();
    expect(common.proseBlocks('- [ ] task\n')).toEqual(['[ ] task']);
    expect(common.analyze('---\ntitle: T\n---\n\ntext\n').frontmatter).toBeNull();
  });
});

describe('readingMinutes', () => {
  it('is 0 min for no words and < 1 min below one minute of reading', () => {
    expect(readingMinutes(0, 238)).toBe('0 min');
    expect(readingMinutes(1, 238)).toBe('< 1 min');
    expect(readingMinutes(237, 238)).toBe('< 1 min');
  });

  it('rounds up to whole minutes from one minute on', () => {
    expect(readingMinutes(238, 238)).toBe('1 min');
    expect(readingMinutes(239, 238)).toBe('2 min');
    expect(readingMinutes(476, 238)).toBe('2 min');
    expect(readingMinutes(477, 238)).toBe('3 min');
  });

  it('follows the reading speed that is given', () => {
    expect(readingMinutes(300, 100)).toBe('3 min');
    expect(readingMinutes(99, 100)).toBe('< 1 min');
    expect(readingMinutes(1000, 250)).toBe('4 min');
  });
});
