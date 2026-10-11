/**
 * The whole-document context: a test pack that numbers `{#fig-x}`
 * labels in `prepare` and prints the numbers in `render`, the windowing hooks, and the registry.
 */
import MarkdownItConstructor from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { BlockPipeline } from '@/preview/engine';
import { hashString } from '@/preview/hash';
import { loadPipeline, renderableFlavor } from '@/preview/pipeline';
import { createEnv, wdEnv } from '@/preview/rules/env';
import type { ContextInputs, DocContext, Label } from '@/preview/types';
import { splitSource } from '@/preview/windows';

const LABEL = /\{#fig-([a-z]+)\}/g;
const REF = /\{@fig-([a-z]+)\}/g;
const NO_INPUTS: ContextInputs = {
  path: null,
  bibliographies: [],
  includes: new Map(),
  vault: null,
  project: null,
};

function prepare(source: string): DocContext {
  const labels = new Map<string, Label>();
  const lines = source.split('\n');
  lines.forEach((text, line) => {
    for (const match of text.matchAll(LABEL)) {
      const name = `fig-${match[1]}`;
      if (!labels.has(name)) {
        const number = String(labels.size + 1);
        labels.set(name, { kind: 'fig', number, text: `Figure ${number}`, line });
      }
    }
  });
  const signature = hashString([...labels].map(([k, v]) => `${k}=${v.number}`).join('|'));
  return {
    metadata: {},
    labels,
    citationKeys: [],
    bibliography: null,
    vault: null,
    includes: new Map(),
    signature,
  };
}

/** A pack that prints `Figure N` for a label `{#fig-x}` and for a reference `{@fig-x}`. */
function testPack(options: ConstructorParameters<typeof BlockPipeline>[2] = {}) {
  const md = new MarkdownItConstructor({ html: true });
  md.core.ruler.push('test_labels', (state) => {
    const context = wdEnv(state.env).context;
    for (const token of state.tokens) {
      if (token.type !== 'inline') continue;
      for (const child of token.children ?? []) {
        if (child.type !== 'text') continue;
        child.content = child.content
          .replace(LABEL, (_all, name: string) => context?.labels.get(`fig-${name}`)?.text ?? '?')
          .replace(REF, (_all, name: string) => context?.labels.get(`fig-${name}`)?.text ?? '??');
      }
    }
    return true;
  });
  return new BlockPipeline('gfm', md, {
    windowMinChars: 200,
    windowChars: 100,
    prepare: (source) => prepare(source),
    needs: () => ({ bibliographies: [], includes: [], vault: false, project: false }),
    ...options,
  });
}

/** Paragraphs; one has a label, and one later refers to it. */
function document(withTopLabel: boolean): string {
  const paragraphs: string[] = [];
  if (withTopLabel) paragraphs.push('Top figure {#fig-top}');
  for (let i = 0; i < 40; i++) {
    paragraphs.push(`Paragraph ${i} of plain text without any label in it at all.`);
    if (i === 10) paragraphs.push('Middle figure {#fig-mid}');
    if (i === 30) paragraphs.push('See {@fig-mid} for the middle one.');
  }
  return `${paragraphs.join('\n\n')}\n`;
}

describe('the pack context', () => {
  it('the render of a block takes its numbers from the context', () => {
    const pack = testPack();
    const source = document(false);
    const result = pack.render(source, prepare(source));
    const html = result.blocks.map((block) => block.html).join('');
    expect(html).toContain('Middle figure Figure 1');
    expect(html).toContain('See Figure 1 for the middle one.');
  });

  it('a label added at the top renumbers blocks in later windows and the others keep their keys', () => {
    const pack = testPack();
    const before = document(false);
    const after = document(true);
    const first = pack.render(before, prepare(before));
    const second = pack.render(after, prepare(after));
    expect(pack.counters.windows).toBeGreaterThan(2);

    const htmlOf = (blocks: typeof first.blocks) => blocks.map((block) => block.html).join('');
    expect(htmlOf(first.blocks)).toContain('See Figure 1 for the middle one.');
    expect(htmlOf(second.blocks)).toContain('Middle figure Figure 2');
    expect(htmlOf(second.blocks)).toContain('See Figure 2 for the middle one.');
    expect(htmlOf(second.blocks)).not.toContain('See Figure 1');

    const keyOf = (blocks: typeof first.blocks, text: string) =>
      blocks.find((block) => block.html.includes(text))?.key;
    // The block that changed has another key; one without a label has the same key as before.
    expect(keyOf(second.blocks, 'See Figure 2')).not.toBe(keyOf(first.blocks, 'See Figure 1'));
    expect(keyOf(second.blocks, 'Paragraph 25 of')).toBe(keyOf(first.blocks, 'Paragraph 25 of'));
    expect(keyOf(second.blocks, 'Paragraph 39 of')).toBe(keyOf(first.blocks, 'Paragraph 39 of'));
  });

  it('the same source with the same signature is served from the window cache', () => {
    const pack = testPack();
    const source = document(true);
    pack.render(source, prepare(source));
    const rendered = pack.counters.rendered;
    pack.render(source, prepare(source));
    // Only the first window (it has no cache entry when it starts with frontmatter) may parse
    // again; the windows after it do not.
    expect(pack.counters.rendered - rendered).toBeLessThan(rendered / 2);
  });

  it('a changed signature does not take an old window from the cache', () => {
    const pack = testPack();
    const source = document(false);
    pack.render(source, prepare(source));
    const other = { ...prepare(source), signature: 'another' };
    other.labels = new Map([['fig-mid', { kind: 'fig', number: '9', text: 'Figure 9', line: 0 }]]);
    const html = pack
      .render(source, other)
      .blocks.map((block) => block.html)
      .join('');
    expect(html).toContain('See Figure 9 for the middle one.');
  });

  it('analyze and renderRaw take the context too', () => {
    const pack = testPack();
    const source = 'One {#fig-a}\n\nTwo {@fig-a}\n';
    const context = prepare(source);
    expect(pack.renderRaw(source, context)).toContain('Two Figure 1');
    expect(pack.analyze(source, context).stats.words).toBeGreaterThan(0);
  });

  it('the pack hooks are the ones the pack gave; GFM and CommonMark have none', async () => {
    const pack = testPack();
    expect(pack.prepare?.('x {#fig-a}', NO_INPUTS).labels.size).toBe(1);
    expect(pack.needs?.('x')).toEqual({
      bibliographies: [],
      includes: [],
      vault: false,
      project: false,
    });
    for (const flavor of ['gfm', 'commonmark'] as const) {
      const pipeline = await loadPipeline(flavor);
      expect(pipeline.needs).toBeUndefined();
      expect(pipeline.prepare).toBeUndefined();
      expect(pipeline.completions).toBeUndefined();
    }
  });

  it('the env carries no context unless one is given', () => {
    expect(wdEnv(createEnv()).context).toBeNull();
  });
});

describe('windowing hooks', () => {
  const text = `${Array.from({ length: 60 }, (_, i) => `Paragraph ${i} of plain text.`).join('\n\n')}\n`;

  it('unsafeSplit vetoes cut places', () => {
    const free = splitSource(text, { minChars: 100, windowChars: 100 });
    expect(free?.length).toBeGreaterThan(3);
    const none = splitSource(text, { minChars: 100, windowChars: 100, unsafeSplit: () => true });
    expect(none).toBeNull();
    const seen: number[] = [];
    const some = splitSource(text, {
      minChars: 100,
      windowChars: 100,
      unsafeSplit: (lines, index) => {
        seen.push(index);
        expect(lines[index - 1]).toBe('');
        return index < 40;
      },
    });
    expect(some?.every((window) => window.line === 0 || window.line >= 40)).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
  });

  it('windowing: false parses the document in one piece', () => {
    const pack = testPack({ windowing: false });
    pack.render(text, prepare(text));
    expect(pack.counters.windows).toBe(1);
    const windowed = testPack();
    windowed.render(text, prepare(text));
    expect(windowed.counters.windows).toBeGreaterThan(1);
  });
});

describe('the pack registry', () => {
  it('every flavor has its own pack and renders as itself', async () => {
    for (const flavor of ['commonmark', 'gfm', 'obsidian', 'pandoc', 'quarto', 'mdx'] as const) {
      expect(renderableFlavor(flavor)).toBe(flavor);
      expect((await loadPipeline(flavor)).flavor).toBe(flavor);
    }
    expect(renderableFlavor('commonmark')).toBe('commonmark');
    expect(renderableFlavor('pandoc')).toBe('pandoc');
    expect(renderableFlavor('obsidian')).toBe('obsidian');
  });
});
