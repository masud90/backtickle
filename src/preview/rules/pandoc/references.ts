/**
 * The reference list of a Pandoc document: `div.references#refs`
 * with one `div.reference#ref-<key>` per entry. It replaces the content of a `::: {#refs}` div
 * when the document has one, and is otherwise the last block (placed on the last line of the
 * document). `reference-section-title` adds an `h1` (as Pandoc 3.8.3 does) in front, which is in the outline;
 * `suppress-bibliography` removes the list.
 *
 * It is a core rule that runs after the inline rules and before the rule that numbers the
 * headings, so the title heading is made like any other. The list is made in the last window of
 * a large document (`WdEnv.lastWindow`) or where the `#refs` div is.
 */
import type { StateCore, Token } from 'markdown-it';
import { wdEnv } from '../env';
import { isCitationPlan, renderReferenceEntries } from './citations';

function lastLine(source: string): number {
  const lines = source.split('\n');
  let end = lines.length;
  while (end > 1 && (lines[end - 1] as string).trim() === '') end--;
  return end - 1;
}

function rawBlock(state: StateCore, html: string): Token {
  const token = new state.Token('html_block', '', 0);
  token.content = html;
  token.block = true;
  return token;
}

function titleTokens(state: StateCore, title: string, line: number, level: number): Token[] {
  const tag = `h${level}`;
  const markup = '#'.repeat(level);
  const open = new state.Token('heading_open', tag, 1);
  open.markup = markup;
  open.block = true;
  open.map = [line, line + 1];
  const inline = new state.Token('inline', '', 0);
  inline.content = title;
  inline.map = [line, line + 1];
  inline.level = 1;
  const text = new state.Token('text', '', 0);
  text.content = title;
  inline.children = [text];
  const close = new state.Token('heading_close', tag, -1);
  close.markup = markup;
  close.block = true;
  return [open, inline, close];
}

/**
 * The rule that places the reference list; `titleLevel` is the level of the
 * `reference-section-title` heading: 1 as Pandoc 3.8.3 makes it, 2 as Quarto 1.9.38 does.
 */
export function createReferencesRule(titleLevel: number): (state: StateCore) => void {
  return (state) => placeReferences(state, titleLevel);
}

export const referencesRule = createReferencesRule(1);

function placeReferences(state: StateCore, titleLevel: number): void {
  const wd = wdEnv(state.env);
  const context = wd.context;
  const plan = context?.bibliography;
  if (!context || !isCitationPlan(plan)) return;
  const entries = renderReferenceEntries(plan);
  if (entries === '') return;
  const titleValue = Object.hasOwn(context.metadata, 'reference-section-title')
    ? context.metadata['reference-section-title']
    : undefined;
  const title = typeof titleValue === 'string' ? titleValue.trim() : '';

  const tokens = state.tokens;
  // A `::: {#refs}` div (at the top level) takes the list.
  for (let i = 0; i < tokens.length; i++) {
    const open = tokens[i] as Token;
    if (open.type !== 'fenced_div_open' || open.level !== 0) continue;
    if ((open.meta as { attrs?: { id?: string } } | null)?.attrs?.id !== 'refs') continue;
    let depth = 0;
    let end = i;
    for (; end < tokens.length; end++) {
      depth += (tokens[end] as Token).nesting;
      if (depth === 0) break;
    }
    const line = open.map?.[0] ?? 0;
    open.attrs = [
      ['class', 'references'],
      ['id', 'refs'],
    ];
    const list = rawBlock(state, `${entries}\n`);
    list.level = 1;
    tokens.splice(i + 1, Math.max(end - i - 1, 0), list);
    if (title !== '') tokens.splice(i, 0, ...titleTokens(state, title, line, titleLevel));
    return;
  }

  if (!wd.lastWindow) return;
  const line = lastLine(state.src);
  const list = new state.Token('html_block', '', 0);
  list.content = `<div class="references" id="refs">\n${entries}\n</div>\n`;
  list.block = true;
  list.map = [line, line + 1];
  if (title !== '') tokens.push(...titleTokens(state, title, line, titleLevel));
  tokens.push(list);
}
