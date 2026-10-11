/**
 * Math (GFM): `$...$` and `$$...$$` inside text, `$$` blocks, and ```` ```math ```` fences.
 *
 * The rules only mark the formulas. They become placeholders, `span.math.math-inline[data-tex]`
 * and `div.math.math-display[data-tex]`, and the preview fills them with MathML after
 * sanitizing, with KaTeX loaded on demand.
 *
 * Inline `$` follows the usual rule that keeps prices out of it: the opening `$` is followed by a
 * character that is not whitespace, the closing `$` is preceded by one and is not followed by a
 * digit. So "costs $5 and $10" stays text. GitHub's ``$`x`$`` form is understood too.
 */
import type {
  Env,
  MarkdownIt,
  Renderer,
  StateBlock,
  StateCore,
  StateInline,
  Token,
} from 'markdown-it';
import { previewOptions } from '../options';
import { escapeHtml } from './escape';

const DOLLAR = 0x24;
const BACKSLASH = 0x5c;
const BACKTICK = 0x60;

/** An entry of one of the per-line arrays of the block state (0 if the line does not exist). */
function at(list: readonly number[], index: number): number {
  return list[index] ?? 0;
}

function isWhitespaceCode(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function isDigitCode(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

/** The end index of an inline formula that opens at `start`, or -1. */
function findInlineMath(
  src: string,
  start: number,
  max: number,
): { end: number; open: number } | null {
  const double = src.charCodeAt(start + 1) === DOLLAR;
  const open = double ? 2 : 1;
  const contentStart = start + open;
  if (contentStart >= max) return null;

  if (double) {
    for (let pos = contentStart; pos < max - 1; pos++) {
      const code = src.charCodeAt(pos);
      if (code === BACKSLASH) {
        pos++;
        continue;
      }
      if (code === DOLLAR && src.charCodeAt(pos + 1) === DOLLAR && pos > contentStart) {
        return { end: pos, open };
      }
    }
    return null;
  }

  if (isWhitespaceCode(src.charCodeAt(contentStart))) return null;
  for (let pos = contentStart; pos < max; pos++) {
    const code = src.charCodeAt(pos);
    if (code === BACKSLASH) {
      pos++;
      continue;
    }
    if (code !== DOLLAR) continue;
    const before = src.charCodeAt(pos - 1);
    const after = pos + 1 < max ? src.charCodeAt(pos + 1) : 0;
    if (pos > contentStart && !isWhitespaceCode(before) && !isDigitCode(after)) {
      return { end: pos, open };
    }
  }
  return null;
}

function mathInlineRule(state: StateInline, silent: boolean): boolean {
  if (!previewOptions().math) return false;
  const start = state.pos;
  if (state.src.charCodeAt(start) !== DOLLAR) return false;
  const found = findInlineMath(state.src, start, state.posMax);
  if (!found) return false;

  if (!silent) {
    let content = state.src.slice(start + found.open, found.end);
    // GitHub also accepts $`x`$ : the backticks are not part of the formula.
    if (
      found.open === 1 &&
      content.length > 2 &&
      content.charCodeAt(0) === BACKTICK &&
      content.charCodeAt(content.length - 1) === BACKTICK
    ) {
      content = content.slice(1, -1);
    }
    const token = state.push('math_inline', 'math', 0);
    token.markup = found.open === 2 ? '$$' : '$';
    token.content = content.trim();
  }
  state.pos = found.end + found.open;
  return true;
}

/** `$$` on a line of its own (or around a one-line formula), up to the line that ends with `$$`. */
function mathBlockRule(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  if (!previewOptions().math) return false;
  if (at(state.sCount, startLine) - state.blkIndent >= 4) return false;
  let pos = at(state.bMarks, startLine) + at(state.tShift, startLine);
  const max = at(state.eMarks, startLine);
  if (pos + 2 > max || state.src.slice(pos, pos + 2) !== '$$') return false;
  pos += 2;

  const first = state.src.slice(pos, max);
  let lastLine = startLine;
  let content = '';
  if (first.trim().endsWith('$$') && first.trim().length > 2) {
    // The whole formula is on one line.
    content = first.trim().slice(0, -2);
  } else {
    // First line, then lines up to one that ends with the closing `$$`.
    content = first;
    let found = false;
    for (let line = startLine + 1; line < endLine; line++) {
      const from = at(state.bMarks, line) + at(state.tShift, line);
      const to = at(state.eMarks, line);
      if (from < to && at(state.tShift, line) < state.blkIndent) break;
      const text = state.src.slice(from, to);
      if (text.trim().endsWith('$$')) {
        content += `\n${text.trim().slice(0, -2)}`;
        lastLine = line;
        found = true;
        break;
      }
      content += `\n${text}`;
    }
    if (!found) return false; // an unclosed $$ is not math: it must not swallow the document
  }
  if (silent) return true;

  state.line = lastLine + 1;
  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.markup = '$$';
  token.content = content.trim();
  token.map = [startLine, state.line];
  return true;
}

/** ```` ```math ```` fences are display math. Runs after the block rules. */
export function mathFencesRule(state: StateCore): void {
  if (!previewOptions().math) return;
  for (const token of state.tokens) {
    if (token.type !== 'fence') continue;
    const word = token.info.trim().split(/\s+/)[0];
    if (word?.toLowerCase() !== 'math') continue;
    token.type = 'math_block';
    token.tag = 'math';
    token.content = token.content.trim();
  }
}

function renderMathInline(
  tokens: Token[],
  idx: number,
  _o: unknown,
  _e: Env | undefined,
  _r: Renderer,
): string {
  const tex = escapeHtml(tokens[idx]?.content ?? '');
  return `<span class="math math-inline" data-tex="${tex}">${tex}</span>`;
}

function renderMathBlock(
  tokens: Token[],
  idx: number,
  _o: unknown,
  _e: Env | undefined,
  _r: Renderer,
): string {
  const tex = escapeHtml(tokens[idx]?.content ?? '');
  return `<div class="math math-display" data-tex="${tex}">${tex}</div>\n`;
}

export function installMath(md: MarkdownIt): void {
  md.inline.ruler.before('escape', 'wd_math_inline', mathInlineRule);
  md.block.ruler.before('fence', 'wd_math_block', mathBlockRule, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  md.core.ruler.after('block', 'wd_math_fences', mathFencesRule);
  md.renderer.rules.math_inline = renderMathInline;
  md.renderer.rules.math_block = renderMathBlock;
}
