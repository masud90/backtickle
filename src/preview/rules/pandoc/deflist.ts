/**
 * Definition lists: a term on a line of its own, then one or more definitions that start with
 * `:` or `~` (with an optional blank line before the first one):
 *
 *   dl > dt + dd + dd + dt + dd ...
 *
 * The body of a definition is Markdown (paragraphs, lists, code), indented under the marker like
 * the text of a list item. As in Pandoc, the definitions of a term are tight (no `p` around a
 * single paragraph) unless a blank line separates the term from its first definition.
 */
import type { MarkdownIt, StateBlock, Token } from 'markdown-it';
import { bMark, bsCount, eMark, sCount, tShift } from './state';

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09;
}

/** The position after the marker (before its spaces), or -1 when the line is not a definition. */
function markerEnd(state: StateBlock, line: number): number {
  if (line >= state.lineMax) return -1;
  if (sCount(state, line) - state.blkIndent >= 4) return -1;
  const max = eMark(state, line);
  let pos = bMark(state, line) + tShift(state, line);
  const marker = state.src.charCodeAt(pos);
  if (marker !== 0x3a && marker !== 0x7e) return -1;
  pos++;
  if (pos >= max || !isSpace(state.src.charCodeAt(pos))) return -1;
  // Something must follow the marker on the line.
  return state.skipSpaces(pos) < max ? pos : -1;
}

/** The block states that are inside a definition right now (a paragraph reports 'paragraph'). */
const inDefinition = new WeakSet<StateBlock>();

function hideTightParagraphs(state: StateBlock, from: number, level: number): void {
  for (let i = from; i < state.tokens.length - 2; i++) {
    const token = state.tokens[i] as Token;
    if (token.level === level && token.type === 'paragraph_open') {
      (state.tokens[i + 2] as Token).hidden = true;
      token.hidden = true;
      i += 2;
    }
  }
}

/** One definition, from its marker line. Returns the line after it. */
function definition(state: StateBlock, line: number, endLine: number, loose: boolean): number {
  const posAfterMarker = markerEnd(state, line);
  const max = eMark(state, line);
  const initial = sCount(state, line) + posAfterMarker - (bMark(state, line) + tShift(state, line));
  let offset = initial;
  let pos = posAfterMarker;
  while (pos < max) {
    const ch = state.src.charCodeAt(pos);
    if (ch === 0x09) offset += 4 - ((offset + bsCount(state, line)) % 4);
    else if (ch === 0x20) offset++;
    else break;
    pos++;
  }
  let afterMarker = offset - initial;
  if (afterMarker > 4) afterMarker = 1;
  const indent = initial + afterMarker;

  const open = state.push('dd_open', 'dd', 1);
  const openIndex = state.tokens.length;
  const oldTight = state.tight;
  const oldTShift = tShift(state, line) as number;
  const oldSCount = sCount(state, line) as number;
  const wasInside = inDefinition.has(state);
  const oldIndent = state.blkIndent;
  inDefinition.add(state);
  state.blkIndent = indent;
  state.tight = true;
  state.tShift[line] = pos - bMark(state, line);
  state.sCount[line] = offset;
  state.md.block.tokenize(state, line, endLine);
  const tight = state.tight && !loose;
  state.blkIndent = oldIndent;
  if (!wasInside) inDefinition.delete(state);
  state.tShift[line] = oldTShift;
  state.sCount[line] = oldSCount;
  state.tight = oldTight;
  state.push('dd_close', 'dd', -1);
  open.map = [line, state.line];
  if (tight) hideTightParagraphs(state, openIndex, open.level + 1);
  return state.line;
}

function deflist(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (sCount(state, startLine) - state.blkIndent >= 4) return false;
  if (state.isEmpty(startLine) || markerEnd(state, startLine) >= 0) return false;
  let next = startLine + 1;
  if (next < endLine && state.isEmpty(next)) next++;
  if (next >= endLine || markerEnd(state, next) < 0) return false;
  if (sCount(state, next) < state.blkIndent) return false;
  if (silent) return true;

  const list = state.push('dl_open', 'dl', 1);
  const listLines: [number, number] = [startLine, 0];
  list.map = listLines;
  let line = startLine;
  for (;;) {
    // The term.
    const term = state.getLines(line, line + 1, state.blkIndent, false).trim();
    const loose = line + 1 < endLine && state.isEmpty(line + 1);
    state.push('dt_open', 'dt', 1).map = [line, line + 1];
    const inline = state.push('inline', '', 0);
    inline.content = term;
    inline.map = [line, line + 1];
    inline.children = [];
    state.push('dt_close', 'dt', -1);
    line = loose ? line + 2 : line + 1;
    // Its definitions.
    while (
      line < endLine &&
      markerEnd(state, line) >= 0 &&
      sCount(state, line) >= state.blkIndent
    ) {
      line = definition(state, line, endLine, loose);
    }
    // Another term with definitions goes in the same list.
    if (line >= endLine || sCount(state, line) < state.blkIndent) break;
    if (sCount(state, line) - state.blkIndent >= 4 || state.isEmpty(line)) break;
    let probe = line + 1;
    if (probe < endLine && state.isEmpty(probe)) probe++;
    if (probe >= endLine || markerEnd(state, probe) < 0) break;
  }
  state.push('dl_close', 'dl', -1);
  state.line = line;
  listLines[1] = line;
  return true;
}

/**
 * Inside a definition, a line that starts with a marker ends the paragraph before it (the next
 * definition), instead of continuing it lazily.
 */
function definitionStart(
  state: StateBlock,
  startLine: number,
  _endLine: number,
  silent: boolean,
): boolean {
  if (!silent || !inDefinition.has(state)) return false;
  return sCount(state, startLine) < state.blkIndent && markerEnd(state, startLine) >= 0;
}

export function installDefinitionLists(md: MarkdownIt): void {
  md.block.ruler.before('paragraph', 'wd_deflist', deflist);
  md.block.ruler.before('paragraph', 'wd_deflist_marker', definitionStart, { alt: ['paragraph'] });
}
