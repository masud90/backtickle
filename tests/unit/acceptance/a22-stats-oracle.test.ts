/**
 * A22 (unit part): words, characters and reading time against an independent Intl.Segmenter
 * oracle over the `.prose.json` blocks of the stats fixtures. The oracle never calls the app.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPipeline, readingMinutes } from '@/preview/pipeline';

const FIXTURES = join(__dirname, '..', '..', 'fixtures', 'stats');

interface Prose {
  blocks: string[];
  words?: string[];
}

const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function oracle(blocks: string[]) {
  const words: string[] = [];
  let characters = 0;
  let charactersNoSpaces = 0;
  for (const block of blocks) {
    for (const s of wordSegmenter.segment(block)) if (s.isWordLike) words.push(s.segment);
    for (const g of graphemeSegmenter.segment(block)) {
      characters++;
      if (!/^\s+$/u.test(g.segment)) charactersNoSpaces++;
    }
  }
  return { words, characters, charactersNoSpaces };
}

describe('A22 stats oracle', () => {
  for (const name of ['english', 'cjk', 'arabic', 'mixed']) {
    const source = readFileSync(join(FIXTURES, `${name}.md`), 'utf8');
    const prose = JSON.parse(
      readFileSync(join(FIXTURES, `${name}.md.prose.json`), 'utf8'),
    ) as Prose;
    const expected = oracle(prose.blocks);

    it(`${name}: the GFM pipeline reports the oracle's words, characters and characters without spaces`, async () => {
      const pipeline = await loadPipeline('gfm');
      const { stats } = pipeline.analyze(source);
      expect(stats.words).toBe(expected.words.length);
      expect(stats.characters).toBe(expected.characters);
      expect(stats.charactersNoSpaces).toBe(expected.charactersNoSpaces);
      expect(expected.words.length).toBeGreaterThan(5);
    });

    it(`${name}: render() reports the same statistics as analyze()`, async () => {
      const pipeline = await loadPipeline('gfm');
      expect(pipeline.render(source).stats).toEqual(pipeline.analyze(source).stats);
    });
  }

  it('english: the fixture word list agrees with the oracle (fixture self-check)', () => {
    const prose = JSON.parse(
      readFileSync(join(FIXTURES, 'english.md.prose.json'), 'utf8'),
    ) as Prose;
    expect(prose.words).toBeDefined();
    expect(oracle(prose.blocks).words).toEqual(prose.words);
  });

  it('excludes code, frontmatter, comments, math, image alt text and URLs', async () => {
    const pipeline = await loadPipeline('gfm');
    const source = [
      '---',
      'title: Hidden title words',
      '---',
      '',
      'Visible prose here.',
      '',
      '```js',
      'const hidden = code;',
      '```',
      '',
      '<!-- hidden comment words -->',
      '',
      'Math $a+b$ stays out and ![alt text here](pic.png) too.',
      '',
      '[link text](https://example.org/hidden/path)',
      '',
    ].join('\n');
    const expected = oracle(['Visible prose here.', 'Math stays out and too.', 'link text']);
    const { stats } = pipeline.analyze(source);
    expect(stats.words).toBe(expected.words.length);
    expect(stats.characters).toBe(expected.characters);
  });

  it('counts a plain document word by word', async () => {
    const pipeline = await loadPipeline('gfm');
    expect(pipeline.analyze('').stats).toEqual({ words: 0, characters: 0, charactersNoSpaces: 0 });
    expect(pipeline.analyze('one two three\n').stats).toEqual({
      words: 3,
      characters: 13,
      charactersNoSpaces: 11,
    });
  });
});

describe('A22 reading time', () => {
  it('rounds words / wpm up to whole minutes, "< 1 min" below one minute, "0 min" for none', () => {
    expect(readingMinutes(0, 238)).toBe('0 min');
    expect(readingMinutes(1, 238)).toBe('< 1 min');
    expect(readingMinutes(237, 238)).toBe('< 1 min');
    expect(readingMinutes(238, 238)).toBe('1 min');
    expect(readingMinutes(239, 238)).toBe('2 min');
    expect(readingMinutes(476, 238)).toBe('2 min');
    expect(readingMinutes(477, 238)).toBe('3 min');
    expect(readingMinutes(500, 100)).toBe('5 min');
    expect(readingMinutes(99, 100)).toBe('< 1 min');
    expect(readingMinutes(100, 100)).toBe('1 min');
  });
});
