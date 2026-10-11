/**
 * Line blocks: lines that start with `| ` keep their line breaks and their leading spaces, and a
 * line that starts with a space continues the line before it.
 *
 *   div.line-block with the lines joined by `br`
 *
 * Every line is an `inline` token of its own, so its text is prose and the lines are separated by
 * a space in the counts.
 */
import type { MarkdownIt, StateBlock } from 'markdown-it';
import { bMark, eMark, sCount, tShift } from './state';

/** `|---|---|`, the second line of a pipe table: this is not a line block then. */
const TABLE_DELIMITER = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

function lineText(state: StateBlock, line: number): string {
  return state.src.slice(bMark(state, line) + tShift(state, line), eMark(state, line));
}

function startsItem(text: string): boolean {
  return text === '|' || text.startsWith('| ') || text.startsWith('|\t');
}

function lineBlock(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  if (sCount(state, startLine) - state.blkIndent >= 4) return false;
  if (!startsItem(lineText(state, startLine))) return false;
  if (startLine + 1 < endLine) {
    const next = lineText(state, startLine + 1);
    if (next.includes('|') && TABLE_DELIMITER.test(next)) return false;
  }
  if (silent) return true;

  const items: Array<{ text: string; line: number }> = [];
  let line = startLine;
  for (; line < endLine; line++) {
    if (state.isEmpty(line) || sCount(state, line) < state.blkIndent) break;
    const text = lineText(state, line);
    if (startsItem(text)) {
      // The text after "| ": leading spaces are kept (as non-breaking spaces).
      const content = text.slice(2).replace(/^ +/u, (spaces) => ' '.repeat(spaces.length));
      items.push({ text: content, line });
    } else if (items.length > 0 && sCount(state, line) > state.blkIndent) {
      const last = items[items.length - 1];
      if (last) last.text = `${last.text} ${text.trim()}`;
    } else {
      break;
    }
  }

  const open = state.push('line_block_open', 'div', 1);
  open.attrSet('class', 'line-block');
  open.map = [startLine, line];
  items.forEach((item, index) => {
    if (index > 0) state.push('line_break', 'br', 0);
    const inline = state.push('inline', '', 0);
    inline.content = item.text.replace(/\s+$/u, '');
    inline.map = [item.line, item.line + 1];
    inline.children = [];
  });
  state.push('line_block_close', 'div', -1);
  state.line = line;
  return true;
}

export function installLineBlocks(md: MarkdownIt): void {
  md.block.ruler.before('fence', 'wd_line_block', lineBlock);
}
