/**
 * Pandoc tables: pipe tables with captions, simple, multiline and grid
 * tables, and MultiMarkdown tables (column spans with `||`, a caption in `[brackets]`).
 *
 * The structure is the one of Phase 1 tables (`table > thead + tbody > tr > th, td`, alignment as
 * the classes `align-left`, `align-center` and `align-right`) plus `caption` as the first child
 * of the table and `colspan` and `rowspan` on cells.
 *
 * - Pipe tables: markdown-it's own rule. A core rule afterwards adds what Pandoc has on top of
 *   it: the caption (`: text` or `Table: text` in the paragraph after or before the table, or
 *   the MultiMarkdown `[text]` after it) and the MultiMarkdown column spans.
 * - Simple, multiline and grid tables: the block rule `wd_pandoc_table` below, placed before the
 *   pipe table rule. It reads Pandoc's alignment rules for simple and multiline tables (the
 *   position of the header text against the dashes) and the borders of grid tables, including
 *   cells that span columns and rows. The text of a cell is inline content, or Markdown blocks
 *   (lists, several paragraphs) when it has any.
 *
 * Cells of simple and multiline tables are inline text, as in Pandoc.
 */
import type { MarkdownIt, StateBlock, StateCore, Token } from 'markdown-it';

export type Align = 'left' | 'center' | 'right' | null;

export interface CellSpec {
  text: string;
  colspan: number;
  rowspan: number;
  align: Align;
}

export interface RowSpec {
  cells: CellSpec[];
  /** Index (within the lines of the table) of the first line of the row. */
  line: number;
}

export interface TableSpec {
  header: RowSpec[];
  body: RowSpec[];
  /** The number of lines the table takes. */
  length: number;
}

// ---- line helpers --------------------------------------------------------------------------

/** A dash rule of a simple or multiline table: two or more groups of dashes. */
const DASH_RULE = /^-{2,}(?:[ \t]+-{2,})+[ \t]*$/;
const SINGLE_DASHES = /^-{2,}[ \t]*$/;
const GRID_BORDER = /^\+(?::?[-=]+:?\+)+[ \t]*$/;

/** A line that starts some other block: it is not the header line of a simple table. */
const OTHER_BLOCK = /^(?:[-+*][ \t]|\d+[.)][ \t]|>|#{1,6}[ \t]|```|~~~|\||[ ]{4})/;

const isBlank = (line: string | undefined): boolean => line === undefined || line.trim() === '';

function dashRanges(rule: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const match of rule.matchAll(/-+/g)) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

// ---- simple and multiline tables -----------------------------------------------------------

/** Pandoc's rule: where the header text sits against the dashes decides the alignment. */
function alignOf(headerLines: readonly string[], width: number): Align {
  const filled = headerLines.map((line) => line.replace(/\s+$/, '')).filter((line) => line !== '');
  if (filled.length === 0) return null;
  const shortest = filled.reduce((a, b) => (b.length < a.length ? b : a));
  const leftSpace = /^[ \t]/.test(shortest);
  const rightSpace = shortest.length < width;
  if (leftSpace && !rightSpace) return 'right';
  if (!leftSpace && rightSpace) return 'left';
  if (leftSpace && rightSpace) return 'center';
  return null;
}

function cutsOf(rule: string): number[] {
  const ranges = dashRanges(rule);
  return ranges.map((range) => range.end);
}

/** The text of every column in one line, cut at the ends of the dash groups. */
function cellsOf(line: string, cuts: readonly number[]): string[] {
  const cells: string[] = [];
  let from = 0;
  cuts.forEach((cut, index) => {
    const isLast = index === cuts.length - 1;
    cells.push(isLast ? line.slice(from) : line.slice(from, cut));
    from = cut;
  });
  return cells;
}

/** The text of a column that the alignment rule looks at: from the dashes' start to their end. */
function alignTexts(line: string, rule: string): string[] {
  return dashRanges(rule).map((range, index) =>
    line.slice(index === 0 ? 0 : range.start, range.end),
  );
}

function joinCellLines(lines: readonly string[]): string {
  return lines
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * A simple or multiline table that starts at `lines[0]`, or null. Simple: header line, dash
 * rule, one row per line, ended by a blank line. Multiline: a dash rule first, header lines, a
 * rule, rows separated by blank lines, a closing rule. Headerless: a rule, rows, a rule.
 */
export function parseSimpleTable(lines: readonly string[]): TableSpec | null {
  const first = lines[0] ?? '';
  if (DASH_RULE.test(first) || SINGLE_DASHES.test(first)) return parseRuledTable(lines);
  if (isBlank(first) || SINGLE_DASHES.test(first) || OTHER_BLOCK.test(first)) return null;
  const rule = lines[1];
  if (rule === undefined || !DASH_RULE.test(rule)) return null;
  // Rows: every line up to the first blank line, or a rule that closes the table.
  let end = 2;
  while (end < lines.length && !isBlank(lines[end])) {
    if (DASH_RULE.test(lines[end] as string)) {
      end++;
      break;
    }
    end++;
  }
  const rows = lines.slice(2, end).filter((line) => !DASH_RULE.test(line));
  if (rows.length === 0) return null;
  const cuts = cutsOf(rule);
  const ranges = dashRanges(rule);
  const widths = ranges.map((range, index) => range.end - (index === 0 ? 0 : range.start));
  const headerCells = cellsOf(first, cuts);
  const headerTexts = alignTexts(first, rule);
  const aligns = headerTexts.map((text, index) => alignOf([text], widths[index] as number));
  return {
    header: [
      {
        line: 0,
        cells: headerCells.map((text, index) => cell(text.trim(), aligns[index] ?? null)),
      },
    ],
    body: rows.map((row, index) => ({
      line: 2 + index,
      cells: cellsOf(row, cuts).map((text, column) => cell(text.trim(), aligns[column] ?? null)),
    })),
    length: end,
  };
}

function cell(text: string, align: Align): CellSpec {
  return { text, colspan: 1, rowspan: 1, align };
}

function parseRuledTable(lines: readonly string[]): TableSpec | null {
  const top = lines[0] as string;
  // Find the closing rule: a rule followed by a blank line (or the end).
  let closing = -1;
  let blanksInARow = 0;
  const rules: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] as string;
    if (isBlank(line)) {
      blanksInARow++;
      if (blanksInARow >= 2) break;
      continue;
    }
    blanksInARow = 0;
    if (DASH_RULE.test(line) || SINGLE_DASHES.test(line)) {
      if (isBlank(lines[i + 1])) {
        closing = i;
        break;
      }
      rules.push(i);
    }
  }
  if (closing === -1 || rules.length > 1) return null;
  const headRule = rules[0];
  // The top rule of a table with a header is often one unbroken line: the columns come from the
  // rule under the header then.
  const columnRule = DASH_RULE.test(top)
    ? top
    : headRule === undefined
      ? null
      : (lines[headRule] as string);
  if (columnRule === null || !DASH_RULE.test(columnRule)) return null;
  const cuts = cutsOf(columnRule);
  const ranges = dashRanges(columnRule);
  const widths = ranges.map((range, index) => range.end - (index === 0 ? 0 : range.start));
  const bodyStart = headRule === undefined ? 1 : headRule + 1;
  const bodyLines = lines.slice(bodyStart, closing);
  const hasBlank = bodyLines.some(isBlank);

  const rowsOf = (): Array<{ lines: string[]; line: number }> => {
    if (headRule === undefined && !hasBlank) {
      return bodyLines.map((text, index) => ({ lines: [text], line: bodyStart + index }));
    }
    const rows: Array<{ lines: string[]; line: number }> = [];
    let current: { lines: string[]; line: number } | null = null;
    bodyLines.forEach((text, index) => {
      if (isBlank(text)) {
        current = null;
        return;
      }
      if (!current) {
        current = { lines: [], line: bodyStart + index };
        rows.push(current);
      }
      current.lines.push(text);
    });
    return rows;
  };
  const rows = rowsOf();
  if (rows.length === 0) return null;

  let aligns: Align[];
  let header: RowSpec[] = [];
  if (headRule !== undefined) {
    const headerLines = lines.slice(1, headRule);
    const perColumn = headerLines.map((line) => cellsOf(line, cuts));
    const alignColumns = headerLines.map((line) => alignTexts(line, columnRule));
    aligns = widths.map((width, column) =>
      alignOf(
        alignColumns.map((texts) => texts[column] ?? ''),
        width,
      ),
    );
    header = [
      {
        line: 1,
        cells: widths.map((_width, column) =>
          cell(
            joinCellLines(perColumn.map((cellsOfLine) => cellsOfLine[column] ?? '')).replace(
              /\n/g,
              ' ',
            ),
            aligns[column] ?? null,
          ),
        ),
      },
    ];
  } else {
    const firstRow = rows[0] as { lines: string[] };
    const alignColumns = firstRow.lines.map((line) => alignTexts(line, columnRule));
    aligns = widths.map((width, column) =>
      alignOf(
        alignColumns.map((texts) => texts[column] ?? ''),
        width,
      ),
    );
  }
  const body = rows.map((row) => {
    const perColumn = row.lines.map((line) => cellsOf(line, cuts));
    return {
      line: row.line,
      cells: widths.map((_width, column) =>
        cell(
          joinCellLines(perColumn.map((cellsOfLine) => cellsOfLine[column] ?? '')).replace(
            /\n/g,
            ' ',
          ),
          aligns[column] ?? null,
        ),
      ),
    };
  });
  return { header, body, length: closing + 1 };
}

// ---- grid tables ---------------------------------------------------------------------------

function borderAlign(segment: string): Align {
  const left = segment.startsWith(':');
  const right = segment.endsWith(':');
  if (left && right) return 'center';
  if (left) return 'left';
  if (right) return 'right';
  return null;
}

/** A grid table that starts at `lines[0]`, or null. */
export function parseGridTable(lines: readonly string[]): TableSpec | null {
  const top = (lines[0] ?? '').replace(/[ \t]+$/, '');
  if (!GRID_BORDER.test(top)) return null;
  let length = 0;
  while (length < lines.length && /^[+|]/.test(lines[length] as string)) length++;
  // The table ends with a border.
  while (length > 0 && !GRID_BORDER.test((lines[length - 1] as string).replace(/[ \t]+$/, '')))
    length--;
  if (length < 3) return null;
  const rows = lines.slice(0, length).map((line) => line.replace(/[ \t]+$/, ''));

  const xs: number[] = [];
  for (let i = 0; i < top.length; i++) if (top.charAt(i) === '+') xs.push(i);
  const columns = xs.length - 1;
  if (columns < 1) return null;

  const separators: number[] = [];
  rows.forEach((line, index) => {
    // A border starts with `+`; between spanning cells it may hold spaces and text.
    if (line.startsWith('+')) separators.push(index);
  });
  if (separators[0] !== 0 || separators[separators.length - 1] !== length - 1) return null;
  const rowCount = separators.length - 1;
  if (rowCount < 1) return null;

  // The first border with `=` closes the header.
  const headerSeparator = separators.findIndex(
    (index, at) => at > 0 && (rows[index] as string).includes('='),
  );
  const headerRows = headerSeparator === -1 ? 0 : headerSeparator;
  const alignLine = rows[
    headerSeparator === -1 ? 0 : (separators[headerSeparator] as number)
  ] as string;
  const aligns: Align[] = [];
  for (let column = 0; column < columns; column++) {
    const segment = alignLine.slice((xs[column] as number) + 1, xs[column + 1] as number);
    aligns.push(borderAlign(segment));
  }

  const claimed: boolean[][] = Array.from({ length: rowCount }, () =>
    new Array<boolean>(columns).fill(false),
  );
  const result: RowSpec[] = [];
  for (let r = 0; r < rowCount; r++) {
    const cells: CellSpec[] = [];
    const firstContent = (separators[r] as number) + 1;
    for (let c = 0; c < columns; c++) {
      if (claimed[r]?.[c]) continue;
      // Columns: go right until a vertical edge.
      let c2 = c;
      const contentLine = rows[firstContent] ?? '';
      while (c2 < columns - 1) {
        const mark = contentLine.charAt(xs[c2 + 1] as number);
        if (mark === '|' || mark === '+') break;
        c2++;
      }
      const left = xs[c] as number;
      const right = xs[c2 + 1] as number;
      // Rows: go down until a border under the cell.
      let r2 = r;
      while (r2 < rowCount - 1) {
        const border = rows[separators[r2 + 1] as number] as string;
        if (/^[-=:+]+$/.test(border.slice(left + 1, right))) break;
        r2++;
      }
      for (let rr = r; rr <= r2; rr++)
        for (let cc = c; cc <= c2; cc++) (claimed[rr] as boolean[])[cc] = true;
      const textLines: string[] = [];
      for (let line = firstContent; line < (separators[r2 + 1] as number); line++) {
        textLines.push((rows[line] as string).slice(left + 1, right));
      }
      cells.push({
        text: dedent(textLines).trim(),
        colspan: c2 - c + 1,
        rowspan: r2 - r + 1,
        align: aligns[c] ?? null,
      });
    }
    result.push({ cells, line: firstContent });
  }
  return { header: result.slice(0, headerRows), body: result.slice(headerRows), length };
}

function dedent(lines: readonly string[]): string {
  const indents = lines
    .filter((line) => line.trim() !== '')
    .map((line) => /^[ \t]*/.exec(line)?.[0].length ?? 0);
  const strip = indents.length > 0 ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(strip).replace(/[ \t]+$/, '')).join('\n');
}

// ---- the block rule ------------------------------------------------------------------------

/** The text of a line of the block, without the indentation of the container. */
function lineOf(state: StateBlock, index: number): string {
  const start = state.bMarks[index] as number;
  const end = state.eMarks[index] as number;
  let from = start;
  let columns = 0;
  while (from < end && columns < state.blkIndent && state.src.charCodeAt(from) === 0x20) {
    from++;
    columns++;
  }
  return state.src.slice(from, end);
}

/** Cell text that is more than one line of inline text: blocks. */
const BLOCK_CELL =
  /\n\s*\n|^\s*(?:[-*+]|\d+[.)])\s|\n\s*(?:[-*+]|\d+[.)])\s|^\s*>|^\s*#{1,6}\s|^\s*```/;

function pushCell(state: StateBlock, spec: CellSpec, header: boolean, map: [number, number]): void {
  const open = state.push(header ? 'th_open' : 'td_open', header ? 'th' : 'td', 1);
  open.map = map;
  if (spec.align) open.attrJoin('class', `align-${spec.align}`);
  if (spec.colspan > 1) open.attrSet('colspan', String(spec.colspan));
  if (spec.rowspan > 1) open.attrSet('rowspan', String(spec.rowspan));
  if (BLOCK_CELL.test(spec.text)) {
    const from = state.tokens.length;
    state.md.block.parse(spec.text, state.md, state.env, state.tokens);
    for (let i = from; i < state.tokens.length; i++) {
      const token = state.tokens[i] as Token;
      token.level += state.level;
      if (token.map) token.map = map;
    }
  } else {
    const inline = state.push('inline', '', 0);
    inline.content = spec.text;
    inline.map = map;
    inline.children = [];
  }
  state.push(header ? 'th_close' : 'td_close', header ? 'th' : 'td', -1);
}

function pushTable(state: StateBlock, table: TableSpec, startLine: number): void {
  const open = state.push('table_open', 'table', 1);
  open.map = [startLine, startLine + table.length];
  open.markup = 'pandoc';
  const section = (rows: RowSpec[], header: boolean) => {
    if (rows.length === 0) return;
    const tag = header ? 'thead' : 'tbody';
    state.push(`${tag}_open`, tag, 1).map = [startLine, startLine + table.length];
    for (const row of rows) {
      const rowLine = startLine + row.line;
      const tr = state.push('tr_open', 'tr', 1);
      tr.map = [rowLine, rowLine + 1];
      for (const spec of row.cells) pushCell(state, spec, header, [rowLine, rowLine + 1]);
      state.push('tr_close', 'tr', -1);
    }
    state.push(`${tag}_close`, tag, -1);
  };
  section(table.header, true);
  section(table.body, false);
  state.push('table_close', 'table', -1);
}

function pandocTableRule(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  if ((state.sCount[startLine] as number) - state.blkIndent >= 4) return false;
  const first = lineOf(state, startLine);
  const grid = GRID_BORDER.test(first.replace(/[ \t]+$/, ''));
  let ruled = DASH_RULE.test(first);
  if (!ruled && SINGLE_DASHES.test(first)) {
    // An unbroken top rule: a column rule must follow within a few lines (else it is a rule).
    for (let i = startLine + 1; i < Math.min(endLine, startLine + 12); i++) {
      if (DASH_RULE.test(lineOf(state, i))) ruled = true;
    }
  }
  if (!grid && !ruled) {
    // A header line over a dash rule.
    if (startLine + 1 >= endLine) return false;
    const next = (state.bMarks[startLine + 1] as number) + (state.tShift[startLine + 1] as number);
    if (state.src.charCodeAt(next) !== 0x2d || !DASH_RULE.test(lineOf(state, startLine + 1))) {
      return false;
    }
  }
  const lines: string[] = [];
  const limit = Math.min(endLine, startLine + 20000);
  for (let i = startLine; i < limit; i++) lines.push(lineOf(state, i));
  const table = grid ? parseGridTable(lines) : parseSimpleTable(lines);
  if (!table) return false;
  if (silent) return true;
  pushTable(state, table, startLine);
  state.line = startLine + table.length;
  return true;
}

// ---- captions and MultiMarkdown spans ------------------------------------------------------

const CAPTION = /^(?:Table)?:[ \t]+([\s\S]+)$/;
const MMD_CAPTION = /^\[([^\]\n]+)\](?:\[[^\]\n]*\])?$/;

/** The cells of a raw pipe row, as markdown-it splits them (escapes and code spans respected). */
function splitPipeRow(raw: string): string[] {
  let text = raw.trim();
  if (text.startsWith('|')) text = text.slice(1);
  const cells: string[] = [];
  let current = '';
  let tick = 0;
  let escaped = false;
  let backticks = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (char === '`') {
      backticks++;
      current += char;
      continue;
    }
    if (backticks > 0 && char !== '`') {
      tick = tick === 0 ? backticks : tick === backticks ? 0 : tick;
      backticks = 0;
    }
    if (char === '|' && !escaped && tick === 0) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
    escaped = char === '\\' && !escaped;
  }
  cells.push(current);
  if (cells.length > 1 && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

/** Applies MultiMarkdown column spans to the rows of the pipe table that starts at `start`. */
function applySpans(tokens: Token[], start: number, end: number, lines: readonly string[]): void {
  for (let i = start; i < end; i++) {
    const row = tokens[i] as Token;
    if (row.type !== 'tr_open' || !row.map) continue;
    const raw = lines[row.map[0]];
    if (raw === undefined || !raw.includes('||')) continue;
    const segments = splitPipeRow(raw);
    // The cells of this row: tokens up to its tr_close.
    const cells: number[] = [];
    let close = i + 1;
    for (; close < end && tokens[close]?.type !== 'tr_close'; close++) {
      const type = tokens[close]?.type;
      if (type === 'th_open' || type === 'td_open') cells.push(close);
    }
    if (cells.length < segments.length) continue;
    const remove: number[] = [];
    let previous = -1;
    segments.forEach((segment, index) => {
      const at = cells[index] as number;
      if (segment === '' && index > 0 && previous !== -1) {
        const target = tokens[previous] as Token;
        target.attrSet('colspan', String(Number(target.attrGet('colspan') ?? '1') + 1));
        remove.push(at);
      } else {
        previous = at;
      }
    });
    for (const at of remove.sort((a, b) => b - a)) {
      // th_open, inline, th_close
      tokens.splice(at, 3);
      end -= 3;
    }
  }
}

function tableEnd(tokens: readonly Token[], open: number): number {
  const level = (tokens[open] as Token).level;
  let close = open + 1;
  while (close < tokens.length) {
    const token = tokens[close] as Token;
    if (token.type === 'table_close' && token.level === level) return close;
    close++;
  }
  return -1;
}

/** The caption text of a paragraph after a table: `: text`, `Table: text` or `[text]`. */
function captionAfter(content: string): string | null {
  const match = CAPTION.exec(content) ?? MMD_CAPTION.exec(content);
  return match ? (match[1] as string).trim() : null;
}

/** The caption text of a paragraph before a table: `Table: text` or `: text`. */
function captionBefore(content: string): string | null {
  const match = CAPTION.exec(content);
  return match ? (match[1] as string).trim() : null;
}

function captionRule(state: StateCore): void {
  const tokens = state.tokens;
  let lines: string[] | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const table = tokens[i] as Token;
    if (table.type !== 'table_open') continue;
    let close = tableEnd(tokens, i);
    if (close === -1) break;
    if (table.markup !== 'pandoc') {
      lines ??= state.src.split('\n');
      applySpans(tokens, i, close, lines);
      close = tableEnd(tokens, i);
    }

    let text: string | null = null;
    let paragraph = -1;
    const after = paragraphAt(tokens, close + 1, table.level);
    if (after) {
      text = captionAfter(after.content);
      if (text !== null) paragraph = close + 1;
    }
    if (text === null && i >= 3) {
      const before = paragraphAt(tokens, i - 3, table.level);
      if (before) {
        text = captionBefore(before.content);
        if (text !== null) paragraph = i - 3;
      }
    }
    if (text === null) continue;

    const paragraphMap = (tokens[paragraph] as Token).map;
    tokens.splice(paragraph, 3);
    const at = paragraph < i ? i - 3 : i;
    const owner = tokens[at] as Token;
    if (owner.map && paragraphMap) {
      owner.map = [
        Math.min(owner.map[0], paragraphMap[0]),
        Math.max(owner.map[1], paragraphMap[1]),
      ];
    }
    const open = new state.Token('caption_open', 'caption', 1);
    open.level = owner.level + 1;
    open.map = owner.map;
    open.block = true;
    const inline = new state.Token('inline', '', 0);
    inline.content = text;
    inline.children = [];
    inline.level = owner.level + 2;
    inline.map = owner.map;
    inline.block = true;
    const closeToken = new state.Token('caption_close', 'caption', -1);
    closeToken.level = owner.level + 1;
    closeToken.block = true;
    tokens.splice(at + 1, 0, open, inline, closeToken);
    i = at + 3;
  }
}

/** The paragraph (three tokens) that starts at `index` on `level`: its inline token, or null. */
function paragraphAt(tokens: readonly Token[], index: number, level: number): Token | null {
  const open = tokens[index];
  const content = tokens[index + 1];
  const close = tokens[index + 2];
  if (open?.type !== 'paragraph_open' || open.level !== level) return null;
  if (content?.type !== 'inline' || close?.type !== 'paragraph_close') return null;
  return content;
}

export function installPandocTables(md: MarkdownIt): void {
  md.block.ruler.before('table', 'wd_pandoc_table', pandocTableRule, {
    alt: ['paragraph', 'reference'],
  });
  md.core.ruler.after('block', 'wd_pandoc_table_captions', captionRule);
  md.renderer.rules.caption_open = (tokens, index, options, _env, self) =>
    self.renderToken(tokens, index, options);
}

// ---- windows -------------------------------------------------------------------------------

const memo = new WeakMap<readonly string[], Uint8Array>();

/** Marks the lines that must not start a window: inside a multiline table, and captions. */
function unsafeLines(lines: readonly string[]): Uint8Array {
  const cached = memo.get(lines);
  if (cached) return cached;
  const marks = new Uint8Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (/^(?:Table)?:[ \t]/.test(line)) marks[i] = 1;
    if (
      !(DASH_RULE.test(line) || SINGLE_DASHES.test(line)) ||
      !(i === 0 || isBlank(lines[i - 1]))
    ) {
      continue;
    }
    // A rule after a blank line may open a multiline table: find its closing rule.
    let blanks = 0;
    let columns = DASH_RULE.test(line);
    for (let j = i + 1; j < lines.length && j < i + 5000; j++) {
      const next = lines[j] as string;
      if (isBlank(next)) {
        if (++blanks >= 2) break;
        continue;
      }
      blanks = 0;
      const isColumnRule = DASH_RULE.test(next);
      if (isColumnRule) columns = true;
      if ((isColumnRule || SINGLE_DASHES.test(next)) && isBlank(lines[j + 1]) && columns) {
        for (let k = i + 1; k <= j; k++) marks[k] = 1;
        i = j;
        break;
      }
    }
  }
  // A MultiMarkdown caption `[text]` after a table row.
  for (let i = 1; i < lines.length; i++) {
    if (!MMD_CAPTION.test(lines[i] as string)) continue;
    let back = i - 1;
    while (back >= 0 && isBlank(lines[back])) back--;
    if (back >= 0 && (lines[back] as string).includes('|')) marks[i] = 1;
  }
  memo.set(lines, marks);
  return marks;
}

/**
 * For `PipelineOptions.unsafeSplit`: true when a window must not start before `lines[index]`
 * because that would cut a multiline table, or separate a table from its caption.
 */
export function unsafeSplit(lines: readonly string[], index: number): boolean {
  return unsafeLines(lines)[index] === 1;
}
