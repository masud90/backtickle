/**
 * Obsidian's inline marks and comments:
 *
 * - `==highlight==` gives `mark`;
 * - `%%comment%%` is removed, inline (it may go over the line ends of a paragraph) and as a block
 *   (a line that starts with `%%` and a later line that has the closing `%%`, blank lines
 *   between them included);
 * - `#tag` and `#nested/tag` give `span.tag` pills. A tag follows the start of the text, a space or
 *   an opening mark; it has letters, digits, `_`, `-` and `/`, and at least one character that is
 *   not a digit (`#2024` is not a tag). Code and link addresses never reach the inline rules,
 *   and a heading is a block rule of its own, so none of them can be tags.
 *
 * The text of a highlight and of a tag is prose; a comment is not.
 */
import type { MarkdownIt, StateBlock, StateInline } from 'markdown-it';
import { previewOptions } from '../../options';
import { escapeHtml } from '../escape';
import { tag } from '../hashtags';

const EQUALS = 0x3d;
const PERCENT = 0x25;

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || Number.isNaN(code);
}

function highlight(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== EQUALS || src.charCodeAt(start + 1) !== EQUALS) return false;
  const max = state.posMax;
  // `===` is not a mark, and the text may not start with a space.
  if (src.charCodeAt(start + 2) === EQUALS || isSpace(src.charCodeAt(start + 2))) return false;
  let end = start + 2;
  for (;;) {
    end = src.indexOf('==', end + 1);
    if (end < 0 || end + 2 > max) return false;
    if (!isSpace(src.charCodeAt(end - 1)) && src.charCodeAt(end + 2) !== EQUALS) break;
  }
  if (!silent) {
    state.push('mark_open', 'mark', 1).markup = '==';
    const oldMax = state.posMax;
    state.pos = start + 2;
    state.posMax = end;
    state.md.inline.tokenize(state);
    state.posMax = oldMax;
    state.push('mark_close', 'mark', -1).markup = '==';
  }
  state.pos = end + 2;
  return true;
}

function inlineComment(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== PERCENT || src.charCodeAt(start + 1) !== PERCENT) return false;
  const end = src.indexOf('%%', start + 2);
  if (end < 0 || end + 2 > state.posMax) return false;
  if (!silent && previewOptions().obsidianCommentsDimmed) {
    // Shown dimmed (setting). The token type is not prose, so the words stay out of the counts.
    state.push('obsidian_comment', 'span', 0).content = src.slice(start + 2, end);
  }
  state.pos = end + 2;
  return true;
}

function lineText(state: StateBlock, line: number): string {
  const from = (state.bMarks[line] ?? 0) + (state.tShift[line] ?? 0);
  return state.src.slice(from, state.eMarks[line] ?? from);
}

/** Ends a block comment: hidden, or (setting) one dimmed block that is not prose. */
function finishBlockComment(
  state: StateBlock,
  startLine: number,
  nextLine: number,
  text: string,
): void {
  if (previewOptions().obsidianCommentsDimmed) {
    const token = state.push('obsidian_comment_block', 'div', 0);
    token.content = text.trim();
    token.map = [startLine, nextLine];
    token.block = true;
  }
  state.line = nextLine;
}

function blockComment(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  if ((state.sCount[startLine] ?? 0) - state.blkIndent >= 4) return false;
  const first = lineText(state, startLine);
  if (!first.startsWith('%%')) return false;
  const closeOnFirst = first.indexOf('%%', 2);
  if (closeOnFirst >= 0) {
    // The whole line is a comment, or it has text after it and the inline rule deals with it.
    if (first.slice(closeOnFirst + 2).trim() !== '') return false;
    if (!silent) finishBlockComment(state, startLine, startLine + 1, first.slice(2, closeOnFirst));
    return true;
  }
  for (let line = startLine + 1; line < endLine; line++) {
    const text = lineText(state, line);
    const close = text.indexOf('%%');
    if (close < 0) continue;
    // Text after the closing marks is shown by the paragraph rule: leave the comment alone.
    if (text.slice(close + 2).trim() !== '') return false;
    if (!silent) {
      const inner = [first.slice(2)];
      for (let at = startLine + 1; at < line; at++) inner.push(lineText(state, at));
      inner.push(text.slice(0, close));
      finishBlockComment(state, startLine, line + 1, inner.join('\n'));
    }
    return true;
  }
  // Never closed: Obsidian hides everything to the end of the document.
  if (!silent) {
    const inner = [first.slice(2)];
    for (let at = startLine + 1; at < endLine; at++) inner.push(lineText(state, at));
    finishBlockComment(state, startLine, endLine, inner.join('\n'));
  }
  return true;
}

export function installObsidianMarks(md: MarkdownIt): void {
  md.renderer.rules.obsidian_comment = (tokens, idx) =>
    `<span class="wd-comment">${escapeHtml(tokens[idx]?.content ?? '')}</span>`;
  md.renderer.rules.obsidian_comment_block = (tokens, idx) =>
    `<div class="wd-comment">${escapeHtml(tokens[idx]?.content ?? '')}</div>\n`;
  md.block.ruler.before('paragraph', 'wd_obsidian_comment', blockComment);
  md.inline.ruler.before('emphasis', 'wd_highlight', highlight);
  md.inline.ruler.before('emphasis', 'wd_obsidian_comment_inline', inlineComment);
  md.inline.ruler.before('emphasis', 'wd_obsidian_tag', tag);
}
