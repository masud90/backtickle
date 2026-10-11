/**
 * Fenced divs and bracketed spans:
 *
 *   ::: {#id .class key=value}     div.fenced-div (classes and id of the document, namespaced)
 *   Markdown
 *   :::
 *
 *   [text]{.class}                 span with the classes and id of the document
 *
 * As in Pandoc, a line of colons with attributes (or a bare class name) opens a div and a line
 * of three or more colons alone closes the innermost one; the number of colons does not have to
 * match. A div that is never closed is not a div. Quarto's callouts, tabsets and columns are
 * fenced divs that its pack reads from the same tokens (`fenced_div_open`, `meta.attrs`).
 */
import type { MarkdownIt, StateBlock, StateInline } from 'markdown-it';
import { type Attributes, applyAttributes, BRACED, parseAttributes } from './attributes';
import { bMark, eMark, sCount, tShift } from './state';

const OPENER = /^:{3,}[ \t]*(.*?)[ \t]*:*[ \t]*$/;
const CLOSER = /^:{3,}[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const MAX_SCAN = 100_000;

/** The attributes an opening line gives, or null when it does not open a div. */
export function parseOpener(text: string): Attributes | null {
  if (!text.startsWith(':::')) return null;
  const match = OPENER.exec(text);
  const rest = match?.[1];
  if (rest === undefined || rest === '') return null;
  if (rest.startsWith('{')) {
    const braced = BRACED.exec(rest);
    if (!braced || braced[0].length !== rest.length) return null;
    const attrs = parseAttributes(braced[1] ?? '');
    return attrs && attrs.raw === '' ? attrs : null;
  }
  // `::: name`: a single class.
  if (/^[^\s{}]+$/u.test(rest)) {
    return { id: '', classes: [rest], pairs: [], raw: '' };
  }
  return null;
}

function lineText(state: StateBlock, line: number): string {
  return state.src.slice(bMark(state, line) + tShift(state, line), eMark(state, line));
}

function fencedDiv(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  if (sCount(state, startLine) - state.blkIndent >= 4) return false;
  const first = state.src.charCodeAt(bMark(state, startLine) + tShift(state, startLine));
  if (first !== 0x3a) return false;
  const attrs = parseOpener(lineText(state, startLine));
  if (!attrs) return false;

  // The closing line: depth counting, skipping the colon lines inside code fences.
  let depth = 1;
  let closing = -1;
  let fence = '';
  const last = Math.min(endLine, startLine + MAX_SCAN);
  for (let line = startLine + 1; line < last; line++) {
    if (sCount(state, line) < state.blkIndent && !state.isEmpty(line)) break;
    const text = lineText(state, line);
    const marks = FENCE.exec(text)?.[1];
    if (marks) {
      if (fence === '') fence = marks;
      else if (marks.startsWith(fence.charAt(0)) && marks.length >= fence.length) fence = '';
      continue;
    }
    if (fence !== '' || text.charCodeAt(0) !== 0x3a) continue;
    if (CLOSER.test(text)) {
      if (--depth === 0) {
        closing = line;
        break;
      }
    } else if (parseOpener(text)) {
      depth++;
    }
  }
  if (closing < 0) return false;
  if (silent) return true;

  const open = state.push('fenced_div_open', 'div', 1);
  open.block = true;
  open.map = [startLine, closing + 1];
  open.markup = ':::';
  open.meta = { attrs };
  open.attrSet('class', 'fenced-div');
  applyAttributes(open, attrs);

  const oldParent = state.parentType;
  const oldLineMax = state.lineMax;
  state.parentType = 'fenced_div';
  state.lineMax = closing;
  state.md.block.tokenize(state, startLine + 1, closing);
  state.parentType = oldParent;
  state.lineMax = oldLineMax;

  const close = state.push('fenced_div_close', 'div', -1);
  close.block = true;
  close.markup = ':::';
  state.line = closing + 1;
  return true;
}

/** `[text]{.class}`. */
function span(state: StateInline, silent: boolean): boolean {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== 0x5b) return false;
  const labelEnd = state.md.helpers.parseLinkLabel(state, start, true);
  if (labelEnd < 0 || state.src.charCodeAt(labelEnd + 1) !== 0x7b) return false;
  const braced = BRACED.exec(state.src.slice(labelEnd + 1, state.posMax));
  if (!braced) return false;
  const attrs = parseAttributes(braced[1] ?? '');
  if (attrs?.raw !== '') return false;
  if (!silent) {
    const open = state.push('span_open', 'span', 1);
    open.meta = { attrs };
    applyAttributes(open, attrs);
    const oldMax = state.posMax;
    state.pos = start + 1;
    state.posMax = labelEnd;
    state.md.inline.tokenize(state);
    state.posMax = oldMax;
    state.push('span_close', 'span', -1);
  }
  state.pos = labelEnd + 1 + braced[0].length;
  return true;
}

export function installDivs(md: MarkdownIt): void {
  md.block.ruler.before('fence', 'wd_fenced_div', fencedDiv, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  md.inline.ruler.push('wd_span', span);
}
