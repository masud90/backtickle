/**
 * Abbreviations: `*[HTML]: Hyper Text Markup Language` defines one, and every whole-word
 * occurrence in the text becomes `<abbr title="...">`. The definitions come from the whole
 * document (the context, filled by `prepare`), so a definition at the end of the document applies
 * to the text above it; the definition lines themselves show nothing.
 */
import type { MarkdownIt, StateBlock, StateCore, Token } from 'markdown-it';
import { wdEnv } from '../env';
import { bMark, eMark, sCount, tShift } from './state';

export const ABBREVIATIONS_KEY = 'wd:abbreviations';

const DEFINITION = /^\*\[([^\]\n]+)\]:[ \t]*(.*)$/;
const MAX_ABBREVIATIONS = 500;

/** Reads the definitions of the lines of a source (outside code fences). */
export function collectAbbreviations(lines: readonly string[]): Record<string, string> {
  const found: Record<string, string> = Object.create(null) as Record<string, string>;
  let count = 0;
  let fence = '';
  for (const text of lines) {
    if (text.charCodeAt(0) === 0x60 || text.charCodeAt(0) === 0x7e || text.charCodeAt(0) === 0x20) {
      const marks = /^ {0,3}(`{3,}|~{3,})/.exec(text)?.[1];
      if (marks) {
        if (fence === '') fence = marks;
        else if (marks.startsWith(fence.charAt(0)) && marks.length >= fence.length) fence = '';
        continue;
      }
    }
    if (fence !== '' || text.charCodeAt(0) !== 0x2a || text.charCodeAt(1) !== 0x5b) continue;
    const match = DEFINITION.exec(text);
    const term = match?.[1]?.trim();
    if (!term || match?.[2] === undefined || term in found) continue;
    found[term] = match[2].trim();
    if (++count >= MAX_ABBREVIATIONS) break;
  }
  return found;
}

function definitionRule(
  state: StateBlock,
  startLine: number,
  _endLine: number,
  silent: boolean,
): boolean {
  if (sCount(state, startLine) - state.blkIndent >= 4) return false;
  const pos = bMark(state, startLine) + tShift(state, startLine);
  if (state.src.charCodeAt(pos) !== 0x2a || state.src.charCodeAt(pos + 1) !== 0x5b) return false;
  const match = DEFINITION.exec(state.src.slice(pos, eMark(state, startLine)));
  if (!match) return false;
  if (silent) return true;
  state.env.wdAbbreviations ??= Object.create(null);
  const own = state.env.wdAbbreviations as Record<string, string>;
  const term = (match[1] ?? '').trim();
  if (!(term in own)) own[term] = (match[2] ?? '').trim();
  state.line = startLine + 1;
  const token = state.push('abbr_definition', '', 0);
  token.hidden = true;
  token.map = [startLine, state.line];
  return true;
}

const expressions = new Map<string, RegExp>();

function expressionFor(terms: string[]): RegExp {
  const key = terms.join('\u0000');
  let expression = expressions.get(key);
  if (!expression) {
    const alternatives = terms
      .sort((a, b) => b.length - a.length)
      .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    expression = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives})(?![\\p{L}\\p{N}_])`, 'gu');
    if (expressions.size > 16) expressions.clear();
    expressions.set(key, expression);
  }
  return expression;
}

function replaceRule(state: StateCore): void {
  const fromContext = wdEnv(state.env).context?.metadata[ABBREVIATIONS_KEY] as
    | Record<string, string>
    | undefined;
  const own = state.env.wdAbbreviations as Record<string, string> | undefined;
  const definitions = { ...own, ...fromContext };
  const terms = Object.keys(definitions);
  if (terms.length === 0) return;
  const expression = expressionFor(terms);

  for (const block of state.tokens) {
    if (block.type !== 'inline' || !block.children) continue;
    const children: Token[] = [];
    let changed = false;
    for (const token of block.children) {
      if (token.type !== 'text' || token.content.length === 0) {
        children.push(token);
        continue;
      }
      expression.lastIndex = 0;
      let last = 0;
      for (
        let match = expression.exec(token.content);
        match;
        match = expression.exec(token.content)
      ) {
        const term = match[0];
        if (match.index > last) {
          const before = new state.Token('text', '', 0);
          before.content = token.content.slice(last, match.index);
          children.push(before);
        }
        const open = new state.Token('abbr_open', 'abbr', 1);
        open.attrSet('title', definitions[term] ?? '');
        const text = new state.Token('text', '', 0);
        text.content = term;
        children.push(open, text, new state.Token('abbr_close', 'abbr', -1));
        last = match.index + term.length;
        changed = true;
      }
      if (last === 0) {
        children.push(token);
      } else if (last < token.content.length) {
        const rest = new state.Token('text', '', 0);
        rest.content = token.content.slice(last);
        children.push(rest);
      }
    }
    if (changed) block.children = children;
  }
}

export function installAbbreviations(md: MarkdownIt): void {
  md.block.ruler.before('reference', 'wd_abbr_definition', definitionRule, {
    alt: ['paragraph'],
  });
  md.core.ruler.after('text_join', 'wd_pandoc_abbr', replaceRule);
}
