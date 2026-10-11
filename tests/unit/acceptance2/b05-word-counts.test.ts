/**
 * B05: words and characters of the Phase 2 flavors against an independent oracle written from
 * the counting rules (generated text counts as the reader sees it). The prose of each source is listed by
 * hand (what the reader sees and the rules count); the oracle segments it with Intl.Segmenter and
 * never calls the app's counting code.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPipeline } from '@/preview/pipeline';
import type { ContextInputs } from '@/preview/types';

const words = new Intl.Segmenter(undefined, { granularity: 'word' });
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function oracle(blocks: string[]) {
  let w = 0;
  let c = 0;
  for (const block of blocks) {
    for (const s of words.segment(block)) if (s.isWordLike) w++;
    for (const _ of graphemes.segment(block)) c++;
  }
  return { words: w, characters: c };
}

const NONE: ContextInputs = {
  path: null,
  bibliographies: [],
  includes: new Map(),
  vault: null,
  project: null,
};

async function count(
  flavor: 'pandoc' | 'quarto' | 'obsidian' | 'mdx',
  source: string,
  inputs = NONE,
) {
  const pipeline = await loadPipeline(flavor);
  await pipeline.preload?.(inputs);
  const context = pipeline.prepare?.(source, inputs);
  return pipeline.analyze(source, context).stats;
}

const BIB = readFileSync(
  join(__dirname, '..', '..', 'fixtures', 'flavors', 'pandoc', 'refs.bib'),
  'utf8',
);
const withBib: ContextInputs = {
  ...NONE,
  path: '/d/doc.md',
  bibliographies: [{ href: 'refs.bib', path: '/d/refs.bib', text: BIB }],
};

describe('B05 Pandoc / MMD', () => {
  it('counts a rendered citation (Pandoc 3.8.3 text "(Lee et al. 2018)") and nothing generated', async () => {
    const source =
      '---\nbibliography: refs.bib\n---\n\nCite [@lee2018] here.\n\n::: {#refs}\n:::\n';
    const expected = oracle(['Cite (Lee et al. 2018) here.']);
    const stats = await count('pandoc', source, withBib);
    expect(stats.words).toBe(expected.words);
    expect(stats.characters).toBe(expected.characters);
  });

  it('excludes the title block, code, comments, raw HTML comments and the reference list', async () => {
    const source = [
      '---',
      'title: Hidden title words',
      'author: Hidden Author',
      'bibliography: refs.bib',
      '---',
      '',
      'Intro words here.',
      '',
      '```python',
      'code words hidden',
      '```',
      '',
      '<!-- html comment hidden -->',
      '',
      'Cite [@lee2018] here.',
      '',
    ].join('\n');
    const expected = oracle(['Intro words here.', 'Cite (Lee et al. 2018) here.']);
    expect((await count('pandoc', source, withBib)).words).toBe(expected.words);
  });

  it('CriticMarkup: additions, highlights and the new text of a substitution count; deletions and comments do not', async () => {
    const source =
      'Alpha {++beta++} {--gamma--} {~~delta~>epsilon~~} {==zeta==} {>>eta<<} theta.\n';
    const expected = oracle(['Alpha', 'beta', 'epsilon', 'zeta', 'theta']);
    expect((await count('pandoc', source)).words).toBe(expected.words);
  });

  it('definition lists, footnote text and smart punctuation count as prose', async () => {
    const source = 'Term\n: Definition of term.\n\nNote^[Inline note words.] end.\n';
    const expected = oracle(['Term', 'Definition of term.', 'Note end.', 'Inline note words.']);
    expect((await count('pandoc', source)).words).toBe(expected.words);
  });
});

describe('B05 Quarto / RMD', () => {
  it('counts caption labels, cross-references and included text; excludes chunks, inline code and the default callout title', async () => {
    const source = [
      '---',
      'title: Hidden',
      '---',
      '',
      '# Heading words',
      '',
      'Text with `r x` inline and ref @fig-a.',
      '',
      '![Cap text](a.png){#fig-a}',
      '',
      '```{r}',
      'code <- hidden',
      '```',
      '',
      '::: {.callout-note}',
      'Callout body words.',
      ':::',
      '',
      '{{< include _inc.qmd >}}',
      '',
    ].join('\n');
    const inputs: ContextInputs = {
      ...NONE,
      path: '/d/doc.qmd',
      includes: new Map([['_inc.qmd', { path: '/d/_inc.qmd', text: 'Included words here.\n' }]]),
    };
    const expected = oracle([
      'Heading words',
      'Text with inline and ref Figure 1.',
      'Figure 1: Cap text',
      'Callout body words.',
      'Included words here.',
    ]);
    expect(expected.words).toBe(19);
    expect((await count('quarto', source, inputs)).words).toBe(expected.words);
  });

  it('bookdown references count their number as a word-like segment', async () => {
    const source = '# Results {#results}\n\nSee Section \\@ref(results).\n';
    const expected = oracle(['Results', 'See Section 1.']);
    expect((await count('quarto', source)).words).toBe(expected.words);
  });
});

describe('B05 Obsidian', () => {
  it('excludes properties, comments and the default callout title; counts aliases, highlights and callout bodies', async () => {
    const source = [
      '---',
      'tags: [alpha, beta]',
      'status: hidden words',
      '---',
      '',
      'Note words here.',
      '',
      '%%hidden comment%%',
      '',
      '==Highlight words== stay.',
      '',
      '> [!note]',
      '> Callout body.',
      '',
      'See [[Link|alias words]] now.',
      '',
    ].join('\n');
    const expected = oracle([
      'Note words here.',
      'Highlight words stay.',
      'Callout body.',
      'See alias words now.',
    ]);
    expect(expected.words).toBe(12);
    expect((await count('obsidian', source)).words).toBe(expected.words);
  });
});

describe('B05 MDX', () => {
  it('excludes import and export lines, props and expressions; counts children', async () => {
    const source = [
      "import X from './x.js'",
      '',
      'export const meta = { a: 1 }',
      '',
      'Intro words here.',
      '',
      '<Card title="hidden prop">Child words here.</Card>',
      '',
      '{props.hidden}',
      '',
      'Tail words.',
      '',
    ].join('\n');
    const expected = oracle(['Intro words here.', 'Child words here.', 'Tail words.']);
    expect(expected.words).toBe(8);
    expect((await count('mdx', source)).words).toBe(expected.words);
  });
});
