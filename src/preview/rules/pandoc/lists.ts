/**
 * Lists with Pandoc's markers (`fancy_lists` and `example_lists`): `1.`, `1)`, `(1)`, `a.`, `A)`,
 * `(i)`, `iv.`, `#.` and the example markers `(@)` and `(@label)`, besides the bullets of
 * CommonMark. This is markdown-it's own `list` rule with a wider idea of what a marker is, so
 * nesting, tight and loose lists and lazy continuation behave exactly as in the other packs.
 *
 * A list goes on while the next item has the same kind of marker; another delimiter or another
 * numbering style starts a new list, as in Pandoc. The `ol` gets `type` and `start` for the
 * styles that need them (class `fancy-list`), and `class="example"` for example lists, whose
 * numbers run through the whole document (they come from the context, see `examples.ts`).
 */
import type { MarkdownIt, StateBlock, Token } from 'markdown-it';
import { exampleNumber } from './examples';
import { bMark, bsCount, eMark, sCount, tShift } from './state';

export type ListStyle =
  | 'decimal'
  | 'lower-alpha'
  | 'upper-alpha'
  | 'lower-roman'
  | 'upper-roman'
  | 'default'
  | 'example';

type Delimiter = '.' | ')' | '()';

interface OrderedMarker {
  style: ListStyle;
  delimiter: Delimiter;
  value: number;
  /** The label of an example marker. */
  label: string;
  /** Position after the marker (before the spaces). */
  end: number;
}

const MARKER =
  /(?:\((@[\w-]*|#|\d{1,9}|[A-Za-z]{1,6})\)|(#|\d{1,9}|[A-Za-z]{1,6})([.)]))(?=[ \t]|$)/my;
const ROMAN = /^(?=[ivxlcdm])m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/;
const ROMAN_VALUES: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

function romanValue(text: string): number {
  let total = 0;
  const letters = text.toLowerCase();
  for (let i = 0; i < letters.length; i++) {
    const value = ROMAN_VALUES[letters.charAt(i)] ?? 0;
    const next = ROMAN_VALUES[letters.charAt(i + 1)] ?? 0;
    total += value < next ? -value : value;
  }
  return total;
}

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09;
}

/** What the marker at the start of the line is, or null. `hint` says how to read `c.` or `i.`. */
function scanOrdered(state: StateBlock, line: number, hint?: ListStyle): OrderedMarker | null {
  const pos = bMark(state, line) + tShift(state, line);
  const first = state.src.charCodeAt(pos);
  const plausible =
    (first >= 0x30 && first <= 0x39) ||
    (first >= 0x41 && first <= 0x5a) ||
    (first >= 0x61 && first <= 0x7a) ||
    first === 0x28 ||
    first === 0x23;
  if (!plausible) return null;
  MARKER.lastIndex = pos;
  const match = MARKER.exec(state.src);
  if (!match || match.index !== pos) return null;
  const max = eMark(state, line);
  const end = pos + match[0].length;
  if (end > max) return null;
  const token = match[1] ?? match[2] ?? '';
  const delimiter: Delimiter = match[1] !== undefined ? '()' : ((match[3] as '.' | ')') ?? '.');
  if (token.startsWith('@')) {
    if (delimiter !== '()') return null;
    return { style: 'example', delimiter, value: 0, label: token.slice(1), end };
  }
  if (token === '#') return { style: 'default', delimiter, value: 1, label: '', end };
  if (/^\d+$/.test(token)) {
    return { style: 'decimal', delimiter, value: Number(token), label: '', end };
  }
  const lower = token === token.toLowerCase();
  let style: ListStyle | null = null;
  let value = 0;
  const roman = ROMAN.test(token.toLowerCase());
  const romanFirst = roman && (token.length > 1 || token === 'i' || token === 'I');
  const asRoman = hint === 'lower-roman' || hint === 'upper-roman' ? roman : romanFirst;
  if (asRoman && hint !== 'lower-alpha' && hint !== 'upper-alpha') {
    style = lower ? 'lower-roman' : 'upper-roman';
    value = romanValue(token);
  } else if (token.length === 1) {
    style = lower ? 'lower-alpha' : 'upper-alpha';
    value = token.toLowerCase().charCodeAt(0) - 96;
  }
  if (style === null) return null;
  // "B. Russell": a capital letter and a period need two spaces after them.
  if (delimiter === '.' && style.startsWith('upper') && token.length === 1 && end < max) {
    const after = state.src.charCodeAt(end + 1);
    if (!(state.src.charCodeAt(end) === 0x09 || isSpace(after))) return null;
  }
  return { style, delimiter, value, label: '', end };
}

function scanBullet(state: StateBlock, line: number): number {
  const max = eMark(state, line);
  let pos = bMark(state, line) + tShift(state, line);
  const marker = state.src.charCodeAt(pos++);
  if (marker !== 0x2a && marker !== 0x2d && marker !== 0x2b) return -1;
  if (pos < max && !isSpace(state.src.charCodeAt(pos))) return -1;
  return pos;
}

/** Whether `next` continues a list that started with `first`. */
function sameList(first: OrderedMarker, next: OrderedMarker): boolean {
  if (first.delimiter !== next.delimiter) return false;
  if (first.style === next.style) return true;
  return first.style !== 'example' && next.style === 'default';
}

function markTightParagraphs(state: StateBlock, from: number): void {
  const level = state.level + 2;
  for (let i = from + 2, l = state.tokens.length - 2; i < l; i++) {
    const token = state.tokens[i] as Token;
    if (token.level === level && token.type === 'paragraph_open') {
      (state.tokens[i + 2] as Token).hidden = true;
      token.hidden = true;
      i += 2;
    }
  }
}

const TYPES: Record<ListStyle, string> = {
  decimal: '1',
  'lower-alpha': 'a',
  'upper-alpha': 'A',
  'lower-roman': 'i',
  'upper-roman': 'I',
  default: '',
  example: '1',
};

function list(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  let nextLine = startLine;
  let tight = true;
  if (sCount(state, nextLine) - state.blkIndent >= 4) return false;
  if (
    state.listIndent >= 0 &&
    sCount(state, nextLine) - state.listIndent >= 4 &&
    sCount(state, nextLine) < state.blkIndent
  ) {
    return false;
  }
  let terminatesParagraph = false;
  if (silent && state.parentType === 'paragraph' && sCount(state, nextLine) >= state.blkIndent) {
    terminatesParagraph = true;
  }

  const first = scanOrdered(state, nextLine);
  let posAfterMarker: number;
  const ordered = first !== null;
  if (first) {
    posAfterMarker = first.end;
    // Only `1.` and `1)` may interrupt a paragraph, as in CommonMark.
    if (
      terminatesParagraph &&
      !(first.style === 'decimal' && first.value === 1 && first.delimiter !== '()')
    ) {
      return false;
    }
  } else {
    posAfterMarker = scanBullet(state, nextLine);
    if (posAfterMarker < 0) return false;
  }
  if (terminatesParagraph && state.skipSpaces(posAfterMarker) >= eMark(state, nextLine)) {
    return false;
  }
  if (silent) return true;

  const bulletCode = state.src.charCodeAt(posAfterMarker - 1);
  const markup = first ? first.style : String.fromCharCode(bulletCode);
  const listTokenIndex = state.tokens.length;
  let token: Token;
  if (first) {
    token = state.push('ordered_list_open', 'ol', 1);
    const fancy = first.style !== 'decimal' || first.delimiter !== '.';
    if (fancy) token.attrJoin('class', 'fancy-list');
    if (first.style === 'example') token.attrJoin('class', 'example');
    const type = TYPES[first.style];
    if (fancy && type !== '') {
      token.attrSet('type', type);
      // CSS matches `type` without regard to case: the class tells `a` from `A` for the marker.
      token.attrJoin('class', `wd-list-${first.style}`);
    }
    // The start of an example list is known only from the whole document (see `examples.ts`).
    const start = first.style === 'example' ? exampleNumber(state, nextLine) : first.value;
    if (start !== 1) token.attrSet('start', String(start));
  } else {
    token = state.push('bullet_list_open', 'ul', 1);
  }
  const listLines: [number, number] = [nextLine, 0];
  token.map = listLines;
  token.markup = markup;

  let prevEmptyEnd = false;
  const terminatorRules = state.md.block.ruler.getRules('list');
  const oldParentType = state.parentType;
  state.parentType = 'list';

  while (nextLine < endLine) {
    let pos = posAfterMarker;
    const max = eMark(state, nextLine);
    const initial =
      sCount(state, nextLine) + posAfterMarker - (bMark(state, nextLine) + tShift(state, nextLine));
    let offset = initial;
    while (pos < max) {
      const ch = state.src.charCodeAt(pos);
      if (ch === 0x09) offset += 4 - ((offset + bsCount(state, nextLine)) % 4);
      else if (ch === 0x20) offset++;
      else break;
      pos++;
    }
    const contentStart = pos;
    let indentAfterMarker = contentStart >= max ? 1 : offset - initial;
    if (indentAfterMarker > 4) indentAfterMarker = 1;
    const indent = initial + indentAfterMarker;

    token = state.push('list_item_open', 'li', 1);
    token.markup = markup;
    const itemLines: [number, number] = [nextLine, 0];
    token.map = itemLines;

    const oldTight = state.tight;
    const oldTShift = tShift(state, nextLine) as number;
    const oldSCount = sCount(state, nextLine) as number;
    const oldListIndent = state.listIndent;
    state.listIndent = state.blkIndent;
    state.blkIndent = indent;
    state.tight = true;
    state.tShift[nextLine] = contentStart - bMark(state, nextLine);
    state.sCount[nextLine] = offset;
    if (contentStart >= max && state.isEmpty(nextLine + 1)) {
      // An item that starts with an empty line and has nothing after it.
      state.line = Math.min(state.line + 2, endLine);
    } else {
      state.md.block.tokenize(state, nextLine, endLine);
    }
    if (!state.tight || prevEmptyEnd) tight = false;
    prevEmptyEnd = state.line - nextLine > 1 && state.isEmpty(state.line - 1);
    state.blkIndent = state.listIndent;
    state.listIndent = oldListIndent;
    state.tShift[nextLine] = oldTShift;
    state.sCount[nextLine] = oldSCount;
    state.tight = oldTight;

    token = state.push('list_item_close', 'li', -1);
    token.markup = markup;
    nextLine = state.line;
    itemLines[1] = nextLine;
    if (nextLine >= endLine) break;
    if (sCount(state, nextLine) < state.blkIndent) break;
    if (sCount(state, nextLine) - state.blkIndent >= 4) break;
    let terminate = false;
    for (const rule of terminatorRules) {
      if (rule(state, nextLine, endLine, true)) {
        terminate = true;
        break;
      }
    }
    if (terminate) break;

    if (first) {
      const next = scanOrdered(state, nextLine, first.style);
      if (!next || !sameList(first, next)) break;
      posAfterMarker = next.end;
    } else {
      posAfterMarker = scanBullet(state, nextLine);
      if (posAfterMarker < 0) break;
      if (bulletCode !== state.src.charCodeAt(posAfterMarker - 1)) break;
    }
  }

  token = state.push(
    ordered ? 'ordered_list_close' : 'bullet_list_close',
    ordered ? 'ol' : 'ul',
    -1,
  );
  token.markup = markup;
  listLines[1] = nextLine;
  state.line = nextLine;
  state.parentType = oldParentType;
  if (tight) markTightParagraphs(state, listTokenIndex);
  return true;
}

export function installPandocLists(md: MarkdownIt): void {
  md.block.ruler.at('list', list, { alt: ['paragraph', 'reference', 'blockquote'] });
}
