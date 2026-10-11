import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DETECTION_WINDOW,
  detectFlavor,
  FLAVORS,
  type FlavorId,
  type FlavorInput,
  fileExtension,
  flavorInfo,
  frontmatterHint,
  isFlavorId,
} from '@/flavors';
import analysisRmd from '../fixtures/flavors/analysis.Rmd?raw';
import componentMdx from '../fixtures/flavors/component.mdx?raw';
import notesMmd from '../fixtures/flavors/notes.mmd?raw';
import pandocHint from '../fixtures/flavors/pandoc-hint.md?raw';
import plainMd from '../fixtures/flavors/plain.md?raw';
import quartoHint from '../fixtures/flavors/quarto-hint.md?raw';
import reportQmd from '../fixtures/flavors/report.qmd?raw';

const FIXTURES = resolve(__dirname, '../fixtures/flavors');

function input(overrides: Partial<FlavorInput> = {}): FlavorInput {
  return {
    path: '/Users/me/notes/doc.md',
    text: '# Plain\n',
    chosen: null,
    defaultFlavor: 'gfm',
    inObsidianVault: false,
    ...overrides,
  };
}

/** A tiny copy of the rule the Rust side implements: an ancestor folder holds `.obsidian`. */
function inVault(path: string): boolean {
  let folder = dirname(path);
  for (;;) {
    if (existsSync(join(folder, '.obsidian'))) return true;
    const parent = dirname(folder);
    if (parent === folder) return false;
    folder = parent;
  }
}

describe('the flavor table', () => {
  it('lists the six flavors in menu order', () => {
    expect(FLAVORS.map((flavor) => flavor.id)).toEqual([
      'commonmark',
      'gfm',
      'obsidian',
      'pandoc',
      'quarto',
      'mdx',
    ]);
  });

  it('has the labels, pill labels and extensions of the spec', () => {
    const rows = FLAVORS.map((f) => [f.id, f.label, f.short, f.extensions.join(',')]);
    expect(rows).toEqual([
      ['commonmark', 'CommonMark', 'CommonMark', ''],
      ['gfm', 'GitHub Flavored Markdown (GFM)', 'GFM', 'md,markdown,mdown,mkd,mkdn'],
      ['obsidian', 'Obsidian', 'Obsidian', ''],
      ['pandoc', 'Pandoc / MMD', 'Pandoc / MMD', 'mmd'],
      ['quarto', 'Quarto / RMD', 'Quarto / RMD', 'qmd,rmd'],
      ['mdx', 'MDX', 'MDX', 'mdx'],
    ]);
  });

  it('marks only the flavors that have a pack as available; the others render as GFM', () => {
    const available = FLAVORS.filter((f) => f.available).map((f) => f.id);
    expect(available).toEqual(['commonmark', 'gfm', 'obsidian', 'pandoc', 'quarto', 'mdx']);
    for (const flavor of FLAVORS) {
      expect(flavor.renderAs, flavor.id).toBe(flavor.available ? flavor.id : 'gfm');
    }
  });

  it('keeps extensions lower-case and without a dot', () => {
    for (const flavor of FLAVORS) {
      for (const extension of flavor.extensions) {
        expect(extension).toBe(extension.toLowerCase());
        expect(extension.startsWith('.')).toBe(false);
      }
    }
  });

  it('looks up a flavor and recognizes ids', () => {
    expect(flavorInfo('quarto').short).toBe('Quarto / RMD');
    expect(isFlavorId('mdx')).toBe(true);
    expect(isFlavorId('markdown')).toBe(false);
    expect(isFlavorId(null)).toBe(false);
  });
});

describe('fileExtension', () => {
  it('returns the lower-case extension of the last path segment', () => {
    expect(fileExtension('/a/b/c.MD')).toBe('md');
    expect(fileExtension('C:\\docs\\Report.Rmd')).toBe('rmd');
    expect(fileExtension('/a.b/c')).toBe('');
    expect(fileExtension('/a/archive.tar.qmd')).toBe('qmd');
  });

  it('has no extension for untitled documents, hidden files and a trailing dot', () => {
    expect(fileExtension(null)).toBe('');
    expect(fileExtension('/a/.md')).toBe('');
    expect(fileExtension('/a/name.')).toBe('');
  });
});

describe('detectFlavor rule 1: the per-file choice', () => {
  it('wins over everything else', () => {
    const everything = input({
      path: '/vault/notes/report.qmd',
      text: quartoHint,
      inObsidianVault: true,
      chosen: 'commonmark',
    });
    expect(detectFlavor(everything)).toEqual({ flavor: 'commonmark', reason: 'chosen' });
  });

  it('can choose a flavor that is not available yet', () => {
    expect(detectFlavor(input({ chosen: 'obsidian' }))).toEqual({
      flavor: 'obsidian',
      reason: 'chosen',
    });
  });

  it('works for an untitled document', () => {
    expect(detectFlavor(input({ path: null, chosen: 'mdx' }))).toEqual({
      flavor: 'mdx',
      reason: 'chosen',
    });
  });
});

describe('detectFlavor rule 2: the extension', () => {
  const cases: Array<[string, FlavorId]> = [
    ['/p/component.mdx', 'mdx'],
    ['/p/report.qmd', 'quarto'],
    ['/p/analysis.Rmd', 'quarto'],
    ['/p/analysis.rmd', 'quarto'],
    ['/p/notes.mmd', 'pandoc'],
  ];
  it.each(cases)('%s is %s (reason: extension)', (path, flavor) => {
    expect(detectFlavor(input({ path }))).toEqual({ flavor, reason: 'extension' });
  });

  it('ignores the case of the extension', () => {
    expect(detectFlavor(input({ path: '/p/A.MDX' })).flavor).toBe('mdx');
    expect(detectFlavor(input({ path: '/p/A.QMD' })).flavor).toBe('quarto');
    expect(detectFlavor(input({ path: '/p/A.RMD' })).flavor).toBe('quarto');
    expect(detectFlavor(input({ path: '/p/A.MMD' })).flavor).toBe('pandoc');
  });

  it('works with the fixture files', () => {
    const path = (name: string) => join(FIXTURES, name);
    expect(detectFlavor(input({ path: path('component.mdx'), text: componentMdx })).flavor).toBe(
      'mdx',
    );
    expect(detectFlavor(input({ path: path('report.qmd'), text: reportQmd })).flavor).toBe(
      'quarto',
    );
    expect(detectFlavor(input({ path: path('analysis.Rmd'), text: analysisRmd })).flavor).toBe(
      'quarto',
    );
    expect(detectFlavor(input({ path: path('notes.mmd'), text: notesMmd })).flavor).toBe('pandoc');
  });

  it('wins over the vault and over frontmatter hints', () => {
    expect(detectFlavor(input({ path: '/vault/a.qmd', inObsidianVault: true })).reason).toBe(
      'extension',
    );
    expect(detectFlavor(input({ path: '/a/n.mmd', text: quartoHint }))).toEqual({
      flavor: 'pandoc',
      reason: 'extension',
    });
  });

  it('does not decide for Markdown extensions or unknown ones', () => {
    for (const extension of ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'txt', 'rst']) {
      expect(detectFlavor(input({ path: `/p/a.${extension}` })).reason, extension).toBe('default');
    }
  });
});

describe('detectFlavor rule 3: an Obsidian vault', () => {
  it.each(['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'MD'])(
    'makes a .%s file in a vault Obsidian',
    (extension) => {
      expect(detectFlavor(input({ path: `/v/n/a.${extension}`, inObsidianVault: true }))).toEqual({
        flavor: 'obsidian',
        reason: 'vault',
      });
    },
  );

  it('does not apply to other extensions, and not to an untitled document', () => {
    expect(detectFlavor(input({ path: '/v/a.txt', inObsidianVault: true })).reason).toBe('default');
    expect(detectFlavor(input({ path: null, inObsidianVault: true })).reason).toBe('default');
  });

  it('wins over frontmatter hints', () => {
    expect(detectFlavor(input({ text: pandocHint, inObsidianVault: true }))).toEqual({
      flavor: 'obsidian',
      reason: 'vault',
    });
  });

  it('is an input flag: only a document that is not in a vault falls through', () => {
    expect(detectFlavor(input({ text: pandocHint, inObsidianVault: false })).flavor).toBe('pandoc');
  });

  it('matches the layout of the vault fixture (an ancestor folder holds .obsidian)', () => {
    const note = join(FIXTURES, 'vault/notes/idea.md');
    expect(existsSync(note)).toBe(true);
    expect(inVault(note)).toBe(true);
    expect(inVault(join(FIXTURES, 'plain.md'))).toBe(false);
    expect(
      detectFlavor(input({ path: note, text: 'x', inObsidianVault: inVault(note) })).flavor,
    ).toBe('obsidian');
  });
});

describe('detectFlavor rule 4: frontmatter hints', () => {
  it.each(['bibliography', 'csl', 'link-citations'])('`%s` suggests Pandoc / MMD', (key) => {
    const text = `---\ntitle: T\n${key}: x\n---\n\n# Body\n`;
    expect(detectFlavor(input({ text }))).toEqual({ flavor: 'pandoc', reason: 'frontmatter' });
  });

  it.each(['format', 'execute', 'output'])('`%s` suggests Quarto / RMD', (key) => {
    const text = `---\ntitle: T\n${key}: html\n---\n\n# Body\n`;
    expect(detectFlavor(input({ text }))).toEqual({ flavor: 'quarto', reason: 'frontmatter' });
  });

  it('works with the fixture files', () => {
    expect(detectFlavor(input({ path: '/p/pandoc-hint.md', text: pandocHint })).flavor).toBe(
      'pandoc',
    );
    expect(detectFlavor(input({ path: '/p/quarto-hint.md', text: quartoHint })).flavor).toBe(
      'quarto',
    );
  });

  it('works for an untitled document and for other extensions', () => {
    expect(detectFlavor(input({ path: null, text: quartoHint })).flavor).toBe('quarto');
    expect(detectFlavor(input({ path: '/p/a.txt', text: pandocHint })).flavor).toBe('pandoc');
  });

  it('prefers Quarto when both kinds of key appear (Quarto builds on Pandoc)', () => {
    const text = '---\nbibliography: refs.bib\nformat: html\n---\n';
    expect(frontmatterHint(text)).toBe('quarto');
  });

  it('looks at top-level keys only', () => {
    const nested = '---\ntitle: T\nmeta:\n  format: html\n  bibliography: x\n---\n';
    expect(frontmatterHint(nested)).toBeNull();
    const quoted = '---\n"format": html\n---\n';
    expect(frontmatterHint(quoted)).toBe('quarto');
    const single = "---\n'bibliography': refs.bib\n---\n";
    expect(frontmatterHint(single)).toBe('pandoc');
  });

  it('ignores keys that only start with a hint word (output-file is not output)', () => {
    expect(frontmatterHint('---\noutput-file: x.html\n---\n')).toBeNull();
    expect(frontmatterHint('---\nformatting: x\n---\n')).toBeNull();
  });

  it('needs the block at the very start, opened and closed', () => {
    expect(frontmatterHint('\n---\nformat: html\n---\n')).toBeNull();
    expect(frontmatterHint('# Title\n\n---\nformat: html\n---\n')).toBeNull();
    expect(frontmatterHint('---\nformat: html\n\n# never closed\n')).toBeNull();
    expect(frontmatterHint('---\nformat: html\n...\n')).toBe('quarto');
  });

  it('accepts CRLF line endings and a byte order mark', () => {
    expect(frontmatterHint('---\r\nformat: html\r\n---\r\n')).toBe('quarto');
    expect(frontmatterHint('\ufeff---\nbibliography: x\n---\n')).toBe('pandoc');
  });

  it('inspects only the first 4 KB', () => {
    expect(DETECTION_WINDOW).toBe(4096);
    const filler = `note: ${'x'.repeat(DETECTION_WINDOW)}\n`;
    const late = `---\n${filler}format: html\n---\n`;
    expect(frontmatterHint(late)).toBeNull();
    const early = `---\nformat: html\n${filler}---\n`;
    // The block closes after the window, so it is not a closed block inside the window either.
    expect(frontmatterHint(early)).toBeNull();
    const closedEarly = `---\nformat: html\n---\n${'y'.repeat(DETECTION_WINDOW * 2)}`;
    expect(frontmatterHint(closedEarly)).toBe('quarto');
  });

  it('gives no hint for ordinary metadata', () => {
    expect(frontmatterHint('---\ntitle: T\nauthor: A\ndate: 2024-01-01\n---\n')).toBeNull();
    expect(frontmatterHint(plainMd)).toBeNull();
  });
});

describe('detectFlavor rule 5: the default', () => {
  it('uses the default for an ordinary .md file', () => {
    expect(detectFlavor(input({ path: '/p/plain.md', text: plainMd }))).toEqual({
      flavor: 'gfm',
      reason: 'default',
    });
  });

  it('uses the configured default flavor', () => {
    expect(detectFlavor(input({ defaultFlavor: 'commonmark' }))).toEqual({
      flavor: 'commonmark',
      reason: 'default',
    });
    expect(detectFlavor(input({ path: null, defaultFlavor: 'obsidian' }))).toEqual({
      flavor: 'obsidian',
      reason: 'default',
    });
  });
});

describe('detectFlavor: order of the rules', () => {
  it('goes chosen, extension, vault, frontmatter, default', () => {
    const base = { path: '/v/a.md', text: quartoHint, inObsidianVault: true };
    expect(detectFlavor(input({ ...base, chosen: 'mdx' })).reason).toBe('chosen');
    expect(detectFlavor(input({ ...base, path: '/v/a.qmd' })).reason).toBe('extension');
    expect(detectFlavor(input(base)).reason).toBe('vault');
    expect(detectFlavor(input({ ...base, inObsidianVault: false })).reason).toBe('frontmatter');
    expect(detectFlavor(input({ ...base, inObsidianVault: false, text: plainMd })).reason).toBe(
      'default',
    );
  });
});
