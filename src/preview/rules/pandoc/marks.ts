/**
 * Pandoc's inline marks: strikeout `~~text~~` (`del`), subscript `~text~` (`sub`) and superscript
 * `^text^` (`sup`). The text of a subscript or superscript may not contain spaces unless they are
 * escaped with a backslash (`H~2\ O~`), which keeps `~5 and ~6` and `2^10 and 3^` plain text.
 * The text of a strikeout may hold other inline markup; it may not start or end with a space.
 */
import type { MarkdownIt, StateInline } from 'markdown-it';

const TILDE = 0x7e;
const CARET = 0x5e;
const BACKSLASH = 0x5c;

function isWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0xa0 || Number.isNaN(code);
}

/** Position of the closing marker of a strikeout, or -1. */
function findStrikeoutEnd(src: string, from: number, max: number): number {
  let at = from;
  for (;;) {
    at = src.indexOf('~~', at);
    if (at < 0 || at + 2 > max) return -1;
    const before = src.charCodeAt(at - 1);
    if (at > from && !isWhitespace(before) && before !== BACKSLASH) return at;
    at += 1;
  }
}

/** Position of the closing marker of a sub- or superscript, or -1 (a space ends the search). */
function findScriptEnd(src: string, from: number, max: number, marker: number): number {
  for (let i = from; i < max; i++) {
    const code = src.charCodeAt(i);
    if (code === BACKSLASH) {
      i++;
    } else if (code === marker) {
      return i > from ? i : -1;
    } else if (isWhitespace(code)) {
      return -1;
    }
  }
  return -1;
}

function marks(state: StateInline, silent: boolean): boolean {
  const start = state.pos;
  const src = state.src;
  const code = src.charCodeAt(start);
  if (code !== TILDE && code !== CARET) return false;
  const max = state.posMax;

  if (code === TILDE && src.charCodeAt(start + 1) === TILDE) {
    if (src.charCodeAt(start + 2) === TILDE || start + 2 >= max) return false;
    if (isWhitespace(src.charCodeAt(start + 2))) return false;
    const end = findStrikeoutEnd(src, start + 2, max);
    if (end < 0) return false;
    if (!silent) {
      const open = state.push('del_open', 'del', 1);
      open.markup = '~~';
      state.pos = start + 2;
      state.posMax = end;
      state.md.inline.tokenize(state);
      state.posMax = max;
      const close = state.push('del_close', 'del', -1);
      close.markup = '~~';
    }
    state.pos = end + 2;
    return true;
  }

  const end = findScriptEnd(src, start + 1, max, code);
  if (end < 0) return false;
  if (!silent) {
    const tag = code === TILDE ? 'sub' : 'sup';
    state.push(`${tag}_open`, tag, 1).markup = String.fromCharCode(code);
    const text = state.push('text', '', 0);
    // An escaped space is a non-breaking space; any other escaped character stands for itself.
    text.content = src
      .slice(start + 1, end)
      .replace(/\\(.)/gsu, (_all, char: string) => (char === ' ' ? ' ' : char));
    state.push(`${tag}_close`, tag, -1).markup = String.fromCharCode(code);
  }
  state.pos = end + 1;
  return true;
}

export function installMarks(md: MarkdownIt): void {
  md.inline.ruler.push('wd_pandoc_marks', marks);
}
