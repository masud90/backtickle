/** `ContextFetcher`: what a pack needs is fetched through the platform and cached per document. */
import { describe, expect, it, vi } from 'vitest';
import type { LinkedText, VaultIndex } from '@/lib/platform';
import type { ContextInputs, ContextNeeds, DocContext, Pipeline } from '@/preview/types';
import { ContextFetcher } from '@/shell/context';

const NONE: ContextNeeds = { bibliographies: [], includes: [], vault: false, project: false };
const VAULT: VaultIndex = { root: '/v', notes: ['a.md'], attachments: [], truncated: false };

function pack(needs: ContextNeeds, seen: ContextInputs[] = []): Pipeline {
  const empty = {
    headings: [],
    stats: { words: 0, characters: 0, charactersNoSpaces: 0 },
    frontmatter: null,
  };
  return {
    flavor: 'quarto',
    render: () => ({ ...empty, blocks: [], features: { math: false, languages: [] } }),
    analyze: () => empty,
    needs: () => needs,
    prepare: (_source, inputs): DocContext => {
      seen.push(inputs);
      return {
        metadata: {},
        labels: new Map(),
        citationKeys: [],
        bibliography: null,
        vault: null,
        includes: new Map(),
        signature: String(seen.length),
      };
    },
  };
}

function reader(files: Record<string, string>) {
  return {
    readLinkedText: vi.fn(async (_from: string, href: string): Promise<LinkedText> => {
      const text = files[href];
      if (text === undefined) throw new Error('not-found');
      return { path: `/docs/${href}`, text };
    }),
    vaultIndex: vi.fn(async () => VAULT),
    quartoProject: vi.fn(
      async (): Promise<LinkedText | null> => ({ path: '/docs/_quarto.yml', text: 'a: 1' }),
    ),
  };
}

describe('ContextFetcher', () => {
  it('has no context for a pack without hooks', () => {
    const fetcher = new ContextFetcher(reader({}), () => {});
    const plain = { ...pack(NONE), needs: undefined, prepare: undefined } as Pipeline;
    expect(fetcher.contextFor(1, plain, () => 'x', '/docs/a.qmd')).toBeUndefined();
  });

  it('fetches what is needed, parses nothing, and gives it to prepare', async () => {
    const files = reader({ 'refs.bib': '@book{a}', 'part.qmd': 'text' });
    const seen: ContextInputs[] = [];
    const fetcher = new ContextFetcher(files, () => {});
    const needs: ContextNeeds = {
      bibliographies: ['refs.bib', 'gone.bib'],
      includes: ['part.qmd', 'gone.qmd'],
      vault: true,
      project: true,
    };
    const source = () => 'doc';
    await fetcher.ready(1, pack(needs, seen), source, '/docs/a.qmd');
    const context = fetcher.contextFor(1, pack(needs, seen), source, '/docs/a.qmd');
    expect(context).toBeDefined();
    const inputs = seen.at(-1) as ContextInputs;
    expect(inputs.path).toBe('/docs/a.qmd');
    // A missing bibliography is left out, a missing include is a null entry.
    expect(inputs.bibliographies).toEqual([
      { href: 'refs.bib', path: '/docs/refs.bib', text: '@book{a}' },
    ]);
    expect([...inputs.includes]).toEqual([
      ['part.qmd', { path: '/docs/part.qmd', text: 'text' }],
      ['gone.qmd', null],
    ]);
    expect(inputs.vault).toEqual(VAULT);
    expect(inputs.project).toEqual({ path: '/docs/_quarto.yml', text: 'a: 1' });
  });

  it('caches by href per document, and reset reads again', async () => {
    const files = reader({ 'refs.bib': 'x' });
    const fetcher = new ContextFetcher(files, () => {});
    const needs = { ...NONE, bibliographies: ['refs.bib'] };
    await fetcher.ready(1, pack(needs), () => '', '/docs/a.qmd');
    await fetcher.ready(1, pack(needs), () => 'more text', '/docs/a.qmd');
    expect(files.readLinkedText).toHaveBeenCalledTimes(1);
    await fetcher.ready(2, pack(needs), () => '', '/docs/b.qmd');
    expect(files.readLinkedText).toHaveBeenCalledTimes(2);
    fetcher.reset(1);
    await fetcher.ready(1, pack(needs), () => '', '/docs/a.qmd');
    expect(files.readLinkedText).toHaveBeenCalledTimes(3);
    // A new href is fetched, the old one is not.
    await fetcher.ready(
      1,
      pack({ ...NONE, bibliographies: ['refs.bib', 'more.bib'] }),
      () => '',
      '/docs/a.qmd',
    );
    expect(files.readLinkedText).toHaveBeenCalledTimes(4);
  });

  it('tells when a fetch started by contextFor arrives, and a failure is a missing file', async () => {
    const arrived: number[] = [];
    const files = reader({});
    files.vaultIndex.mockRejectedValue(new Error('boom'));
    const fetcher = new ContextFetcher(files, (id) => arrived.push(id));
    const seen: ContextInputs[] = [];
    const needs = { ...NONE, includes: ['gone.qmd'], vault: true };
    fetcher.contextFor(7, pack(needs, seen), () => '', '/docs/a.qmd');
    expect(seen[0]?.includes.get('gone.qmd')).toBeNull();
    await vi.waitFor(() => expect(arrived.length).toBe(2));
    expect(arrived).toEqual([7, 7]);
    fetcher.contextFor(7, pack(needs, seen), () => '', '/docs/a.qmd');
    expect(seen.at(-1)?.vault).toBeNull();
    expect(files.readLinkedText).toHaveBeenCalledTimes(1);
  });

  it('a document without a path has nothing to read', async () => {
    const files = reader({ 'refs.bib': 'x' });
    const fetcher = new ContextFetcher(files, () => {});
    const seen: ContextInputs[] = [];
    const needs = { ...NONE, bibliographies: ['refs.bib'], vault: true };
    await fetcher.ready(1, pack(needs, seen), () => '', null);
    fetcher.contextFor(1, pack(needs, seen), () => '', null);
    expect(files.readLinkedText).not.toHaveBeenCalled();
    expect(seen.at(-1)).toMatchObject({ path: null, bibliographies: [], vault: null });
  });

  it('saving to another path reads the files again', async () => {
    const files = reader({ 'refs.bib': 'x' });
    const fetcher = new ContextFetcher(files, () => {});
    const needs = { ...NONE, bibliographies: ['refs.bib'] };
    await fetcher.ready(1, pack(needs), () => '', null);
    await fetcher.ready(1, pack(needs), () => '', '/docs/a.qmd');
    expect(files.readLinkedText).toHaveBeenCalledTimes(1);
  });
});
