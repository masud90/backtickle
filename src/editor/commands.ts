/**
 * Formatting commands as pure functions of the editor state.
 *
 * Each one maps an `EditorState` to a transaction spec, or `null` when it has nothing to do, so a
 * command can be tested without a view and run by `EditorController.run`. Every spec is a single
 * undo step, isolated from the typing before and after it (`isolateHistory`).
 *
 * Inline commands (bold, italic, strikethrough, code) work on the selection, on the word at the
 * cursor, or on an empty pair, and toggle off when the markers are already there. Line commands
 * (headings, quote, lists) work on every selected line and keep indentation and blockquote
 * markers. Block commands (code block, table, rule) insert blocks separated from the text around
 * them by blank lines.
 */
import { isolateHistory } from '@codemirror/commands';
import {
  type ChangeSpec,
  EditorSelection,
  type EditorState,
  type Line,
  type SelectionRange,
  type Text,
  type TransactionSpec,
} from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { insideCode, treeUpTo } from './syntax';

export type FormatCommand =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'code'
  | 'link'
  | 'image'
  | 'quote'
  | 'bullet-list'
  | 'numbered-list'
  | 'task-list'
  | 'code-block'
  | 'table'
  | 'rule'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'heading-5'
  | 'heading-6'
  | 'paragraph';

/** What a command returns: a transaction to dispatch, or null when there is nothing to change. */
export type FormatSpec = TransactionSpec | null;

const FORMAT_EVENT = 'input.format';
const TASK_EVENT = 'input.task';

/** Makes the spec one undo step of its own that scrolls the selection into view. */
function formatSpec(spec: TransactionSpec): TransactionSpec {
  return {
    ...spec,
    scrollIntoView: true,
    userEvent: FORMAT_EVENT,
    annotations: isolateHistory.of('full'),
  };
}

// ---- lines ------------------------------------------------------------------------------

const isBlank = (text: string) => /^\s*$/.test(text);
const isSpace = (char: string) => /^\s$/.test(char);

/**
 * The start of a line, in this order: indentation and blockquote markers, then optionally a
 * heading mark (`## `) or a list marker (`- `, `1. `) with a task marker (`[ ] `) after it.
 * Every part is optional, so this matches every line.
 */
const LINE_START =
  /^([ \t]*(?:>[ \t]?)*[ \t]*)(?:(#{1,6})(?:[ \t]+|$)|(?:([-*+])|(\d{1,9})([.)]))(?:[ \t]+|$)(?:\[([ xX])\](?:[ \t]+|$))?)?/;

interface LineParts {
  /** Length of the indentation and blockquote markers. */
  prefixEnd: number;
  /** Length up to the end of the heading or list marker (task marker and spaces included). */
  markEnd: number;
  /** Heading level, 0 when the line is not an ATX heading. */
  heading: number;
  list: 'bullet' | 'ordered' | null;
  task: boolean;
}

function parseLine(text: string): LineParts {
  const match = LINE_START.exec(text);
  if (!match) return { prefixEnd: 0, markEnd: 0, heading: 0, list: null, task: false };
  return {
    prefixEnd: (match[1] ?? '').length,
    markEnd: match[0].length,
    heading: (match[2] ?? '').length,
    list: match[3] ? 'bullet' : match[4] ? 'ordered' : null,
    task: match[6] !== undefined,
  };
}

/**
 * The lines the selection touches. A selection that ends at the very start of a line does not
 * include that line (as when a few lines are selected with Shift+Down).
 */
function selectedLines(state: EditorState): Line[] {
  const doc = state.doc;
  const lines: Line[] = [];
  let lastNumber = 0;
  for (const range of state.selection.ranges) {
    const first = doc.lineAt(range.from);
    let last = doc.lineAt(range.to);
    if (!range.empty && last.number > first.number && range.to === last.from) {
      last = doc.line(last.number - 1);
    }
    for (let number = Math.max(first.number, lastNumber + 1); number <= last.number; number++) {
      lines.push(doc.line(number));
    }
    lastNumber = Math.max(lastNumber, last.number);
  }
  return lines;
}

/** Applies line edits and keeps the selection on the same text (a cursor moves past new markers). */
function lineEdit(state: EditorState, edits: ChangeSpec[]): FormatSpec {
  const changes = state.changes(edits);
  if (changes.empty) return null;
  return formatSpec({ changes, selection: state.selection.map(changes, 1) });
}

/** A replacement of `from` to `to` by `insert`, or null when the text is already that. */
function replacement(
  state: EditorState,
  from: number,
  to: number,
  insert: string,
): ChangeSpec | null {
  return state.sliceDoc(from, to) === insert ? null : { from, to, insert };
}

// ---- headings, quote and lists ------------------------------------------------------------

function setHeading(state: EditorState, level: number): FormatSpec {
  const edits: ChangeSpec[] = [];
  for (const line of selectedLines(state)) {
    const parts = parseLine(line.text);
    if (parts.heading === level) continue;
    const from = line.from + parts.prefixEnd;
    const to = line.from + (parts.heading > 0 ? parts.markEnd : parts.prefixEnd);
    const edit = replacement(state, from, to, level > 0 ? `${'#'.repeat(level)} ` : '');
    if (edit) edits.push(edit);
  }
  return lineEdit(state, edits);
}

/** Sets the heading level of every selected line: 1 to 6. */
export function heading(state: EditorState, level: 1 | 2 | 3 | 4 | 5 | 6): FormatSpec {
  return setHeading(state, level);
}

/** Removes the heading mark from every selected line. */
export function paragraph(state: EditorState): FormatSpec {
  return setHeading(state, 0);
}

/**
 * Quotes every selected line, or removes one level of quoting when all of them are already
 * quoted. Blank lines inside a multi-line selection get a bare `>` so the quote stays one block.
 */
export function quote(state: EditorState): FormatSpec {
  const lines = selectedLines(state);
  const text = lines.filter((line) => !isBlank(line.text));
  const remove = text.length > 0 && text.every((line) => /^[ \t]*>/.test(line.text));
  const edits: ChangeSpec[] = [];
  for (const line of lines) {
    const match = /^([ \t]*)(>[ \t]?)?/.exec(line.text);
    const start = line.from + (match?.[1] ?? '').length;
    const mark = match?.[2];
    if (remove) {
      if (mark) edits.push({ from: start, to: start + mark.length });
    } else if (!mark) {
      edits.push({ from: start, insert: isBlank(line.text) && lines.length > 1 ? '>' : '> ' });
    }
  }
  return lineEdit(state, edits);
}

type ListType = 'bullet' | 'ordered' | 'task';

function listTypeOf(parts: LineParts): ListType | null {
  if (!parts.list) return null;
  return parts.task ? 'task' : parts.list;
}

/**
 * Gives every selected line a list marker of the given type, or removes the markers when all of
 * them already have that type. A line with another list marker is converted. Numbered items are
 * numbered from 1 over the non-blank selected lines.
 */
function toggleList(state: EditorState, type: ListType): FormatSpec {
  const lines = selectedLines(state);
  const text = lines.filter((line) => !isBlank(line.text));
  const targets = (text.length > 0 ? text : lines).map((line) => ({
    line,
    parts: parseLine(line.text),
  }));
  const remove = targets.every(({ parts }) => listTypeOf(parts) === type);
  const edits: ChangeSpec[] = [];
  let number = 1;
  for (const { line, parts } of targets) {
    const from = line.from + parts.prefixEnd;
    const to = parts.list ? line.from + parts.markEnd : from;
    const marker = remove
      ? ''
      : type === 'ordered'
        ? `${number++}. `
        : type === 'task'
          ? '- [ ] '
          : '- ';
    // An item that already has this type keeps its marker (an open or done box, `*` or `+`).
    if (!remove && type !== 'ordered' && listTypeOf(parts) === type) continue;
    const edit = replacement(state, from, to, marker);
    if (edit) edits.push(edit);
  }
  return lineEdit(state, edits);
}

export const bulletList = (state: EditorState): FormatSpec => toggleList(state, 'bullet');
export const numberedList = (state: EditorState): FormatSpec => toggleList(state, 'ordered');
export const taskList = (state: EditorState): FormatSpec => toggleList(state, 'task');

// ---- inline formatting --------------------------------------------------------------------

interface InlineKind {
  marker: string;
  /** Lezer node names of the formatted span. */
  nodes: readonly string[];
  /** Lezer node name of the span's markers. */
  mark: string;
}

const BOLD: InlineKind = { marker: '**', nodes: ['StrongEmphasis'], mark: 'EmphasisMark' };
const ITALIC: InlineKind = { marker: '*', nodes: ['Emphasis'], mark: 'EmphasisMark' };
const STRIKETHROUGH: InlineKind = {
  marker: '~~',
  nodes: ['Strikethrough'],
  mark: 'StrikethroughMark',
};
const CODE: InlineKind = { marker: '`', nodes: ['InlineCode'], mark: 'CodeMark' };

interface Segment {
  from: number;
  to: number;
}

/**
 * The innermost span of this kind that contains the range. A cursor must be strictly inside the
 * span (just after the closing marker does not count); a selection may touch its ends.
 */
function findEnclosing(
  state: EditorState,
  kind: InlineKind,
  from: number,
  to: number,
  strict: boolean,
): SyntaxNode | null {
  const tree = treeUpTo(state, to + 1);
  for (const side of [1, -1] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(from, side); node; node = node.parent) {
      if (!kind.nodes.includes(node.name)) continue;
      const inside = strict ? node.from < from && to < node.to : node.from <= from && to <= node.to;
      if (inside) return node;
    }
  }
  return null;
}

/** How many consecutive `char` characters start at `pos` going in `direction`, up to `limit`. */
function runLength(doc: Text, pos: number, direction: -1 | 1, char: string, limit: number): number {
  let count = 0;
  while (count < limit) {
    const at = direction < 0 ? pos - count - 1 : pos + count;
    if (at < 0 || at >= doc.length || doc.sliceString(at, at + 1) !== char) break;
    count++;
  }
  return count;
}

/**
 * How many marker characters to take off each side of a run of `run` marker characters, 0 when
 * the format is not on. For `*`: one star is italic, two bold, three both, so italic is on for an
 * odd run and bold for two or more.
 */
function markersToRemove(kind: InlineKind, run: number): number {
  if (kind.marker === '*') return run % 2 === 1 ? 1 : 0;
  if (kind.marker === '`') return run;
  return run >= kind.marker.length ? kind.marker.length : 0;
}

/** Markers found as text next to or at the ends of the segment (used when the tree has no span). */
function adjacentMarkers(state: EditorState, kind: InlineKind, segment: Segment): Segment[] | null {
  const doc = state.doc;
  const char = kind.marker.charAt(0);
  const outside = markersToRemove(
    kind,
    Math.min(runLength(doc, segment.from, -1, char, 64), runLength(doc, segment.to, 1, char, 64)),
  );
  if (outside > 0) {
    return [
      { from: segment.from - outside, to: segment.from },
      { from: segment.to, to: segment.to + outside },
    ];
  }
  const length = segment.to - segment.from;
  const inside = markersToRemove(
    kind,
    Math.min(
      runLength(doc, segment.from, 1, char, length),
      runLength(doc, segment.to, -1, char, length),
      Math.floor(length / 2),
    ),
  );
  if (inside > 0) {
    return [
      { from: segment.from, to: segment.from + inside },
      { from: segment.to - inside, to: segment.to },
    ];
  }
  return null;
}

/** The markers to delete to take this format off the segment, or null when it is not on. */
function existingMarkers(state: EditorState, kind: InlineKind, segment: Segment): Segment[] | null {
  const node = findEnclosing(state, kind, segment.from, segment.to, false);
  if (node) {
    const marks = node.getChildren(kind.mark).map((mark) => ({ from: mark.from, to: mark.to }));
    if (marks.length > 0) return marks;
  }
  return adjacentMarkers(state, kind, segment);
}

const WORD = /[\p{L}\p{N}\p{M}_]+(?:['’][\p{L}\p{N}\p{M}_]+)*/gu;

/** The word touching `pos`: letters, digits and marks of any script, with inner apostrophes. */
function wordAt(doc: Text, pos: number): Segment | null {
  const line = doc.lineAt(pos);
  const start = Math.max(line.from, pos - 200);
  const text = doc.sliceString(start, Math.min(line.to, pos + 200));
  const offset = pos - start;
  WORD.lastIndex = 0;
  for (let match = WORD.exec(text); match; match = WORD.exec(text)) {
    if (match.index > offset) break;
    if (offset <= match.index + match[0].length) {
      return { from: start + match.index, to: start + match.index + match[0].length };
    }
  }
  return null;
}

/**
 * The parts of a non-empty selection that get markers: one segment per line, without the
 * line's indentation, quote, list and heading markers and without surrounding spaces. Emphasis
 * cannot span a blank line, and a marker pair around `- a` would swallow the list marker.
 */
function inlineSegments(state: EditorState, range: SelectionRange): Segment[] {
  const doc = state.doc;
  const segments: Segment[] = [];
  const last = doc.lineAt(range.to).number;
  for (let number = doc.lineAt(range.from).number; number <= last; number++) {
    const line = doc.line(number);
    let from = Math.max(range.from, line.from + parseLine(line.text).markEnd);
    let to = Math.min(range.to, line.to);
    while (from < to && isSpace(doc.sliceString(from, from + 1))) from++;
    while (to > from && isSpace(doc.sliceString(to - 1, to))) to--;
    if (from < to) segments.push({ from, to });
  }
  return segments;
}

interface RangeResult {
  changes?: ChangeSpec;
  range: SelectionRange;
}

/**
 * The text that goes before and after a segment. Code spans around text that contains backticks
 * use a longer run of backticks (and a space when the text starts or ends with one), or the
 * span would end early.
 */
function wrapping(
  state: EditorState,
  kind: InlineKind,
  segment: Segment,
): { open: string; close: string } {
  if (kind !== CODE) return { open: kind.marker, close: kind.marker };
  const text = state.sliceDoc(segment.from, segment.to);
  const marker = '`'.repeat(longestRun(text, '`') + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return { open: marker + pad, close: pad + marker };
}

/** A cursor (or a selection of only spaces): take the format off, or put it on the word. */
function inlineAtCursor(state: EditorState, kind: InlineKind, range: SelectionRange): RangeResult {
  const doc = state.doc;
  const pos = range.empty ? range.head : range.to;
  const size = kind.marker.length;

  // Inside a span of this kind: take its markers off.
  const node = findEnclosing(state, kind, pos, pos, true);
  const marks = node?.getChildren(kind.mark) ?? [];
  if (marks.length > 0) {
    const changes = state.changes(marks.map((mark) => ({ from: mark.from, to: mark.to })));
    return { changes, range: EditorSelection.cursor(changes.mapPos(pos, 1)) };
  }

  // Between an empty pair of markers, as an earlier call left it: take the pair away.
  const pair = adjacentMarkers(state, kind, { from: pos, to: pos });
  if (pair) {
    const changes = state.changes(pair);
    return { changes, range: EditorSelection.cursor(changes.mapPos(pos, 1)) };
  }

  // On a word: wrap it, keeping the cursor where it was inside the word.
  const word = wordAt(doc, pos);
  if (word) {
    const markers = existingMarkers(state, kind, word);
    const changes = state.changes(
      markers ?? [
        { from: word.from, insert: kind.marker },
        { from: word.to, insert: kind.marker },
      ],
    );
    return {
      changes,
      range: EditorSelection.cursor(changes.mapPos(pos, !markers && pos === word.to ? -1 : 1)),
    };
  }

  // Nothing to format: an empty pair with the cursor between the markers.
  return {
    changes: state.changes({ from: pos, insert: kind.marker + kind.marker }),
    range: EditorSelection.cursor(pos + size),
  };
}

function inlineRange(state: EditorState, kind: InlineKind, range: SelectionRange): RangeResult {
  if (isBlank(state.sliceDoc(range.from, range.to))) return inlineAtCursor(state, kind, range);
  const segments = inlineSegments(state, range);
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (!first || !last) return { range };

  const existing = segments.map((segment) => existingMarkers(state, kind, segment));
  const edits: ChangeSpec[] = [];
  if (existing.every((markers) => markers !== null)) {
    // Every part has the format: take it off, once for a span that covers several parts.
    const seen = new Set<number>();
    for (const markers of existing) {
      for (const marker of markers ?? []) {
        if (seen.has(marker.from)) continue;
        seen.add(marker.from);
        edits.push(marker);
      }
    }
  } else {
    segments.forEach((segment, index) => {
      if (existing[index]) return;
      const { open, close } = wrapping(state, kind, segment);
      edits.push({ from: segment.from, insert: open }, { from: segment.to, insert: close });
    });
  }

  // The same text stays selected, now inside the markers (or without them).
  const changes = state.changes(edits);
  const from = changes.mapPos(first.from, 1);
  const to = changes.mapPos(last.to, -1);
  const forward = range.anchor <= range.head;
  return {
    changes,
    range: forward ? EditorSelection.range(from, to) : EditorSelection.range(to, from),
  };
}

function toggleInline(state: EditorState, kind: InlineKind): FormatSpec {
  const result = state.changeByRange((range) => inlineRange(state, kind, range));
  return result.changes.empty ? null : formatSpec(result);
}

export const bold = (state: EditorState): FormatSpec => toggleInline(state, BOLD);
export const italic = (state: EditorState): FormatSpec => toggleInline(state, ITALIC);
export const strikethrough = (state: EditorState): FormatSpec => toggleInline(state, STRIKETHROUGH);
export const code = (state: EditorState): FormatSpec => toggleInline(state, CODE);

// ---- links and images ---------------------------------------------------------------------

const ADDRESS = /^(?:[a-z][a-z0-9+.-]*:\/\/|mailto:|www\.)\S+$/i;
const IMAGE_FILE = /^\S+\.(?:png|jpe?g|gif|webp|svg|avif|bmp|ico|tiff?|heic)$/i;

/**
 * `[selection](url)` with `url` selected; a selected address becomes `[](address)` with the
 * cursor between the brackets; with nothing selected, `[]()` with the cursor in the brackets.
 * The image form is the same with a leading `!`.
 */
function linkOrImage(
  state: EditorState,
  open: string,
  placeholder: string,
  isTarget: (text: string) => boolean,
): FormatSpec {
  const result = state.changeByRange((range) => {
    // Spaces at the ends of the selection stay outside the brackets.
    let from = range.from;
    let to = range.to;
    while (from < to && isSpace(state.sliceDoc(from, from + 1))) from++;
    while (to > from && isSpace(state.sliceDoc(to - 1, to))) to--;

    if (from === to) {
      const changes = state.changes({ from, insert: `${open}]()` });
      return { changes, range: EditorSelection.cursor(from + open.length) };
    }
    if (isTarget(state.sliceDoc(from, to))) {
      const changes = state.changes([
        { from, insert: `${open}](` },
        { from: to, insert: ')' },
      ]);
      return { changes, range: EditorSelection.cursor(from + open.length) };
    }
    const changes = state.changes([
      { from, insert: open },
      { from: to, insert: `](${placeholder})` },
    ]);
    const target = to + open.length + 2;
    return { changes, range: EditorSelection.range(target, target + placeholder.length) };
  });
  return formatSpec(result);
}

export const link = (state: EditorState): FormatSpec =>
  linkOrImage(state, '[', 'url', (text) => ADDRESS.test(text));
export const image = (state: EditorState): FormatSpec =>
  linkOrImage(state, '![', 'path', (text) => ADDRESS.test(text) || IMAGE_FILE.test(text));

// ---- blocks -------------------------------------------------------------------------------

/**
 * Inserts a block of lines with a blank line between it and the text around it. The block goes
 * after the line the selection ends on; a blank line right after text is the separator, and a
 * blank line that does not follow text is replaced. The selection afterwards is `select` (offsets
 * into the block) or, for `'after'`, the start of the line below the block.
 */
function insertBlock(state: EditorState, block: string, select: Segment | 'after'): FormatSpec {
  const doc = state.doc;
  const main = state.selection.main;
  let end = main.to;
  if (!main.empty && end > main.from && doc.lineAt(end).from === end) end -= 1;
  const line = doc.lineAt(end);
  const previous = line.number > 1 ? doc.line(line.number - 1) : null;
  const next = line.number < doc.lines ? doc.line(line.number + 1) : null;

  const onBlankLine = isBlank(line.text);
  const replace = onBlankLine && (previous === null || isBlank(previous.text));
  const lead = replace ? '' : onBlankLine ? '\n' : '\n\n';
  // A blank line after the block, or a final line break when the block ends the document.
  const trail = next === null || !isBlank(next.text) ? '\n' : '';
  const from = replace ? line.from : line.to;
  const base = from + lead.length;
  return formatSpec({
    changes: { from, to: line.to, insert: lead + block + trail },
    selection:
      select === 'after'
        ? EditorSelection.cursor(base + block.length + 1)
        : EditorSelection.range(base + select.from, base + select.to),
  });
}

function longestRun(text: string, char: string): number {
  let longest = 0;
  let run = 0;
  for (const current of text) {
    run = current === char ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest;
}

/**
 * Fences the selected lines (the current line when nothing is selected; an empty block on a
 * blank line). The cursor lands after the opening backticks, ready for the language name. The
 * fence is longer than any backtick run inside, so wrapping an existing code block is safe.
 */
export function codeBlock(state: EditorState): FormatSpec {
  const lines = selectedLines(state);
  const first = lines[0];
  const last = lines[lines.length - 1];
  if (!first || !last) return null;
  if (lines.every((line) => isBlank(line.text))) {
    return insertBlock(state, '```\n\n```', { from: 3, to: 3 });
  }
  const fence = '`'.repeat(Math.max(3, longestRun(state.sliceDoc(first.from, last.to), '`') + 1));
  // Inside a blockquote or an indented block the fence keeps the same prefix.
  const prefix = /^[ \t]*(?:>[ \t]?)*/.exec(first.text)?.[0] ?? '';
  const changes = state.changes([
    { from: first.from, insert: `${prefix}${fence}\n` },
    { from: last.to, insert: `\n${prefix}${fence}` },
  ]);
  return formatSpec({
    changes,
    selection: EditorSelection.cursor(first.from + prefix.length + fence.length),
  });
}

const TABLE = [
  '| Header 1 | Header 2 | Header 3 |',
  '| -------- | -------- | -------- |',
  '|          |          |          |',
].join('\n');

/** A pipe table with three columns, a header row and one empty row; the first header is selected. */
export function table(state: EditorState): FormatSpec {
  return insertBlock(state, TABLE, { from: 2, to: 10 });
}

/** A horizontal rule on its own line, with the cursor on the line below it. */
export function rule(state: EditorState): FormatSpec {
  return insertBlock(state, '---', 'after');
}

// ---- tasks --------------------------------------------------------------------------------

/** The task marker of a list item line: marker, then `[ ]`, `[x]` or `[X]`. */
const TASK_LINE = /^([ \t]*(?:>[ \t]?)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)\[([ xX])\](?=[ \t]|$)/;

/**
 * Checks or unchecks the task box on a line (0-based). Works after `-`, `*`, `+`, `1.` and
 * `1)` markers, nested or inside a blockquote, and accepts `[X]`. Returns null for a line
 * without a task, including a line that only looks like one inside a code block. One undo step.
 */
export function toggleTask(state: EditorState, line: number): TransactionSpec | null {
  if (!Number.isInteger(line) || line < 0 || line >= state.doc.lines) return null;
  const target = state.doc.line(line + 1);
  const match = TASK_LINE.exec(target.text);
  if (!match) return null;
  const box = target.from + (match[1] ?? '').length;
  if (insideCode(state, box)) return null;
  return {
    changes: { from: box + 1, to: box + 2, insert: match[2] === ' ' ? 'x' : ' ' },
    userEvent: TASK_EVENT,
    annotations: isolateHistory.of('full'),
  };
}

// ---- the command table --------------------------------------------------------------------

export const formatCommands: Readonly<Record<FormatCommand, (state: EditorState) => FormatSpec>> = {
  bold,
  italic,
  strikethrough,
  code,
  link,
  image,
  quote,
  'bullet-list': bulletList,
  'numbered-list': numberedList,
  'task-list': taskList,
  'code-block': codeBlock,
  table,
  rule,
  'heading-1': (state) => heading(state, 1),
  'heading-2': (state) => heading(state, 2),
  'heading-3': (state) => heading(state, 3),
  'heading-4': (state) => heading(state, 4),
  'heading-5': (state) => heading(state, 5),
  'heading-6': (state) => heading(state, 6),
  paragraph,
};
