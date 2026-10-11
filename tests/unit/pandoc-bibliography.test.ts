// @vitest-environment jsdom
/**
 * Bibliography formats (B07: BibTeX, CSL JSON and CSL YAML give the same list), the stats rule
 * for citations (B07/2.4) and the Phase 2 XSS fixture through the citation and table rules.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import MarkdownItConstructor from 'markdown-it';
import { describe, expect, it } from 'vitest';
import {
  guessFormat,
  inlineSource,
  loadBibtex,
  mergeBibliographies,
  parseBibliography,
} from '@/preview/bibliography';
import { BlockPipeline } from '@/preview/engine';
import { createEnv } from '@/preview/rules/env';
import { installCitations, prepareCitations } from '@/preview/rules/pandoc/citations';
import { installPandocTables } from '@/preview/rules/pandoc/tables';
import { installTables } from '@/preview/rules/tables';
import type { DocContext } from '@/preview/types';

// The BibTeX parser is a lazy chunk: load it before the files are read.
await loadBibtex();

const FOLDER = resolve(__dirname, '../fixtures');
const read = (name: string) => readFileSync(resolve(FOLDER, name), 'utf8');

describe('bibliography formats', () => {
  const bib = parseBibliography(read('flavors/pandoc/refs.bib'), 'bibtex');
  const json = parseBibliography(read('flavors/pandoc/refs.json'), 'csl-json');
  const yaml = parseBibliography(read('flavors/pandoc/refs.yaml'), 'csl-yaml');

  it('guesses the format from the extension', () => {
    expect(guessFormat('a/refs.bib')).toBe('bibtex');
    expect(guessFormat('refs.JSON')).toBe('csl-json');
    expect(guessFormat('refs.yml')).toBe('csl-yaml');
    expect(guessFormat('refs.txt')).toBeNull();
  });
  it('reads eight items from each file without errors', () => {
    for (const parsed of [bib, json, yaml]) {
      expect(parsed.errors).toEqual([]);
      expect(parsed.items.map((item) => item.id)).toEqual([
        'smith2020',
        'smith2020b',
        'jones2021',
        'brown2019',
        'lee2018',
        'unhcr2022',
        'garcia2017',
        'nodate',
      ]);
    }
  });
  it('gives the same authors, titles and years in the three formats', () => {
    const view = (items: typeof bib.items) =>
      items.map((item) => [item.id, item.author, item.title, item.issued, item['container-title']]);
    expect(view(bib.items)).toEqual(view(json.items));
    expect(view(yaml.items)).toEqual(view(json.items));
  });
  it('reports a later duplicate key and drops it', () => {
    const merged = mergeBibliographies([
      { name: 'a.json', items: json.items },
      { name: 'b.bib', items: bib.items.slice(0, 2) },
    ]);
    expect(merged.items.size).toBe(8);
    expect(merged.duplicates).toEqual([
      { key: 'smith2020', source: 'b.bib' },
      { key: 'smith2020b', source: 'b.bib' },
    ]);
  });
  it('reads inline references of the metadata (CSL YAML), unsafe tags refused', () => {
    const source = inlineSource({
      references: [{ id: 'x', type: 'book', title: 'T', issued: '2001-02-03' }],
    });
    expect(source.items[0]?.issued).toEqual({ 'date-parts': [[2001, 2, 3]] });
    expect(parseBibliography('- !!js/function x', 'csl-yaml').items).toEqual([]);
  });
  it('gives generic errors, not the text, for broken input', () => {
    expect(parseBibliography('{{{ secret', 'csl-json').errors).toEqual([
      'The bibliography is not valid JSON.',
    ]);
  });
  it('reads BibLaTeX fields', () => {
    const [item] = parseBibliography(
      '@article{k, author={Doe, Jo}, title={A Title}, journaltitle={The J}, date={2020-05-01}, volume=3, number=2, pages={1--9}}',
      'bibtex',
    ).items;
    expect(item).toMatchObject({
      id: 'k',
      type: 'article-journal',
      'container-title': 'The J',
      issued: { 'date-parts': [[2020, 5, 1]] },
      volume: '3',
      issue: '2',
      page: '1-9',
    });
  });
});

function pipelineWith(source: string, bibText: string, metadata: Record<string, unknown> = {}) {
  const md = new MarkdownItConstructor({ html: true });
  installPandocTables(md);
  installTables(md);
  installCitations(md);
  const pipeline = new BlockPipeline('pandoc', md);
  const bibliography = mergeBibliographies([
    { name: 'refs.bib', items: parseBibliography(bibText, 'bibtex').items },
  ]);
  const plan = prepareCitations({ source, bibliography, metadata });
  const context: DocContext = {
    metadata,
    labels: new Map(),
    citationKeys: plan.keys,
    bibliography: plan,
    vault: null,
    includes: new Map(),
    signature: plan.signature,
  };
  return { pipeline, context, plan };
}

describe('stats', () => {
  it('counts the printed citation text and not the reference list', () => {
    const source = 'Word [@smith2020] here.\n';
    const { pipeline, context, plan } = pipelineWith(source, read('flavors/pandoc/refs.bib'));
    // Word, Smith, 2020b, here = 4 words (the citation prints "(Smith 2020b)").
    expect(pipeline.render(source, context).stats.words).toBe(4);
    expect(plan.references).toHaveLength(1);
    // A missing key counts its printed "(@nobody?)": one word.
    const missing = 'Word [@nobody] here.\n';
    const other = pipelineWith(missing, read('flavors/pandoc/refs.bib'));
    expect(other.pipeline.render(missing, other.context).stats.words).toBe(3);
  });
  it('counts table captions and cells', () => {
    const source = '| A | B |\n|---|---|\n| one | two |\n\n: Caption words here\n';
    const { pipeline, context } = pipelineWith(source, read('flavors/pandoc/refs.bib'));
    expect(pipeline.render(source, context).stats.words).toBe(2 + 2 + 3);
  });
  it('renders a table with its caption as one block', () => {
    const source = '| A | B |\n|---|---|\n| one | two |\n\n: Caption words here\n\nAfter.\n';
    const { pipeline, context } = pipelineWith(source, read('flavors/pandoc/refs.bib'));
    const blocks = pipeline.render(source, context).blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.html).toContain('<caption>Caption words here</caption>');
    expect(blocks[0]?.endLine).toBeGreaterThanOrEqual(4);
  });
});

describe('the Phase 2 XSS fixture and hostile bibliography text', () => {
  const sentinel = window as unknown as Record<string, unknown>;
  it('keeps the sanitizer rules and never sets the sentinel', () => {
    const source = read('xss/phase2/pandoc.md');
    const { pipeline, context } = pipelineWith(source, read('flavors/pandoc/refs.bib'));
    const html = pipeline
      .render(source, context)
      .blocks.map((block) => block.html)
      .join('\n');
    const template = document.createElement('template');
    template.innerHTML = html;
    expect(template.content.querySelector('script, iframe, form, input, svg')).toBeNull();
    for (const element of template.content.querySelectorAll('*')) {
      for (const attribute of element.getAttributeNames()) {
        expect(attribute.startsWith('on') || attribute === 'style').toBe(false);
        expect(element.getAttribute(attribute)).not.toMatch(/^\s*javascript:/i);
      }
    }
    expect(sentinel.__XSS_SENTINEL__).toBeUndefined();
  });
  it('escapes titles, keys and links from the bibliography and the citation', () => {
    const bib =
      '@book{evil, author={<img src=x onerror=window.__XSS_SENTINEL__=1>}, title={<script>window.__XSS_SENTINEL__=1</script>}, year={2020}, url={javascript:window.__XSS_SENTINEL__=1}}';
    const source = '[@evil] and [@a"b]\n\n::: x\n:::\n';
    const { pipeline, context, plan } = pipelineWith(source, bib, { 'link-citations': true });
    const html = pipeline
      .render(source, context)
      .blocks.map((block) => block.html)
      .join('\n');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    const entry = plan.references[0]?.html ?? '';
    expect(entry).not.toContain('<img');
    expect(entry).not.toContain('<script');
    expect(entry).not.toContain('href="javascript');
    expect(sentinel.__XSS_SENTINEL__).toBeUndefined();
    void createEnv;
  });
});
