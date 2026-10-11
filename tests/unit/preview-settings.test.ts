// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { detectFlavor } from '@/flavors';
import { DEFAULT_PREVIEW_OPTIONS, setPreviewOptions } from '@/preview/options';
import { createGfmPipeline } from '@/preview/packs/gfm';
import { createMdxPipeline } from '@/preview/packs/mdx';
import { createObsidianPipeline } from '@/preview/packs/obsidian';
import { createPandocPipeline } from '@/preview/packs/pandoc';
import { previewAppearance, previewExportStyle } from '@/preview/settings';

afterEach(() => {
  setPreviewOptions({ ...DEFAULT_PREVIEW_OPTIONS });
});

function html(pipeline: { render(s: string): { blocks: { html: string }[] } }, source: string) {
  return pipeline
    .render(source)
    .blocks.map((block) => block.html)
    .join('');
}

describe('flavor detection setting', () => {
  const base = {
    path: '/v/note.md',
    text: '---\nformat: html\n---\n',
    chosen: null,
    defaultFlavor: 'gfm' as const,
    inObsidianVault: true,
  };
  it('uses vault and frontmatter rules when on', () => {
    expect(detectFlavor(base).flavor).toBe('obsidian');
  });
  it('off: default for .md, extension still wins, choice wins', () => {
    expect(detectFlavor({ ...base, autoDetect: false })).toEqual({
      flavor: 'gfm',
      reason: 'default',
    });
    expect(detectFlavor({ ...base, path: '/v/a.qmd', autoDetect: false }).flavor).toBe('quarto');
    expect(detectFlavor({ ...base, chosen: 'pandoc', autoDetect: false }).flavor).toBe('pandoc');
  });
});

describe('render options', () => {
  it('hashtag pills in GFM only when on', () => {
    const p = createGfmPipeline();
    expect(html(p, 'a #tag b')).not.toContain('class="tag"');
    setPreviewOptions({ hashtagPills: true });
    expect(html(p, 'a #tag b')).toContain('<span class="tag">#tag</span>');
    expect(html(createMdxPipeline(), 'a #tag b')).toContain('<span class="tag">#tag</span>');
  });

  it('dims Obsidian comments and keeps them out of the word count', () => {
    const p = createObsidianPipeline();
    const source = 'one %%hidden words here%% two';
    const hidden = p.render(source);
    expect(hidden.blocks.map((b) => b.html).join('')).not.toContain('hidden');
    setPreviewOptions({ obsidianCommentsDimmed: true });
    const dimmed = p.render(source);
    expect(dimmed.blocks.map((b) => b.html).join('')).toContain('class="wd-comment">hidden words');
    expect(dimmed.stats.words).toBe(2);
  });

  it('smart punctuation off gives straight quotes in Pandoc', () => {
    const p = createPandocPipeline();
    expect(html(p, '"hi" -- there')).toContain('“hi” – there');
    setPreviewOptions({ smartPunctuation: false });
    expect(html(p, '"hi" -- there')).toContain('"hi" -- there');
  });

  it('math off shows the source text', () => {
    const p = createGfmPipeline();
    expect(html(p, 'x $a+b$ y')).toContain('class="math');
    setPreviewOptions({ math: false });
    const off = html(p, 'x $a+b$ y\n\n$$\nc\n$$');
    expect(off).not.toContain('class="math');
    expect(off).toContain('$a+b$');
    expect(html(createMdxPipeline(), 'x $a+b$ y')).not.toContain('class="math');
  });

  it('remote images off keep the address out of src', () => {
    const p = createGfmPipeline();
    const source = '![cat](https://example.com/c.png)';
    expect(html(p, source)).toContain('src="https://example.com/c.png"');
    setPreviewOptions({ remoteImages: false });
    const off = html(p, source);
    expect(off).not.toContain(' src=');
    expect(off).toContain('data-wd-remote');
    expect(off).toContain('data-wd-src="https://example.com/c.png"');
  });
});

describe('appearance variables', () => {
  const defaults = { font: 'inter', fontSize: 15, columnWidth: 720, codeCards: 'dark' } as never;
  it('sets nothing at the defaults', () => {
    expect(previewAppearance(defaults)).toEqual({
      fontFamily: null,
      sizeFactor: null,
      columnWidth: null,
      lightCodeCards: false,
    });
    expect(previewExportStyle(defaults).css).toBe('');
  });
  it('exports the chosen values', () => {
    const style = previewExportStyle({
      font: 'literata',
      fontSize: 18,
      columnWidth: 800,
      codeCards: 'light',
    } as never);
    expect(style.css).toContain('--wd-preview-size-factor: 1.2;');
    expect(style.css).toContain('--wd-preview-column-width: 800px;');
    expect(style.css).toContain('Literata');
    expect(style.lightCodeCards).toBe(true);
  });
});
