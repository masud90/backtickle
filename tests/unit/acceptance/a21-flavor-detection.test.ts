/**
 * A21 (unit part): the flavor table and the detection order.
 * The expectations are written from the specification, not from the implementation.
 */
import { describe, expect, it } from 'vitest';
import { detectFlavor, FLAVORS, type FlavorId, type FlavorInput } from '@/flavors';

const base: FlavorInput = {
  path: '/notes/doc.md',
  text: '# Title\n',
  chosen: null,
  defaultFlavor: 'gfm',
  inObsidianVault: false,
};

const detect = (patch: Partial<FlavorInput>) => detectFlavor({ ...base, ...patch });

describe('A21 flavor table', () => {
  it('lists the six flavors in the specified order with labels, pill labels and extensions', () => {
    expect(
      FLAVORS.map((f) => [f.id, f.label, f.short, [...f.extensions], f.available, f.renderAs]),
    ).toEqual([
      ['commonmark', 'CommonMark', 'CommonMark', [], true, 'commonmark'],
      [
        'gfm',
        'GitHub Flavored Markdown (GFM)',
        'GFM',
        ['md', 'markdown', 'mdown', 'mkd', 'mkdn'],
        true,
        'gfm',
      ],
      ['obsidian', 'Obsidian', 'Obsidian', [], true, 'obsidian'],
      ['pandoc', 'Pandoc / MMD', 'Pandoc / MMD', ['mmd'], true, 'pandoc'],
      ['quarto', 'Quarto / RMD', 'Quarto / RMD', ['qmd', 'rmd'], true, 'quarto'],
      ['mdx', 'MDX', 'MDX', ['mdx'], true, 'mdx'],
    ]);
  });
});

describe('A21 detection order: first match wins', () => {
  it('1. the per-file choice beats everything', () => {
    const text = '---\nformat: html\n---\n';
    for (const chosen of [
      'commonmark',
      'gfm',
      'obsidian',
      'pandoc',
      'quarto',
      'mdx',
    ] as FlavorId[]) {
      expect(detect({ path: '/a/x.qmd', text, chosen, inObsidianVault: true })).toEqual({
        flavor: chosen,
        reason: 'chosen',
      });
    }
  });

  it('2. the extensions mdx, qmd, rmd and mmd decide, case-insensitively', () => {
    const table: Array<[string, FlavorId]> = [
      ['/a/x.mdx', 'mdx'],
      ['/a/x.MDX', 'mdx'],
      ['/a/x.qmd', 'quarto'],
      ['/a/x.QMD', 'quarto'],
      ['/a/x.rmd', 'quarto'],
      ['/a/x.Rmd', 'quarto'],
      ['/a/x.RMD', 'quarto'],
      ['/a/x.mmd', 'pandoc'],
      ['/a/x.MMD', 'pandoc'],
    ];
    for (const [path, flavor] of table) {
      expect(detect({ path }), path).toEqual({ flavor, reason: 'extension' });
    }
  });

  it('2. an extension beats a vault and frontmatter hints', () => {
    const text = '---\nbibliography: refs.bib\n---\n';
    expect(detect({ path: '/v/x.qmd', text, inObsidianVault: true })).toEqual({
      flavor: 'quarto',
      reason: 'extension',
    });
    expect(detect({ path: '/v/x.mmd', text: '---\nformat: html\n---\n' }).flavor).toBe('pandoc');
  });

  it('3. a vault makes Markdown-family files Obsidian, and only those', () => {
    for (const ext of ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'MD']) {
      expect(detect({ path: `/v/x.${ext}`, inObsidianVault: true }), ext).toEqual({
        flavor: 'obsidian',
        reason: 'vault',
      });
    }
    expect(detect({ path: '/v/x.txt', inObsidianVault: true }).flavor).toBe('gfm');
    // The vault comes before frontmatter hints.
    expect(
      detect({ path: '/v/x.md', text: '---\nbibliography: r.bib\n---\n', inObsidianVault: true }),
    ).toEqual({ flavor: 'obsidian', reason: 'vault' });
  });

  it('4. top-level frontmatter keys give pandoc or quarto', () => {
    for (const key of ['bibliography', 'csl', 'link-citations']) {
      expect(detect({ text: `---\ntitle: T\n${key}: x\n---\n\n# H\n` }), key).toEqual({
        flavor: 'pandoc',
        reason: 'frontmatter',
      });
    }
    for (const key of ['format', 'execute', 'output']) {
      expect(detect({ text: `---\ntitle: T\n${key}: html\n---\n\n# H\n` }), key).toEqual({
        flavor: 'quarto',
        reason: 'frontmatter',
      });
    }
  });

  it('4. frontmatter hints apply to untitled documents too', () => {
    expect(detect({ path: null, text: '---\nbibliography: r.bib\n---\n' }).flavor).toBe('pandoc');
    expect(detect({ path: null, text: '---\nformat: html\n---\n' }).flavor).toBe('quarto');
  });

  it('4. only top-level keys of a leading frontmatter block count', () => {
    // Nested key.
    expect(detect({ text: '---\nauthor:\n  format: x\n---\n' })).toEqual({
      flavor: 'gfm',
      reason: 'default',
    });
    // Not at the start of the document.
    expect(detect({ text: '\n---\nformat: html\n---\n' }).reason).toBe('default');
    expect(detect({ text: '# Title\n\n---\nformat: html\n---\n' }).reason).toBe('default');
    // A look-alike key.
    expect(detect({ text: '---\nformats: x\n---\n' }).reason).toBe('default');
  });

  it('4. only the first 4 KB are inspected', () => {
    const padding = `${'a: b\n'.repeat(900)}`; // about 4.5 KB of keys
    const late = `---\n${padding}format: html\n---\n`;
    expect(late.indexOf('format: html')).toBeGreaterThan(4096);
    expect(detect({ text: late }).reason).toBe('default');
    const early = `---\nformat: html\n---\n${padding}`; // the text after the block is far beyond 4 KB
    expect(detect({ text: early })).toEqual({ flavor: 'quarto', reason: 'frontmatter' });
  });

  it('5. otherwise the default flavor', () => {
    expect(detect({})).toEqual({ flavor: 'gfm', reason: 'default' });
    expect(detect({ defaultFlavor: 'commonmark' })).toEqual({
      flavor: 'commonmark',
      reason: 'default',
    });
    expect(detect({ path: null, defaultFlavor: 'obsidian' })).toEqual({
      flavor: 'obsidian',
      reason: 'default',
    });
    expect(detect({ path: '/a/notes.txt', defaultFlavor: 'commonmark' }).flavor).toBe('commonmark');
  });
});
