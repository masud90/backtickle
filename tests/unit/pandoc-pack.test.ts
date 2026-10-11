// @vitest-environment jsdom
/**
 * The Pandoc pack as wired (WP2.2c): citations with the reference list in its two places, its
 * title and suppression, citations pending until the BibTeX parser is loaded, completions, and
 * the lazy `preload` hook.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isBibtexLoaded, loadBibtex } from '@/preview/bibliography';
import { createGfmPipeline } from '@/preview/packs/gfm';
import { createPandocPipeline } from '@/preview/packs/pandoc';
import type { ContextInputs } from '@/preview/types';

const read = (name: string) =>
  readFileSync(resolve(__dirname, '../fixtures/flavors/pandoc', name), 'utf8');

const inputs = (name: string, text: string): ContextInputs => ({
  path: '/docs/a.md',
  bibliographies: [{ href: name, path: `/docs/${name}`, text }],
  includes: new Map(),
  vault: null,
  project: null,
});

function htmlOf(source: string, bib: ContextInputs) {
  const pipeline = createPandocPipeline();
  const context = pipeline.prepare?.(source, bib);
  const result = pipeline.render(source, context);
  return { result, html: result.blocks.map((block) => block.html).join('\n'), context };
}

const JSON_INPUTS = inputs('refs.json', read('refs.json'));
const DOC = '---\nbibliography: refs.json\n---\n\nSee [@smith2020].\n';

describe('reference list placement', () => {
  it('is the last block, with data-line on the last line, when there is no #refs div', () => {
    const { result, html } = htmlOf(DOC, JSON_INPUTS);
    expect(html).toContain('<div class="references" id="refs">');
    expect(html).toContain('id="ref-smith2020"');
    const last = result.blocks.at(-1);
    expect(last?.html).toContain('class="references"');
    expect(last?.line).toBe(4);
    expect(html).not.toContain('<h2');
  });

  it('replaces the content of a ::: {#refs} div', () => {
    const { html } = htmlOf(`${DOC}\n::: {#refs}\nignored text\n:::\n\nAfter.\n`, JSON_INPUTS);
    expect(html.match(/class="references"/g)).toHaveLength(1);
    expect(html).not.toContain('ignored text');
    expect(html).toContain('After.');
  });

  it('adds the h1 of reference-section-title, which is in the outline', () => {
    const source = DOC.replace('---\n\n', 'reference-section-title: Works cited\n---\n\n');
    const { result, html } = htmlOf(source, JSON_INPUTS);
    expect(html).toContain('Works cited</h1>');
    expect(result.headings.map((heading) => heading.text)).toEqual(['Works cited']);
  });

  it('is hidden by suppress-bibliography', () => {
    const source = DOC.replace('---\n\n', 'suppress-bibliography: true\n---\n\n');
    const { html } = htmlOf(source, JSON_INPUTS);
    expect(html).not.toContain('class="references"');
    expect(html).toContain('class="citation"');
  });

  it('is not counted as words', () => {
    const withList = htmlOf(DOC, JSON_INPUTS).result.stats.words;
    const without = htmlOf(DOC, { ...JSON_INPUTS, bibliographies: [] }).result.stats.words;
    // "See (@smith2020?)" against "See (Smith 2020)": the list adds nothing on top.
    expect(Math.abs(withList - without)).toBeLessThanOrEqual(2);
  });
});

describe('BibTeX is a lazy chunk', () => {
  const bib = inputs('refs.bib', read('refs.bib'));
  const source = '---\nbibliography: refs.bib\n---\n\nSee [@smith2020].\n';

  it('has no parser until preload, and cites as pending meanwhile', async () => {
    const pipeline = createPandocPipeline();
    expect(isBibtexLoaded()).toBe(false);
    expect(pipeline.preload?.(inputs('refs.json', '[]'))).toBeUndefined();
    expect(isBibtexLoaded()).toBe(false);
    const before = pipeline.render(source, pipeline.prepare?.(source, bib));
    const pendingHtml = before.blocks.map((block) => block.html).join('');
    expect(pendingHtml).toContain('citation is-pending');
    expect(pendingHtml).not.toContain('citation-missing');
    expect(pendingHtml).not.toContain('class="references"');

    const work = pipeline.preload?.(bib);
    expect(work).toBeInstanceOf(Promise);
    await work;
    expect(isBibtexLoaded()).toBe(true);
    expect(pipeline.preload?.(bib)).toBeUndefined();
    const after = pipeline.render(source, pipeline.prepare?.(source, bib));
    const html = after.blocks.map((block) => block.html).join('');
    expect(html).toContain('(Smith 2020)');
    expect(html).not.toContain('is-pending');
    // The rendered output changed with the bibliography: the context signature too.
    expect(pipeline.prepare?.(source, bib).signature).not.toBe(
      createPandocPipeline().prepare?.(source, { ...bib, bibliographies: [] }).signature,
    );
  });

  it('gives the completion entries from the plan', async () => {
    await loadBibtex();
    const pipeline = createPandocPipeline();
    const context = pipeline.prepare?.(source, bib);
    const keys = pipeline.completions?.(context as never).citations?.map((entry) => entry.key);
    expect(keys).toEqual(
      [...(keys ?? [])].sort().filter((key, index, all) => all.indexOf(key) === index),
    );
    expect(keys).toContain('smith2020');
    expect(keys).toHaveLength(8);
  });
});

describe('inline references of the metadata', () => {
  it('work without a bibliography file', () => {
    const source =
      '---\nreferences:\n- id: doe2001\n  type: book\n  author:\n  - family: Doe\n    given: Jo\n  title: A Book\n  issued:\n    date-parts:\n    - - 2001\n---\n\nSee @doe2001.\n';
    const { html } = htmlOf(source, { ...JSON_INPUTS, bibliographies: [] });
    expect(html).toContain('Doe (2001)');
    expect(html).toContain('id="ref-doe2001"');
  });
});

describe('task lists (Pandoc task_lists, on by default)', () => {
  it('renders the Phase 1 task box with the source line', () => {
    const none: ContextInputs = { ...inputs('x.bib', ''), bibliographies: [] };
    const { html } = htmlOf('- [ ] open\n- [x] done\n', none);
    // The same structure as the GFM pack gives for the same list (Phase 1 contract).
    const gfm = createGfmPipeline().render('- [ ] open\n- [x] done\n');
    expect(html).toBe(gfm.blocks.map((block) => block.html).join('\n'));
    expect(html.match(/task-checkbox/g)?.length).toBe(2);
  });
});
