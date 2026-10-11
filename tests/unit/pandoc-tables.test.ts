// @vitest-environment jsdom
/**
 * B09 at unit level: the table forms of the Pandoc fixtures give the cells, spans, captions and
 * alignment that Pandoc 3.8.3 produced (tests/fixtures/flavors/pandoc/expected/*.html, made by
 * scripts/gen-pandoc-expected.mjs). Cell text of simple and multiline tables is inline text.
 *
 * Allowed differences from Pandoc: the MultiMarkdown `[caption]` after
 * a table is a caption here and a paragraph in Pandoc; `||` spans columns here.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import MarkdownItConstructor from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { installPandocTables, unsafeSplit } from '@/preview/rules/pandoc/tables';
import { installTables } from '@/preview/rules/tables';

const FOLDER = resolve(__dirname, '../fixtures/flavors/pandoc');
const read = (name: string) => readFileSync(resolve(FOLDER, name), 'utf8');

function createMd() {
  const md = new MarkdownItConstructor({ html: true });
  installPandocTables(md);
  installTables(md);
  return md;
}

interface Cell {
  tag: string;
  text: string;
  colspan: number;
  rowspan: number;
  align: string | null;
}
interface Table {
  caption: string | null;
  rows: Cell[][];
}

function alignOf(element: Element): string | null {
  for (const name of ['left', 'center', 'right']) {
    if (element.classList.contains(`align-${name}`)) return name;
  }
  const style = element.getAttribute('style') ?? '';
  const match = /text-align:\s*(left|center|right)/.exec(style);
  return match ? (match[1] as string) : null;
}

function tablesOf(html: string): Table[] {
  const template = document.createElement('template');
  template.innerHTML = html;
  return [...template.content.querySelectorAll('table')].map((table) => ({
    caption:
      table.querySelector(':scope > caption')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    rows: [...table.querySelectorAll('tr')].map((tr) =>
      [...tr.children].map((cell) => ({
        tag: cell.tagName.toLowerCase(),
        text: (cell.textContent ?? '').replace(/\s+/g, ' ').trim(),
        colspan: Number(cell.getAttribute('colspan') ?? 1),
        rowspan: Number(cell.getAttribute('rowspan') ?? 1),
        align: alignOf(cell),
      })),
    ),
  }));
}

describe('tables.md against Pandoc', () => {
  const ours = tablesOf(createMd().render(read('tables.md')));
  const pandoc = tablesOf(read('expected/tables.html'));

  it('has the same five tables', () => {
    expect(ours).toHaveLength(5);
    expect(pandoc).toHaveLength(5);
  });
  it.each([
    [0, 'pipe table'],
    [1, 'simple table'],
    [2, 'multiline-looking table (a simple table without a top rule)'],
    [3, 'grid table'],
  ])('table %i (%s) matches', (index) => {
    expect(ours[index]).toEqual(pandoc[index]);
  });
  it('reads the MultiMarkdown table and its caption', () => {
    const mmd = ours[4] as Table;
    const reference = pandoc[4] as Table;
    // Pandoc keeps the caption as a paragraph after the table.
    expect(mmd.caption).toBe('MMD table caption');
    expect(mmd.rows).toEqual(reference.rows);
  });
  it('captions of the pipe and simple table', () => {
    expect(ours[0]?.caption).toBe('Caption for pipe table');
    expect(ours[1]?.caption).toBe('Simple table caption');
  });
});

describe('more table forms against Pandoc (expected/tables-extra.html)', () => {
  const ours = tablesOf(createMd().render(read('expected/src/tables-extra.md')));
  const pandoc = tablesOf(read('expected/tables-extra.html'));
  it('has the same tables', () => {
    expect(ours).toHaveLength(pandoc.length);
  });
  it.each([
    'pipe table with a caption before it',
    'simple table with alignments',
    'multiline table',
    'grid table (cell lists are flattened)',
    'grid table with spans',
    'grid table with alignment on the header border',
    'headerless simple table',
    'pipe table after tables',
  ])('table: %s', (name) => {
    const index = [
      'pipe table with a caption before it',
      'simple table with alignments',
      'multiline table',
      'grid table (cell lists are flattened)',
      'grid table with spans',
      'grid table with alignment on the header border',
      'headerless simple table',
      'pipe table after tables',
    ].indexOf(name);
    const expected = pandoc[index] as Table;
    const got = ours[index] as Table;
    // Pandoc turns the apostrophe curly (smart punctuation belongs to the pack).
    expect(got.caption).toBe(expected.caption?.replace(/\u2019/g, "'") ?? null);
    if (index === 3) {
      // Pandoc puts the lists in the cells into list elements; the text is the same words.
      expect(
        got.rows.map((row) => row.map((cell) => cell.text.replace(/[-\s]+/g, ' ').trim())),
      ).toEqual(
        expected.rows.map((row) => row.map((cell) => cell.text.replace(/[-\s]+/g, ' ').trim())),
      );
    } else {
      expect(got.rows).toEqual(expected.rows);
    }
  });
});

describe('MultiMarkdown tables', () => {
  const md = createMd();
  it('spans columns with an empty cell after a cell', () => {
    const [table] = tablesOf(
      md.render('| A | B | C |\n|---|---|---|\n| one || two |\n| x | y | z |\n'),
    );
    expect(table?.rows[1]).toEqual([
      { tag: 'td', text: 'one', colspan: 2, rowspan: 1, align: null },
      { tag: 'td', text: 'two', colspan: 1, rowspan: 1, align: null },
    ]);
    expect(table?.rows[2]).toHaveLength(3);
  });
  it('spans to the end of the row with a trailing ||', () => {
    const [table] = tablesOf(md.render('| A | B | C |\n|---|---|---|\n| one | two ||\n'));
    expect(table?.rows[1]).toEqual([
      { tag: 'td', text: 'one', colspan: 1, rowspan: 1, align: null },
      { tag: 'td', text: 'two', colspan: 2, rowspan: 1, align: null },
    ]);
  });
  it('takes a caption in brackets right after the table', () => {
    const [table] = tablesOf(md.render('| A | B |\n|---|---|\n| 1 | 2 |\n[The caption]\n\nNext.'));
    expect(table?.caption).toBeNull();
    const [spaced] = tablesOf(
      md.render('| A | B |\n|---|---|\n| 1 | 2 |\n\n[The caption]\n\nNext.'),
    );
    expect(spaced?.caption).toBe('The caption');
  });
  it('leaves a bracket paragraph that is not after a table alone', () => {
    expect(md.render('[just text]\n')).toContain('<p>[just text]</p>');
  });
});

describe('grid tables', () => {
  const md = createMd();
  it('renders lists and several paragraphs inside a cell as blocks', () => {
    const html = md.render(
      '+-----+-------------+\n| A   | B           |\n+=====+=============+\n| x   | - one       |\n|     | - two       |\n+-----+-------------+\n',
    );
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>one</li>');
  });
  it('reads row spans and column spans', () => {
    const [table] = tablesOf(
      md.render(
        '+---+---+---+\n| a | b | c |\n+===+===+===+\n| wide  | d |\n+---+---+---+\n| e | tall  |\n+---+ cell  +\n| f |       |\n+---+---+---+\n',
      ),
    );
    expect(table?.rows[1]?.[0]).toMatchObject({ text: 'wide', colspan: 2 });
  });
  it('is not a table when it does not close', () => {
    expect(md.render('+---+---+\n| a | b |\n')).not.toContain('<table');
  });
});

describe('unsafeSplit', () => {
  it('does not allow a cut inside a multiline table or before a caption', () => {
    const lines = [
      'Intro.',
      '',
      '-----  -----',
      'Head   Head2',
      '-----  -----',
      'one',
      '',
      'two    2',
      '-----  -----',
      '',
      'After.',
      '',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      ': Caption',
      '',
      '[MMD caption]',
      '',
      'Last.',
    ];
    const unsafe = lines.map((_line, index) => unsafeSplit(lines, index));
    expect(unsafe.slice(0, 10)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
    expect(unsafe[10]).toBe(false);
    expect(unsafe[16]).toBe(true);
    expect(unsafe[20]).toBe(false);
    const mmd = ['| a |', '|---|', '| 1 |', '', '[Caption]', '', 'Last.'];
    expect(mmd.map((_l, i) => unsafeSplit(mmd, i))[4]).toBe(true);
  });
});
