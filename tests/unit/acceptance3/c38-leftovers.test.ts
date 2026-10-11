// @vitest-environment jsdom
/**
 * Phase 3 acceptance C38 (WP3.8a2): one group per leftover item. The inputs
 * are the tester's own (not the builder's); expected values come from Obsidian's documented
 * behavior, Pandoc's own `--citeproc` output (3.8.3, run for this file) and the Quarto numbering
 * rules (reading order, one counter per kind of label).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatEntry } from '@/preview/bibliography/format';
import { titleCase } from '@/preview/bibliography/title-case';
import { safeCss } from '@/preview/mermaid/styles';
import { createMdxPipeline } from '@/preview/packs/mdx';
import { createObsidianPipeline } from '@/preview/packs/obsidian';
import { createQuartoPipeline } from '@/preview/packs/quarto';
import type { ContextInputs } from '@/preview/types';

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

const NONE: ContextInputs = {
  path: null,
  bibliographies: [],
  includes: new Map(),
  vault: null,
  project: null,
};

function dom(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

// ---- item 1: heading completion in Obsidian ------------------------------------------------------

describe('C38 item 1: [[# and [[Note# complete headings', () => {
  async function run(
    doc: string,
    noteHeadings?: (name: string) => Promise<string[]>,
  ): Promise<{ labels: string[]; from: number } | null> {
    const { EditorState } = await import('@codemirror/state');
    const { CompletionContext } = await import('@codemirror/autocomplete');
    const { completionDataField, setCompletionDataEffect } = await import('@/editor/complete');
    const { headingSource } = await import('@/editor/flavors/obsidian');
    let state = EditorState.create({ doc, extensions: [completionDataField] });
    state = state.update({ effects: setCompletionDataEffect({ noteHeadings }) }).state;
    const result = await headingSource(new CompletionContext(state, doc.length, true));
    return result
      ? { labels: result.options.map((option) => option.label), from: result.from }
      : null;
  }

  it('[[# lists the headings of the current note in order, leaving out code', async () => {
    const doc =
      '# Alpha\n\ntext\n\n### Deep one\n\n~~~\n# not a heading\n~~~\n\n## Beta\n\nLink [[#';
    const result = await run(doc);
    expect(result?.labels).toEqual(['Alpha', 'Deep one', 'Beta']);
    expect(result?.from).toBe(doc.length);
  });

  it('[[Folder/Note# asks for that note by the name as typed and replaces only the heading part', async () => {
    const asked: string[] = [];
    const doc = 'Start [[Folder/Some note#Intr';
    const result = await run(doc, async (name) => {
      asked.push(name);
      return ['Introduction', 'Introduce', 'Method'];
    });
    expect(asked).toEqual(['Folder/Some note']);
    expect(result?.from).toBe('Start [[Folder/Some note#'.length);
    // The editor filters by the typed prefix; the source returns what the note has.
    expect(result?.labels).toEqual(expect.arrayContaining(['Introduction', 'Introduce']));
  });
});

// ---- item 2: unclosed %% in Obsidian -------------------------------------------------------------

describe('C38 item 2: an unclosed %% hides to the end of the document', () => {
  const pipeline = createObsidianPipeline();
  const inputs = (): ContextInputs => ({ ...NONE, path: '/v/Doc.md' });
  const prose = (source: string) => {
    const context = pipeline.prepare?.(source, inputs());
    const result = pipeline.render(source, context);
    return {
      root: dom(result.blocks.map((block) => block.html).join('\n')),
      words: pipeline.analyze(source, context).stats.words,
    };
  };

  it('hides every later block and keeps them out of the word count', () => {
    const { root, words } = prose(
      'Visible intro.\n\n%% a note to self\nsecret one\n\n- secret list\n\n## Secret heading\n\n> secret quote\n',
    );
    const shown = text(root);
    expect(shown).toContain('Visible intro.');
    expect(shown).not.toMatch(/secret|note to self/i);
    expect(root.querySelectorAll('h2').length).toBe(0);
    expect(words).toBe(2); // "Visible intro"
  });

  it('a comment that closes hides only its own text', () => {
    const { root, words } = prose('One.\n\n%%\nhidden\n%%\n\nTwo three.\n');
    expect(text(root)).toContain('Two three.');
    expect(text(root)).not.toContain('hidden');
    expect(words).toBe(3);
  });
});

// ---- items 3 and 4: Quarto includes and listings -------------------------------------------------

describe('C38 items 3 and 4: Quarto labels, footnotes and listings', () => {
  function render(source: string, includes: Record<string, string> = {}) {
    const pipeline = createQuartoPipeline();
    const context = pipeline.prepare?.(source, {
      ...NONE,
      path: '/d/main.qmd',
      includes: new Map(
        Object.entries(includes).map(([name, body]) => [name, { path: `/d/${name}`, text: body }]),
      ),
    });
    const result = pipeline.render(source, context);
    return dom(result.blocks.map((block) => block.html).join('\n'));
  }

  const INC =
    '![Inside figure](i.png){#fig-in}\n\n| h |\n|---|\n| v |\n\n: Inside table {#tbl-in}\n\nInside note.[^in]\n\n[^in]: The inside note.\n';

  it('an include placed first numbers its labels first, the document continues after it', () => {
    const dm = render(
      '{{< include _in.qmd >}}\n\n![Outside figure](o.png){#fig-out}\n\n| h |\n|---|\n| v |\n\n: Outside table {#tbl-out}\n\nOutside note.[^out]\n\nRefs: @fig-in, @fig-out, @tbl-in, @tbl-out.\n\n[^out]: The outside note.\n',
      { '_in.qmd': INC },
    );
    expect([...dm.querySelectorAll('figcaption')].map(text)).toEqual([
      'Figure 1: Inside figure',
      'Figure 2: Outside figure',
    ]);
    expect(text(dm.querySelector('#tbl-in'))).toContain('Table 1');
    expect(text(dm.querySelector('#tbl-out'))).toContain('Table 2');
    expect([...dm.querySelectorAll('p a.xref')].map(text)).toEqual([
      'Figure 1',
      'Figure 2',
      'Table 1',
      'Table 2',
    ]);
    // Footnotes number in reading order, in one list.
    expect([...dm.querySelectorAll('sup.footnote-ref a')].map(text)).toEqual(['[1]', '[2]']);
    expect(dm.querySelectorAll('.footnotes').length).toBe(1);
    expect(
      [...dm.querySelectorAll('.footnotes li')].map((li) => text(li).replace(/\s*↩︎$/, '')),
    ).toEqual(['The inside note.', 'The outside note.']);
  });

  it('listings count on their own, after figures and tables, in reading order', () => {
    const dm = render(
      '![F1](a.png){#fig-a}\n\n```{#lst-one .python lst-cap="Alpha code"}\na = 1\n```\n\n```{#lst-two .r lst-cap="Beta code"}\nb <- 2\n```\n\n![F2](b.png){#fig-b}\n\nSee @lst-two then @lst-one and @fig-b.\n',
    );
    expect(text(dm.querySelector('#lst-one .listing-caption'))).toBe('Listing 1: Alpha code');
    expect(text(dm.querySelector('#lst-two .listing-caption'))).toBe('Listing 2: Beta code');
    expect([...dm.querySelectorAll('figcaption')].map(text)).toEqual([
      'Figure 1: F1',
      'Figure 2: F2',
    ]);
    expect([...dm.querySelectorAll('p a.xref')].map(text)).toEqual([
      'Listing 2',
      'Listing 1',
      'Figure 2',
    ]);
  });

  it('a fence with a language but no label is not a listing', () => {
    const dm = render('```{.python lst-cap="Orphan"}\nx = 1\n```\n');
    expect(dm.querySelector('.listing-caption')).toBeNull();
  });
});

// ---- item 5: title case in the reference list -----------------------------------------------------

describe('C38 item 5: titles in the reference list follow Pandoc (3.8.3 citeproc, default style)', () => {
  // Pandoc input -> output, produced by `pandoc --citeproc` for a .bib of these titles.
  const PAIRS: Array<[string, string]> = [
    ['the history of a small town in the north', 'The History of a Small Town in the North'],
    [
      'what is the matter with mother? a study of habits',
      'What Is the Matter with Mother? A Study of Habits',
    ],
    [
      'learning to count: an introduction to data analysis for refugees',
      'Learning to Count: An Introduction to Data Analysis for Refugees',
    ],
    ['on the road to peace and back again', 'On the Road to Peace and Back Again'],
    ['journal of the royal statistical society', 'Journal of the Royal Statistical Society'],
    ['a note on the use of r in surveys', 'A Note on the Use of r in Surveys'],
  ];
  for (const [input, expected] of PAIRS) {
    it(`"${input}"`, () => {
      expect(titleCase(input)).toBe(expected);
    });
  }

  it('the reference entry of a journal article uses title case for the title and the journal', () => {
    const html = formatEntry(
      {
        id: 'e',
        type: 'article-journal',
        author: [{ family: 'Vo', given: 'E' }],
        title: 'a note on the use of r in surveys',
        'container-title': 'journal of the royal statistical society',
      },
      '2005',
    ).text;
    // Pandoc: Vo, E. 2005. “A Note on the Use of r in Surveys.” Journal of the Royal Statistical Society.
    expect(html).toContain('“A Note on the Use of r in Surveys.”');
    expect(html).toContain('Journal of the Royal Statistical Society');
  });

  it('the title-case rule is no longer an allowed difference in the fidelity suite', () => {
    const allowed = readFileSync(resolve(__dirname, '../../fidelity/ALLOWED.md'), 'utf8');
    expect(allowed).not.toMatch(/^- title-case\b/m);
  });
});

// ---- item 6: MDX dollar math ----------------------------------------------------------------------

describe('C38 item 6: MDX dollar math follows the Pandoc rule', () => {
  const pipeline = createMdxPipeline();
  const math = (source: string) => {
    const root = dom(
      pipeline
        .render(source)
        .blocks.map((block) => block.html)
        .join('\n'),
    );
    return {
      tex: [...root.querySelectorAll('span.math-inline')].map((el) => el.getAttribute('data-tex')),
      text: text(root),
    };
  };

  it('$a+b$ is math, also when a period follows the closing dollar', () => {
    expect(math('Sum $a+b$.\n').tex).toEqual(['a+b']);
  });
  it('two formulas in one paragraph are two spans', () => {
    expect(math('Both $x$ and $y$ hold.\n').tex).toEqual(['x', 'y']);
  });
  it('prices are text: "$5 and $10", "costs $5, then $6"', () => {
    for (const source of ['It is $5 and $10.\n', 'It costs $5, then $6 more.\n']) {
      expect(math(source).tex, source).toEqual([]);
    }
    expect(math('It is $5 and $10.\n').text).toContain('$5 and $10');
  });
  it('space after the opening or before the closing dollar is text', () => {
    expect(math('a $ b$ c\n').tex).toEqual([]);
    expect(math('a $b $ c\n').tex).toEqual([]);
  });
  it('a digit directly after the closing dollar is text', () => {
    expect(math('a $b$2 c\n').tex).toEqual([]);
  });
  it('an escaped dollar is a dollar', () => {
    const result = math('Pay \\$x\\$ now.\n');
    expect(result.tex).toEqual([]);
    expect(result.text).toContain('$x$');
  });
});

// ---- item 7: Mermaid @keyframes -------------------------------------------------------------------

describe('C38 item 7: @keyframes in a diagram are kept and scoped to the diagram id', () => {
  it('renames the animation and its uses, keeps percent selectors', () => {
    const css =
      '@keyframes pulse{0%{opacity:0}50%{opacity:.5}100%{opacity:1}}' +
      '#d7 .node{animation:pulse 2s ease-in-out infinite}' +
      '#d7 .edge{animation-name:pulse}';
    const out = safeCss(css, 'd7');
    expect(out).toContain('@keyframes wd-d7-pulse{0%{opacity:0}50%{opacity:.5}100%{opacity:1}}');
    expect(out).toContain('#d7 .node{animation:wd-d7-pulse 2s ease-in-out infinite}');
    expect(out).toContain('#d7 .edge{animation-name:wd-d7-pulse}');
    expect(out).not.toMatch(/@keyframes pulse\b/);
  });

  it('two diagrams do not share an animation name', () => {
    const css = '@keyframes spin{to{opacity:1}}#a .n{animation:spin 1s}';
    const one = safeCss(css, 'a');
    const two = safeCss(css.replaceAll('#a', '#b'), 'b');
    expect(one).toContain('wd-a-spin');
    expect(two).toContain('wd-b-spin');
    expect(one).not.toContain('wd-b-spin');
  });

  it('still drops a keyframe with an external URL and the other at-rules', () => {
    const out = safeCss(
      '@keyframes bad{from{background:url(https://evil.test/x)}}@media print{#d7 a{b:c}}@import "x";#d7 .k{fill:red}',
      'd7',
    );
    expect(out).toContain('#d7 .k{fill:red}');
    expect(out).not.toMatch(/evil\.test|@media|@import/);
  });
});
