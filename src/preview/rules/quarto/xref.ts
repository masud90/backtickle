/**
 * Cross-references: the references themselves (`@fig-x`, `@Fig-x`,
 * `[-@fig-x]`, `[@fig-a; @fig-b]`, bookdown `\@ref(fig:x)`), and the numbers they point at, which
 * `render` reads from the context (`labels.ts` finds them in `prepare`): figure captions,
 * table captions, equation numbers and section numbers.
 *
 * A reference is a link `a.xref[href="#id"]` with its text as ordinary link text, so it counts as
 * prose; a missing target is `span.xref.xref-missing` with `?@fig-x`.
 */
import type { MarkdownIt, StateBlock, StateCore, StateInline, Token } from 'markdown-it';
import { previewOptions } from '../../options';
import { wdEnv } from '../env';
import { escapeHtml } from '../escape';
import { parseAttributes } from '../pandoc/attributes';
import { bMark, eMark, sCount, tShift } from '../pandoc/state';
import { captionLabel, idOfKey, kindOfPrefix, optionsOf, referenceText } from './labels';
import type { QuartoEnv } from './state';

const AT = 0x40;
const BRACKET = 0x5b;
const BACKSLASH = 0x5c;

const KEY = /([A-Za-z]{2,4})-([\w:.-]*\w)/y;
const ITEM = /^\s*(-)?@([A-Za-z]{2,4})-([\w:.-]*\w)\s*$/;
const BOOKDOWN_REF = /^\\@ref\(([\w:.-]+)\)/;

interface Reference {
  key: string;
  written: string;
  suppress: boolean;
  capital: boolean;
}

function readKeyAt(src: string, at: number, max: number): { ref: Reference; end: number } | null {
  KEY.lastIndex = at;
  const match = KEY.exec(src);
  if (!match || match.index !== at || at + match[0].length > max) return null;
  const prefix = match[1] as string;
  if (!kindOfPrefix(prefix)) return null;
  return {
    ref: {
      key: `${prefix.toLowerCase()}-${match[2]}`,
      written: `${prefix}-${match[2]}`,
      suppress: false,
      capital: prefix.charAt(0) !== prefix.charAt(0).toLowerCase(),
    },
    end: at + match[0].length,
  };
}

/** Pushes the tokens of a reference: a link with the text, or the marked missing target. */
function pushReference(state: StateInline, ref: Reference, bookdown: boolean): void {
  const context = wdEnv(state.env).context;
  const label = context?.labels.get(ref.key);
  // An unnumbered section (`.unnumbered`) is not a target Quarto can number: it is missing there too.
  if (label && !(label.kind === 'sec' && label.number === '' && !bookdown)) {
    const text = referenceText(label, optionsOf(context), {
      suppress: ref.suppress || bookdown,
      capital: ref.capital,
    });
    const open = state.push('link_open', 'a', 1);
    open.attrs = [
      ['href', `#${idOfKey(ref.key)}`],
      ['class', 'xref'],
    ];
    const content = state.push('text', '', 0);
    content.content = text;
    state.push('link_close', 'a', -1);
    return;
  }
  const open = state.push('span_open', 'span', 1);
  open.attrs = [['class', 'xref xref-missing']];
  const content = state.push('text', '', 0);
  content.content = bookdown ? '??' : `?@${ref.written}`;
  state.push('span_close', 'span', -1);
}

function xrefRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const pos = state.pos;
  const code = src.charCodeAt(pos);

  if (code === BACKSLASH) {
    if (src.charCodeAt(pos + 1) !== AT) return false;
    const match = BOOKDOWN_REF.exec(src.slice(pos, Math.min(state.posMax, pos + 200)));
    if (!match) return false;
    if (!silent) {
      pushReference(
        state,
        { key: match[1] as string, written: match[1] as string, suppress: true, capital: false },
        true,
      );
    }
    state.pos = pos + match[0].length;
    return true;
  }

  if (code === AT) {
    const before = pos > 0 ? src.charAt(pos - 1) : '';
    if (before !== '' && /[\w@]/.test(before)) return false;
    const found = readKeyAt(src, pos + 1, state.posMax);
    if (!found) return false;
    if (!silent) pushReference(state, found.ref, false);
    state.pos = found.end;
    return true;
  }

  if (code === BRACKET) {
    const close = src.indexOf(']', pos);
    if (close < 0 || close >= state.posMax) return false;
    const inner = src.slice(pos + 1, close);
    if (!inner.includes('@') || inner.includes('[')) return false;
    const next = src.charAt(close + 1);
    if (next === '(' || next === '[' || next === '{') return false;
    const refs: Reference[] = [];
    for (const part of inner.split(';')) {
      const item = ITEM.exec(part);
      if (!item || !kindOfPrefix(item[2] as string)) return false;
      const prefix = item[2] as string;
      refs.push({
        key: `${prefix.toLowerCase()}-${item[3]}`,
        written: `${prefix}-${item[3]}`,
        suppress: item[1] === '-',
        capital: prefix.charAt(0) !== prefix.charAt(0).toLowerCase(),
      });
    }
    if (!silent) {
      refs.forEach((ref, index) => {
        if (index > 0) state.push('text', '', 0).content = ', ';
        pushReference(state, ref, false);
      });
    }
    state.pos = close + 1;
    return true;
  }
  return false;
}

// ---- equations -----------------------------------------------------------------------------

const EQUATION_TAIL = /\$\$[ \t]*\{#(eq[-:][^\s{}]+)[^}]*\}[ \t]*$/;
const BOOKDOWN_EQUATION = /\(\\#(eq:[^)\s]+)\)/;

/** `$$ ... $$ {#eq-x}`: a display equation with an id (the plain `$$` rule does not take it). */
function equationRule(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  if (!previewOptions().math) return false;
  if (sCount(state, startLine) - state.blkIndent >= 4) return false;
  const start = bMark(state, startLine) + tShift(state, startLine);
  if (state.src.slice(start, start + 2) !== '$$') return false;
  const first = state.src.slice(start + 2, eMark(state, startLine));

  let content = '';
  let key = '';
  let lastLine = startLine;
  const one = EQUATION_TAIL.exec(first);
  if (one && one.index > 0) {
    content = first.slice(0, one.index);
    key = one[1] as string;
  } else {
    if (first.trim().endsWith('$$')) return false;
    content = first;
    for (let line = startLine + 1; line < endLine; line++) {
      const from = bMark(state, line) + tShift(state, line);
      const to = eMark(state, line);
      if (from < to && tShift(state, line) < state.blkIndent) return false;
      const text = state.src.slice(from, to);
      if (text.trim().endsWith('$$')) return false;
      const tail = EQUATION_TAIL.exec(text);
      if (tail) {
        content += `\n${text.slice(0, tail.index)}`;
        key = tail[1] as string;
        lastLine = line;
        break;
      }
      content += `\n${text}`;
    }
    if (key === '') return false;
  }
  if (silent) return true;
  state.line = lastLine + 1;
  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.markup = '$$';
  token.content = content.replace(BOOKDOWN_EQUATION, '').trim();
  token.map = [startLine, state.line];
  token.meta = { eq: key };
  return true;
}

/** Bookdown puts the label inside the equation: `(\#eq:x)`. */
function bookdownEquationsRule(state: StateCore): void {
  for (const token of state.tokens) {
    if (token.type !== 'math_block' || token.meta?.eq) continue;
    const match = BOOKDOWN_EQUATION.exec(token.content);
    if (!match) continue;
    token.meta = { eq: match[1] };
    token.content = token.content.replace(BOOKDOWN_EQUATION, '').trim();
  }
}

// ---- tables --------------------------------------------------------------------------------

const TRAILING = /[ \t]*\{((?:[^{}"\\\n]|"(?:[^"\\\n]|\\.)*"|\\.)*)\}[ \t]*$/u;
const BOOKDOWN_TABLE = /^\(\\#(tab:[^)\s]+)\)[ \t]*/;

/** Before the inline rules: the id at the end of a table caption (or bookdown's in front). */
function tableIdsRule(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 1; i + 1 < tokens.length; i++) {
    const caption = tokens[i] as Token;
    const inline = tokens[i + 1] as Token;
    const table = tokens[i - 1] as Token;
    if (
      caption.type !== 'caption_open' ||
      inline.type !== 'inline' ||
      table.type !== 'table_open'
    ) {
      continue;
    }
    let key = '';
    const bookdown = BOOKDOWN_TABLE.exec(inline.content);
    if (bookdown) {
      key = bookdown[1] as string;
      inline.content = inline.content.slice(bookdown[0].length);
    } else {
      const trailing = TRAILING.exec(inline.content);
      const attrs = trailing ? parseAttributes(trailing[1] ?? '') : null;
      if (trailing && trailing.index > 0 && attrs?.id.startsWith('tbl-')) {
        key = attrs.id;
        inline.content = inline.content.slice(0, trailing.index);
      }
    }
    if (key === '') continue;
    table.attrSet('id', idOfKey(key));
    caption.meta = { xref: key };
  }
}

// ---- numbers: captions and headings ---------------------------------------------------------

/** Puts "Figure 1:" in front of the children of a caption. */
function prefixCaption(state: StateCore, inline: Token, key: string): void {
  const context = wdEnv(state.env).context;
  const label = context?.labels.get(key);
  if (!label) return;
  const children = inline.children ?? [];
  const empty = children.every((child) => child.type === 'text' && child.content.trim() === '');
  const open = new state.Token('span_open', 'span', 1);
  open.attrSet('class', 'caption-label');
  const text = new state.Token('text', '', 0);
  // The space is inside the span: a text token next to the caption's own text would be merged
  // into it (`text_join`), and that token is shared with the image's alt text.
  text.content = captionLabel(label, optionsOf(context), empty) + (empty ? '' : ' ');
  const close = new state.Token('span_close', 'span', -1);
  const added = [open, text, close];
  inline.children = [...added, ...children];
}

function captionsRule(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as Token;
    if (token.type === 'caption_open') {
      const key = (token.meta as { xref?: string } | null)?.xref;
      const inline = tokens[i + 1];
      if (key && inline?.type === 'inline') prefixCaption(state, inline, key);
    } else if (token.type === 'figure_open') {
      let key = (token.meta as { xref?: string } | null)?.xref;
      if (!key) {
        // A figure of an image with an id: the id moves from the image to the figure.
        const image = tokens[i + 1]?.children?.[0];
        const found = image?.type === 'image' ? image.attrGet('id') : null;
        const id = found === null || found === undefined ? '' : String(found);
        if (!image || !id.startsWith('fig-')) continue;
        key = id;
        token.attrSet('id', idOfKey(id));
        image.attrs = (image.attrs ?? []).filter(([name]) => name !== 'id');
      }
      const target: string = key;
      for (let j = i + 1; j < tokens.length && j < i + 12; j++) {
        const next = tokens[j] as Token;
        if (next.type === 'figure_close') break;
        if (next.type === 'figcaption_open' && tokens[j + 1]?.type === 'inline') {
          prefixCaption(state, tokens[j + 1] as Token, target);
          break;
        }
      }
    }
  }
}

/** The number in front of a heading when `number-sections` is on. */
function sectionNumbersRule(state: StateCore): void {
  const wd = wdEnv(state.env);
  const context = wd.context;
  if (!context || (state.env as QuartoEnv).quarto?.depth) return;
  if (optionsOf(context).numberSections !== true) return;
  const tokens = state.tokens;
  for (let i = 0; i + 1 < tokens.length; i++) {
    const open = tokens[i] as Token;
    const inline = tokens[i + 1] as Token;
    if (open.type !== 'heading_open' || inline.type !== 'inline' || !open.map) continue;
    const label = context.labels.get(`secnum:${open.map[0] + wd.lineOffset}`);
    if (!label) continue;
    const number = new state.Token('section_number', '', 0);
    number.content = label.number;
    inline.children = [number, ...(inline.children ?? [])];
  }
}

export function installXref(md: MarkdownIt): void {
  // Before the citations (and the escapes) read the same characters.
  md.inline.ruler.before('escape', 'wd_quarto_xref', xrefRule);
  md.block.ruler.before('wd_math_block', 'wd_quarto_equation', equationRule, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  md.core.ruler.after('block', 'wd_quarto_bookdown_equations', bookdownEquationsRule);
  md.core.ruler.after('wd_pandoc_table_captions', 'wd_quarto_table_ids', tableIdsRule);
  md.core.ruler.after('wd_quarto_inline_chunks', 'wd_quarto_captions', captionsRule);
  md.core.ruler.after('wd_quarto_captions', 'wd_quarto_section_numbers', sectionNumbersRule);

  const mathBlock = md.renderer.rules.math_block;
  md.renderer.rules.math_block = (tokens, idx, options, env, self) => {
    const inner = mathBlock ? mathBlock(tokens, idx, options, env, self) : '';
    const key = (tokens[idx]?.meta as { eq?: string } | null)?.eq;
    if (!key) return inner;
    const context = wdEnv(env).context;
    const label = context?.labels.get(key);
    const number = label ? `(${label.number})` : '(?)';
    return `<div class="equation" id="${escapeHtml(idOfKey(key))}">${inner.trimEnd()}<span class="eq-number">${number}</span></div>\n`;
  };
  md.renderer.rules.section_number = (tokens, idx) =>
    `<span class="header-section-number">${escapeHtml(tokens[idx]?.content ?? '')}</span> `;
}
