// @vitest-environment jsdom
/**
 * B07 at unit level: the citation forms of the Pandoc fixtures give the text Pandoc 3.8.3
 * `--citeproc` produced (tests/fixtures/flavors/pandoc/expected, made by
 * scripts/gen-pandoc-expected.mjs), from BibTeX, CSL JSON and CSL YAML alike.
 *
 * Allowed differences from Pandoc:
 * - a key that is not in the bibliography prints `@key?` where Pandoc prints `key?`;
 * - the MultiMarkdown form `[#key]` is a citation here and plain text in Pandoc.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import MarkdownItConstructor from 'markdown-it';
import { describe, expect, it } from 'vitest';
import {
  type BibliographyFormat,
  guessFormat,
  loadBibtex,
  mergeBibliographies,
  parseBibliography,
} from '@/preview/bibliography';
import { createEnv, wdEnv } from '@/preview/rules/env';
import {
  citationCompletions,
  installCitations,
  prepareCitations,
  renderReferenceEntries,
  renderReferenceList,
  scanCitedKeys,
} from '@/preview/rules/pandoc/citations';
import type { DocContext } from '@/preview/types';

// The BibTeX parser is a lazy chunk: load it before the files are read.
await loadBibtex();

const FOLDER = resolve(__dirname, '../fixtures/flavors/pandoc');
// Pandoc prints some spaces as no-break spaces (after "p.", between "ch." and the number).
const read = (name: string) => readFileSync(resolve(FOLDER, name), 'utf8').replace(/\u00a0/g, ' ');

function bibliographyOf(file: string) {
  const format = guessFormat(file) as BibliographyFormat;
  return mergeBibliographies([{ name: file, items: parseBibliography(read(file), format).items }]);
}

function contextOf(plan: unknown): DocContext {
  return {
    metadata: {},
    labels: new Map(),
    citationKeys: [],
    bibliography: plan,
    vault: null,
    includes: new Map(),
    signature: 'test',
  };
}

function render(source: string, plan: ReturnType<typeof prepareCitations>) {
  const md = new MarkdownItConstructor({ html: true });
  installCitations(md);
  const env = createEnv();
  wdEnv(env).context = contextOf(plan);
  return md.render(source, env);
}

function paragraphs(html: string): string[] {
  const template = document.createElement('template');
  template.innerHTML = html;
  return [...template.content.querySelectorAll('p')].map((p) => p.textContent ?? '');
}

/** Frontmatter as metadata, the way the pack will read it. */
function metadataOf(source: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  const data: Record<string, unknown> = {};
  for (const line of (match?.[1] ?? '').split('\n')) {
    const pair = /^([\w-]+):\s*(.*)$/.exec(line);
    if (pair)
      data[pair[1] as string] =
        pair[2] === 'true' ? true : (pair[2] as string).replace(/^"|"$/g, '');
  }
  return data;
}

describe.each([
  ['citations.md', 'refs.bib'],
  ['citations-json.md', 'refs.json'],
  ['citations-yaml.md', 'refs.yaml'],
])('%s against Pandoc (%s)', (fixture, bibFile) => {
  const source = read(fixture);
  const expected = read(`expected/${fixture.replace('.md', '.txt')}`);
  const plan = prepareCitations({
    source,
    bibliography: bibliographyOf(bibFile),
    metadata: metadataOf(source),
  });
  const html = render(source.replace(/^---\n[\s\S]*?\n---\n/, ''), plan);
  const [bodyExpected, referencesExpected] = splitExpected(expected);

  it('prints every citation form as Pandoc does', () => {
    const got = paragraphs(html).filter((text) =>
      /citation|Narrative|Standard|Suppressed|Multiple|Author|Citation|Multi/.test(text),
    );
    const want = bodyExpected
      .map((text) => text.replace(/\u2013/g, '-'))
      .map((text) => text.replace('(missingkey?)', '(@missingkey?)'))
      .map((text) => text.replace('[#brown2019]', '(Brown and White 2019)'));
    expect(got).toEqual(want);
  });

  it('lists the references in Pandoc order with Pandoc entries', () => {
    expect(plan.references.map((reference) => reference.text)).toEqual(referencesExpected);
  });

  it('marks the missing key and links to the entries', () => {
    expect(html).toContain('class="citation citation-missing" data-cites="missingkey"');
    expect(html).not.toContain('href="#ref-missingkey"');
    if (fixture !== 'citations-options.md') expect(html).toContain('<a href="#ref-smith2020">');
  });
});

/** The body paragraphs and the reference paragraphs of a Pandoc plain-text output. */
function splitExpected(text: string): [string[], string[]] {
  const blocks = text.trim().split(/\n\n+/);
  const cut = blocks.findIndex(
    (block) =>
      /^[A-Z][^:]*, [A-Z].*\. \d{4}[ab]?\. |^United|^Taylor/.test(block) ||
      /\. (?:\d{4}[ab]?|n\.d\.)\. /.test(block),
  );
  return [blocks.slice(0, cut), blocks.slice(cut)];
}

describe('citations-options.md (suppress-bibliography, nocite)', () => {
  const source = read('citations-options.md');
  const plan = prepareCitations({
    source,
    bibliography: bibliographyOf('refs.bib'),
    metadata: { 'link-citations': true, 'suppress-bibliography': true, nocite: '@jones2021' },
  });
  it('hides the reference list but keeps the in-text texts of Pandoc', () => {
    const expected = read('expected/citations-options.txt').trim().split(/\n\n+/);
    expect(expected.some((block) => block.startsWith('Brown, Alice'))).toBe(false);
    expect(renderReferenceEntries(plan)).toBe('');
    expect(renderReferenceList(plan)).toBe('');
    const got = paragraphs(render(source, plan)).filter((t) =>
      /^(Standard|Narrative|Suppressed|Citation|Multiple|Author)/.test(t),
    );
    expect(got[0]).toBe('Standard citation in brackets: (Smith 2020b)');
  });
  it('lists a nocite key without a citation of it', () => {
    const noCitation = prepareCitations({
      source: 'Nothing is cited here.',
      bibliography: bibliographyOf('refs.bib'),
      metadata: { nocite: '@jones2021' },
    });
    expect(noCitation.references.map((r) => r.key)).toEqual(['jones2021']);
    const all = prepareCitations({
      source: 'x',
      bibliography: bibliographyOf('refs.bib'),
      metadata: { nocite: ['@*'] },
    });
    expect(all.references).toHaveLength(8);
  });
});

describe('citation texts from the extra Pandoc probe (expected/probe.txt)', () => {
  const source = read('expected/src/probe.md');
  const expected = read('expected/probe.txt');
  const plan = prepareCitations({
    source,
    bibliography: bibliographyOf('refs.bib'),
    metadata: {},
  });
  it('matches Pandoc for locators, collapsing and prefixes', () => {
    const got = paragraphs(render(source.replace(/^---\n[\s\S]*?\n---\n/, ''), plan));
    // Allowed difference: a range keeps the hyphen as written.
    const want = expected
      .trim()
      .split(/\n\n+/)
      .slice(0, 2)
      .map((t) => t.replace(/\u2013/g, '-'));
    expect(got.slice(0, 2)).toEqual(want);
  });
  it('lists the references like Pandoc', () => {
    const want = expected.trim().split(/\n\n+/).slice(2);
    expect(plan.references.map((reference) => reference.text)).toEqual(want);
  });
});

describe('the extra entry types (expected/p3.txt)', () => {
  const source = read('expected/src/p3.md');
  const expected = read('expected/p3.txt');
  const metadata = { references: undefined };
  void metadata;
  const references = parseBibliography(
    source.replace(/^---\n/, '').replace(/\n---\n[\s\S]*$/, '\n'),
    'csl-yaml',
  );
  const plan = prepareCitations({
    source,
    bibliography: mergeBibliographies([{ name: 'references', items: references.items }]),
    metadata: {},
  });
  it('matches Pandoc for the text of the citations and of the entries', () => {
    const blocks = expected.trim().split(/\n\n+/);
    expect(paragraphs(render(source.replace(/^---\n[\s\S]*?\n---\n/, ''), plan))[0]).toBe(
      blocks[0],
    );
    expect(plan.references.map((reference) => reference.text)).toEqual(blocks.slice(1));
  });
});

describe('forms and edge cases', () => {
  const bibliography = bibliographyOf('refs.bib');
  const plan = (source: string, metadata: Record<string, unknown> = {}) =>
    prepareCitations({ source, bibliography, metadata });
  const textOf = (source: string, metadata: Record<string, unknown> = {}) =>
    paragraphs(render(source, plan(source, metadata)))[0];

  it('reads [#key] only for keys of the bibliography', () => {
    expect(textOf('See [#brown2019] and [#nothing].')).toBe(
      'See (Brown and White 2019) and [#nothing].',
    );
  });
  it('reads the MultiMarkdown form with a locator', () => {
    expect(textOf('See [p. 12][#brown2019].')).toBe('See (Brown and White 2019, 12).');
  });
  it('does not read an e-mail address as a citation', () => {
    expect(textOf('Mail me@smith2020.com or [@smith2020](https://example.org).')).toBe(
      'Mail me@smith2020.com or Smith (2020).',
    );
  });
  it('reads keys in braces and keys with punctuation', () => {
    const odd = prepareCitations({
      source: '[@{a key}] [@a:b.c-d]',
      bibliography: null,
      metadata: {},
    });
    expect(odd.keys).toEqual(['a key', 'a:b.c-d']);
  });
  it('collapses citations of one author and keeps a range hyphen as written', () => {
    expect(textOf('[@smith2020, pp. 3-4; @smith2020b]')).toBe('(Smith 2020b, 3-4; 2020a)');
  });
  it('escapes everything it prints', () => {
    const html = render('[@x<img src=x onerror=alert(1)>]', plan('[@x]'));
    expect(html).not.toContain('<img');
  });
  it('collects keys in order of first use and ignores code, comments and frontmatter', () => {
    const source = [
      '---',
      'note: "[@fm]"',
      '---',
      '',
      'Start [@b], then @a and `[@code]`.',
      '',
      '```',
      '[@fenced]',
      '```',
      '',
      '<!-- [@comment] -->',
      '',
      '[@a; @c]',
    ].join('\n');
    expect(scanCitedKeys(source)).toEqual(['b', 'a', 'c']);
  });
  it('gives completion entries with author, year and title', () => {
    const entries = citationCompletions(bibliography);
    expect(entries.find((entry) => entry.key === 'brown2019')).toEqual({
      key: 'brown2019',
      label: 'Brown and White 2019',
      detail: 'Empirical Findings in Practice',
    });
    expect(entries.find((entry) => entry.key === 'nodate')?.label).toBe('Taylor n.d.');
  });
  it('has a signature that changes with the printed text', () => {
    const a = plan('[@smith2020]');
    const b = plan('[@smith2020b]');
    expect(a.signature).not.toBe(b.signature);
    expect(a.signature).toBe(plan('[@smith2020]').signature);
  });
  it('prints every key as missing when there is no bibliography', () => {
    const none = prepareCitations({ source: '[@a]', bibliography: null, metadata: {} });
    expect(paragraphs(render('[@a] and @b', none))[0]).toBe('(@a?) and @b?');
  });
});
