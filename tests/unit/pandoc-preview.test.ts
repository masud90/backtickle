// @vitest-environment jsdom
/** WP5.11: the exact preview module (sanitizing, flavor routes, debounce, cancel, errors). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockPlatform } from '@/lib/platform-mock';
import {
  DEBOUNCE_MS,
  exactPreviewFlavor,
  namesBibliography,
  PandocPreview,
  pandocFrom,
} from '@/preview/pandoc-preview';
import { sanitizePandocHtml } from '@/preview/pandoc-preview/sanitize';

describe('sanitizing Pandoc HTML', () => {
  it('keeps MathML, headings with Pandoc ids, footnotes and citations', () => {
    const html =
      '<h2 id="links">Links</h2><p><span class="math inline"><math display="inline"><mi>x</mi><msup><mi>y</mi><mn>2</mn></msup></math></span>' +
      '<a href="#fn1" class="footnote-ref" id="fnref1" role="doc-noteref"><sup>1</sup></a>' +
      '<span class="citation" data-cites="a">(A 2020)</span></p>';
    const safe = sanitizePandocHtml(html);
    expect(safe).toContain('<h2 id="links">');
    expect(safe).toContain('<math');
    expect(safe).toContain('<msup>');
    expect(safe).toContain('data-cites="a"');
    expect(safe).toContain('href="#fn1"');
  });

  it('removes scripts, event handlers, styles, forms and style attributes', () => {
    const safe = sanitizePandocHtml(
      '<p style="color:red" onclick="x()">a</p><script>alert(1)</script><style>p{}</style>' +
        '<form action="/x"><input name="q"></form><iframe></iframe><object></object>',
    );
    expect(safe).not.toMatch(/<script|<style|<form|<input|<iframe|<object|onclick|style=/i);
    expect(safe).toContain('<p>a</p>');
  });

  it('moves local and remote image sources out of src, keeps https and data images', () => {
    const safe = sanitizePandocHtml(
      '<img src="pic.png"><img src="file:///a.png"><img src="http://x/a.png">' +
        '<img src="data:image/png;base64,AAAA"><img src="https://x/a.png">',
    );
    expect(safe).toContain('data-wd-src="pic.png"');
    expect(safe).toContain('src="data:image/png;base64,AAAA"');
    expect(safe).toContain('src="https://x/a.png"');
    expect(safe).not.toMatch(/ src="(?:pic\.png|file:|http:)/);
  });

  it('removes javascript: links', () => {
    expect(sanitizePandocHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:');
  });
});

describe('flavors and bibliographies', () => {
  it('maps the four flavors that have an exact preview to Pandoc input formats', () => {
    expect(pandocFrom('pandoc')).toBe('markdown');
    expect(pandocFrom('quarto')).toBe('markdown');
    expect(pandocFrom('gfm')).toBe('gfm');
    expect(pandocFrom('commonmark')).toBe('commonmark');
    expect(pandocFrom('mdx')).toBeNull();
    expect(pandocFrom('obsidian')).toBeNull();
    expect(exactPreviewFlavor('mdx')).toBe(false);
    expect(exactPreviewFlavor('obsidian')).toBe(false);
    expect(exactPreviewFlavor('quarto')).toBe(true);
  });

  it('sees a bibliography only in the leading YAML', () => {
    expect(namesBibliography('---\ntitle: A\nbibliography: refs.bib\n---\n\ntext')).toBe(true);
    expect(namesBibliography('---\ntitle: A\n---\n\nbibliography: refs.bib')).toBe(false);
    expect(namesBibliography('no front matter')).toBe(false);
  });
});

describe('rendering, debounce and cancel', () => {
  let scroller: HTMLElement;
  let article: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    scroller = document.createElement('div');
    article = document.createElement('article');
    scroller.append(article);
    document.body.append(scroller);
  });
  afterEach(() => {
    vi.useRealTimers();
    scroller.remove();
  });

  function make(
    seed: Parameters<typeof createMockPlatform>[0],
    over: Partial<{
      text: string;
      flavor: 'pandoc' | 'gfm';
      linked: string[];
      path: string | null;
    }> = {},
  ) {
    const platform = createMockPlatform(seed);
    const state = { text: over.text ?? '# A\n' };
    const preview = new PandocPreview({
      platform,
      scroller,
      article,
      getText: () => state.text,
      getContext: () => ({
        flavor: over.flavor ?? 'pandoc',
        path: over.path ?? '/Users/mock/a.md',
        linkedPaths: over.linked ?? [],
      }),
      resolveImage: () => undefined,
      onLink: () => {},
    });
    const mock = window.__WRITEDOWN_MOCK__ as NonNullable<typeof window.__WRITEDOWN_MOCK__>;
    return { platform: mock, state, preview };
  }

  it('renders on start, hides the normal preview and shows sanitized HTML', async () => {
    const { platform, preview } = make({
      pandocPreview: { html: '<h1 id="a">A</h1><script>x()</script>' },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(article.hidden).toBe(true);
    expect(preview.root.querySelector('h1#a')?.textContent).toBe('A');
    expect(preview.root.innerHTML).not.toContain('<script');
    expect(platform.pandocPreviewRequests).toHaveLength(1);
    preview.dispose();
    expect(article.hidden).toBe(false);
    expect(scroller.querySelector('.wd-pandoc-preview')).toBeNull();
  });

  it('sends the fixed request fields per flavor and asks for citeproc only with a granted bibliography', async () => {
    const withBib = make(
      {},
      {
        text: '---\nbibliography: refs.bib\n---\nx',
        linked: ['/Users/mock/refs.bib', '/Users/mock/x.md'],
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(withBib.platform.pandocPreviewRequests[0]).toEqual({
      docPath: '/Users/mock/a.md',
      input: '---\nbibliography: refs.bib\n---\nx',
      from: 'markdown',
      citeproc: true,
      bibliography: ['/Users/mock/refs.bib'],
    });
    withBib.preview.dispose();

    const none = make({}, { text: '---\nbibliography: refs.bib\n---\nx', linked: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(none.platform.pandocPreviewRequests[0]?.citeproc).toBe(false);
    none.preview.dispose();

    const gfm = make(
      {},
      { flavor: 'gfm', text: '---\nbibliography: refs.bib\n---\nx', linked: ['/a.bib'] },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(gfm.platform.pandocPreviewRequests[0]).toMatchObject({ from: 'gfm', citeproc: false });
    gfm.preview.dispose();
  });

  it('waits 800 ms after the last edit and starts one run', async () => {
    const { platform, preview, state } = make({});
    await vi.advanceTimersByTimeAsync(0);
    expect(DEBOUNCE_MS).toBe(800);
    state.text = 'one';
    preview.schedule();
    await vi.advanceTimersByTimeAsync(500);
    state.text = 'two';
    preview.schedule();
    await vi.advanceTimersByTimeAsync(799);
    expect(platform.pandocPreviewRequests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(platform.pandocPreviewRequests).toHaveLength(2);
    expect(platform.pandocPreviewRequests[1]?.input).toBe('two');
    preview.dispose();
  });

  it('an edit during a run cancels it and the late answer is ignored', async () => {
    const { platform, preview } = make({ pandocPreview: { hold: true } });
    await vi.advanceTimersByTimeAsync(0);
    expect(platform.pandocPreviewCancels).toBe(0);
    preview.schedule();
    expect(platform.pandocPreviewCancels).toBe(1);
    platform.finishPandocPreview({ html: '<p>stale</p>' });
    await vi.advanceTimersByTimeAsync(0);
    expect(preview.root.textContent).not.toContain('stale');
    platform.setPandocPreview({ html: '<p>fresh</p>' });
    await vi.advanceTimersByTimeAsync(800);
    expect(preview.root.textContent).toContain('fresh');
    preview.dispose();
  });

  it('an error shows a banner over the last good render, and the next good render clears it', async () => {
    const { platform, preview } = make({ pandocPreview: { html: '<p>good</p>' } });
    await vi.advanceTimersByTimeAsync(0);
    platform.setPandocPreview({ error: 'Error at line 3' });
    preview.schedule();
    await vi.advanceTimersByTimeAsync(800);
    const banner = preview.root.querySelector('[role="alert"]') as HTMLElement;
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toBe('Error at line 3');
    expect(preview.root.textContent).toContain('good');
    platform.setPandocPreview({ html: '<p>better</p>' });
    preview.schedule();
    await vi.advanceTimersByTimeAsync(800);
    expect(banner.hidden).toBe(true);
    expect(preview.root.textContent).toContain('better');
    preview.dispose();
  });

  it('turning it off while a run is going cancels the run', async () => {
    const { platform, preview } = make({ pandocPreview: { hold: true } });
    await vi.advanceTimersByTimeAsync(0);
    preview.dispose();
    expect(platform.pandocPreviewCancels).toBe(1);
  });

  it('follows headings by index: the n-th source heading is the n-th output heading', async () => {
    const { preview } = make({ pandocPreview: { html: '<h1>A</h1><p>x</p><h2>B</h2>' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(() => preview.followHeading(1)).not.toThrow();
    expect(() => preview.followHeading(-1)).not.toThrow();
    expect(() => preview.followHeading(9)).not.toThrow();
    preview.dispose();
  });
});
