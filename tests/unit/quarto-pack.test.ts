// @vitest-environment jsdom
/**
 * The Quarto / RMD pack. Expected numbers
 * come from the fixtures themselves (the order of their figures, tables and sections).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createQuartoPipeline } from '@/preview/packs/quarto';
import type { ContextInputs } from '@/preview/types';

const DIR = resolve(__dirname, '../fixtures/flavors/quarto');
const read = (name: string) => readFileSync(resolve(DIR, name), 'utf8');
const INCLUDES = ['_part-a.qmd', '_part-b.qmd', '_cycle-x.qmd', '_cycle-y.qmd'];

function inputs(extra: Partial<ContextInputs> = {}): ContextInputs {
  return {
    path: '/d/a.qmd',
    bibliographies: [],
    includes: new Map(INCLUDES.map((n) => [n, { path: `/d/${n}`, text: read(n) }])),
    vault: null,
    project: null,
    ...extra,
  };
}

function render(source: string, extra: Partial<ContextInputs> = {}) {
  const p = createQuartoPipeline();
  const ctx = p.prepare?.(source, inputs(extra));
  const result = p.render(source, ctx);
  const html = result.blocks.map((b) => b.html).join('\n');
  const dom = document.createElement('div');
  dom.innerHTML = html;
  return { p, ctx, result, html, dom };
}

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('B13 chunks', () => {
  const { dom, result } = render(read('chunks.qmd'));
  it('makes a card with label and option pills, without the #| lines', () => {
    const card = dom.querySelector('.code-chunk[data-label="setup"]');
    expect(card?.getAttribute('data-lang')).toBe('r');
    expect([...(card?.querySelectorAll('.chunk-option') ?? [])].map(text)).toEqual([
      'include: FALSE',
    ]);
    const q = render('```{r}\n#| label: x\n#| echo: false\nsum(1)\n```\n');
    expect(text(q.dom.querySelector('pre code'))).toBe('sum(1)');
    expect([...q.dom.querySelectorAll('.chunk-option')].map(text)).toEqual(['echo: false']);
    expect(q.dom.querySelector('.chunk-label')?.textContent).toBe('x');
  });
  it('knows every language, and a mermaid chunk is a diagram', () => {
    for (const lang of ['r', 'python', 'julia', 'sql', 'bash', 'ojs', 'stata']) {
      expect(dom.querySelector(`.code-chunk[data-lang="${lang}"]`), lang).not.toBeNull();
    }
    expect(dom.querySelector('.mermaid-diagram')).not.toBeNull();
    expect(result.features.mermaid).toBe(true);
  });
  it('marks inline chunks and keeps them out of the word count', () => {
    expect(dom.querySelectorAll('code.inline-chunk')).toHaveLength(2);
    const a = render('Some words `r 1+1` here.\n').result.stats.words;
    expect(a).toBe(3);
  });
  it('never runs anything: the side-effect fixture only shows code', () => {
    const r = render(read('side-effect.qmd'));
    expect(r.dom.querySelectorAll('.code-chunk')).toHaveLength(2);
    expect(existsSync(resolve(process.cwd(), 'SIDE_EFFECT_R'))).toBe(false);
    expect(existsSync(resolve(process.cwd(), 'SIDE_EFFECT_PY'))).toBe(false);
  });
});

describe('B14 and B18 cross-references and figure chunks', () => {
  it('numbers figures, tables, equations and sections with number-sections', () => {
    const { dom } = render(read('crossref.qmd'));
    expect(text(dom.querySelector('#fig-a figcaption'))).toBe('Figure 1: Figure A');
    expect(text(dom.querySelector('#fig-b figcaption'))).toBe('Figure 2: Figure B');
    expect(text(dom.querySelector('#tbl-b caption'))).toBe('Table 2: Table B Caption');
    expect(text(dom.querySelector('#eq-a .eq-number'))).toBe('(1)');
    expect(text(dom.querySelector('#sec-method .header-section-number'))).toBe('1.1');
    const refs = [...dom.querySelectorAll('a.xref')].map((a) => [a.getAttribute('href'), text(a)]);
    expect(refs).toEqual([
      ['#sec-method', 'Section 1.1'],
      ['#fig-a', 'Figure 1'],
      ['#tbl-a', 'Table 1'],
      ['#fig-b', 'Figure 2'],
      ['#tbl-a', '1'],
      ['#eq-a', 'Equation 1'],
      ['#sec-method', 'Section 1.1'],
    ]);
    expect(text(dom.querySelector('.xref-missing'))).toBe('?@fig-missing');
  });
  it('gives "Section" and the number without number-sections, as Quarto 1.9.38 does', () => {
    const { dom } = render(read('crossref-plain.qmd'));
    expect(dom.querySelector('.header-section-number')).toBeNull();
    expect(text(dom.querySelector('a[href="#sec-method"]'))).toBe('Section 1.1');
  });
  it("numbers sections for references by Quarto's rule; an unnumbered one is missing", () => {
    // Expected values: Quarto 1.9.38 output for this source (engine: markdown).
    const src =
      '---\ntitle: T\n---\n\n# One\n\n## Plain two\n\n# Two {#sec-two}\n\n## Sub {#sec-sub}\n\n' +
      '## Un {.unnumbered #sec-un}\n\n## After {#sec-after}\n\n# Three {#sec-three}\n\n' +
      '### Deep {#sec-deep}\n\nSee @sec-two, @sec-sub, @sec-un, @sec-after, @sec-three, @sec-deep.\n';
    const { dom } = render(src);
    const p = [...dom.querySelectorAll('p')].at(-1);
    expect(text(p ?? null)).toBe(
      'See Section 2, Section 2.1, ?@sec-un, Section 2.2, Section 3, Section 3.0.1.',
    );
  });
  it('reads bookdown references with chunk-name figure labels', () => {
    const { dom } = render(read('bookdown.Rmd'));
    const refs = [...dom.querySelectorAll('a.xref')].map((a) => [a.getAttribute('href'), text(a)]);
    expect(refs).toEqual([
      ['#fig-scatter', '1'],
      ['#tab-summary', '1'],
      ['#eq-mean', '1'],
      ['#results', '1'],
    ]);
  });
  it('gives a figure chunk a numbered placeholder that references reach', () => {
    const { dom } = render(
      '```{r}\n#| label: fig-t\n#| fig-cap: "Trend"\nplot(1)\n```\n\nSee @fig-t.\n',
    );
    expect(text(dom.querySelector('figure.chunk-figure#fig-t figcaption'))).toBe('Figure 1: Trend');
    expect(dom.querySelector('.chunk-output-placeholder')).not.toBeNull();
    expect(dom.querySelector('a[href="#fig-t"]')).not.toBeNull();
  });
  it('honors crossref prefixes', () => {
    const { dom } = render(
      '---\ncrossref:\n  fig-prefix: Fig.\n---\n\n![A](a.png){#fig-a}\n\nSee @fig-a.\n',
    );
    expect(text(dom.querySelector('a.xref'))).toBe('Fig. 1');
  });
  it('counts reference text and caption labels as words', () => {
    const { result } = render('![A](a.png){#fig-a}\n\nSee @fig-a.\n');
    // "Figure 1: A" (3) + "See Figure 1." (3)
    expect(result.stats.words).toBe(6);
  });
});

describe('B15 callouts, tabsets, columns', () => {
  const { dom, result } = render(read('layout.qmd'));
  it('makes the five callouts with titles and collapse', () => {
    for (const t of ['note', 'warning', 'important', 'tip', 'caution']) {
      expect(dom.querySelector(`.callout-${t}`), t).not.toBeNull();
    }
    expect(text(dom.querySelector('.callout-important .callout-title'))).toBe('Custom');
    expect(text(dom.querySelector('.callout-tip .callout-title'))).toBe('Tip Title');
    const folded = dom.querySelector('details.callout-caution');
    expect(folded?.hasAttribute('open')).toBe(false);
    expect(dom.querySelector('details.callout-warning')?.hasAttribute('open')).toBe(true);
  });
  it('makes tab panels, and tab titles are not in the outline', () => {
    const panels = [...dom.querySelectorAll('.tabset > section.tabset-panel')];
    expect(panels.map((p) => p.getAttribute('data-tab-title'))).toEqual([
      'Tab One',
      'Tab Two',
      'Tab Three',
    ]);
    const heads = result.headings.map((h) => h.text);
    expect(heads).not.toContain('Tab One');
    expect(heads).not.toContain('Tip Title');
  });
  it('makes columns with widths', () => {
    expect(
      [...dom.querySelectorAll('.columns > .column')].map((c) => c.getAttribute('data-wd-width')),
    ).toEqual(['40%', '60%']);
  });
});

describe('B16 shortcodes', () => {
  it('handles pagebreak, meta, kbd, include and unknown', () => {
    const { dom } = render(read('shortcodes.qmd'));
    expect(dom.querySelector('hr.pagebreak')).not.toBeNull();
    expect(dom.textContent).toContain('Meta subtitle: From meta');
    expect(text(dom.querySelector('kbd'))).toBe('Cmd-S');
    expect(
      dom.querySelector('.include[data-src="_part-a.qmd"] .include[data-src="_part-b.qmd"]'),
    ).not.toBeNull();
    expect(text(dom.querySelector('code.shortcode'))).toContain('video');
  });
  it('shows a cycle card and a not-found card', () => {
    const cyc = render(read('cycle.qmd'));
    expect(text(cyc.dom.querySelector('.include-card'))).toMatch(/Include cycle/);
    const miss = render('{{< include nothing.qmd >}}\n');
    expect(text(miss.dom.querySelector('.include-card'))).toMatch(/not found/);
  });
  it('counts included text and shows the included headings in the outline', () => {
    const { result } = render(read('shortcodes.qmd'));
    expect(result.headings.map((h) => h.text)).toContain('Part A Heading');
  });
});

describe('B17 the project file', () => {
  it('supplies number-sections and the bibliography when the document has none', () => {
    const project = {
      path: '/d/_quarto.yml',
      text: read('project/_quarto.yml'),
    };
    const p = createQuartoPipeline();
    const src = '# One\n\nText [@smith2020].\n';
    const ctx = p.prepare?.(src, inputs({ project }));
    expect(ctx?.metadata['number-sections']).toBe(true);
    expect(ctx?.metadata.bibliography).toEqual(['../pandoc/refs.bib']);
    expect(p.needs?.(src).project).toBe(true);
    expect(
      p
        .render(src, ctx)
        .blocks.map((b) => b.html)
        .join(''),
    ).toContain('header-section-number');
  });
  it('lets the document win', () => {
    const project = { path: '/d/_quarto.yml', text: 'number-sections: true\n' };
    const p = createQuartoPipeline();
    const src = '---\nnumber-sections: false\n---\n\n# One\n';
    const ctx = p.prepare?.(src, inputs({ project }));
    expect(ctx?.metadata['number-sections']).toBe(false);
  });
});

describe('completions and security', () => {
  it('offers labels', () => {
    const { p, ctx } = render(read('crossref.qmd'));
    const keys = p.completions?.(ctx as never).labels?.map((l) => l.key);
    expect(keys).toEqual(expect.arrayContaining(['fig-a', 'fig-b', 'tbl-a', 'eq-a', 'sec-intro']));
  });
  it('executes nothing from a hostile document', () => {
    const w = window as unknown as Record<string, unknown>;
    const xss =
      '<img src=x onerror="window.__XSS_SENTINEL__=1">\n\n::: {.callout-note title="<script>window.__XSS_SENTINEL__=1</script>"}\nx\n:::\n';
    const { html } = render(xss);
    expect(html).not.toMatch(/onerror|<script/i);
    expect(w.__XSS_SENTINEL__).toBeUndefined();
  });
});

describe('plain fenced listings (3.L item 4, C38)', () => {
  const source =
    'Code is in @lst-a and @lst-b.\n\n' +
    '```{#lst-a .python lst-cap="First listing"}\nx = 1\n```\n\n' +
    '```{#lst-b .r lst-cap="Second"}\ny <- 2\n```\n';
  const { dom } = render(source);
  it('numbers them in reading order, with the caption on the card', () => {
    const a = dom.querySelector('#lst-a');
    expect(text(a?.querySelector('.listing-caption'))).toBe('Listing 1: First listing');
    expect(text(dom.querySelector('#lst-b .listing-caption'))).toBe('Listing 2: Second');
    expect(a?.getAttribute('data-lang')).toBe('python');
    expect(text(a?.querySelector('pre code'))).toBe('x = 1');
  });
  it('lets @lst-x reach them', () => {
    const refs = [...dom.querySelectorAll('a.xref')].map(text);
    expect(refs).toEqual(['Listing 1', 'Listing 2']);
  });
});

describe('labels and footnotes inside includes (3.L item 3, C38)', () => {
  // Numbers as Quarto 1.9.38 prints them for tests/fixtures/flavors/quarto/includes-labels.qmd
  // (checked by the fidelity suite): Figure 1, Figure 2 (included), Figure 3, Table 1, Listing 1.
  const { dom } = render(read('includes-labels.qmd'), {
    includes: new Map([
      ['_labels-inc.qmd', { path: '/d/_labels-inc.qmd', text: read('_labels-inc.qmd') }],
    ]),
  });
  it('numbers the included figure, table and listing with the document', () => {
    expect([...dom.querySelectorAll('figcaption')].map(text)).toEqual([
      'Figure 1: First figure',
      'Figure 2: Included figure',
      'Figure 3: Last figure',
    ]);
    expect(text(dom.querySelector('#tbl-inc'))).toContain('Table 1');
    expect(text(dom.querySelector('#lst-inc .listing-caption'))).toBe(
      'Listing 1: Included listing',
    );
    expect([...dom.querySelectorAll('p a.xref')].map(text)).toEqual([
      'Figure 1',
      'Figure 2',
      'Figure 3',
      'Table 1',
      'Listing 1',
    ]);
  });
  it('continues the footnote numbering through the include, in one list', () => {
    expect([...dom.querySelectorAll('sup.footnote-ref a')].map(text)).toEqual([
      '[1]',
      '[2]',
      '[3]',
    ]);
    expect(dom.querySelectorAll('.footnotes').length).toBe(1);
    expect(
      [...dom.querySelectorAll('.footnotes li')].map((li) => text(li).replace(/\s*↩︎$/, '')),
    ).toEqual(['The note before.', 'The note inside.', 'The note after.']);
    const ids = [...dom.querySelectorAll('.footnotes li')].map((li) => li.id);
    expect(ids).toEqual(['fn1', 'fn2', 'fn3']);
  });
});
