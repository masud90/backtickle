/**
 * Quarto shortcodes, `{{< name args >}}`:
 *
 *   pagebreak        hr.pagebreak (alone in its paragraph)
 *   meta key         the metadata value as text
 *   kbd Cmd-S        kbd
 *   include file     the included file rendered in place: div.include[data-src]; up to 3 levels, a
 *                    cycle or a missing file shows a muted card; every block inside carries the
 *                    line of the shortcode
 *   anything else    code.shortcode
 *
 * Nothing is run: an include is only Markdown text that the shell fetched.
 */
import type { MarkdownIt, StateCore, StateInline, Token } from 'markdown-it';
import type { DocContext } from '../../types';
import { createWdEnv, wdEnv } from '../env';
import { escapeHtml } from '../escape';
import { mergeIncludeFootnotes } from './footnotes';
import { MAX_INCLUDE_DEPTH, type QuartoEnv, resolveIncludeKey } from './state';

const OPEN = 0x7b;

function metadataValue(metadata: Record<string, unknown>, path: string): string | null {
  let value: unknown = metadata;
  for (const part of path.split('.')) {
    if (typeof value !== 'object' || value === null || !Object.hasOwn(value, part)) return null;
    value = (value as Record<string, unknown>)[part];
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function shortcodeRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const pos = state.pos;
  if (src.charCodeAt(pos) !== OPEN || !src.startsWith('{{<', pos)) return false;
  const end = src.indexOf('>}}', pos + 3);
  if (end < 0 || end + 3 > state.posMax) return false;
  const body = src.slice(pos + 3, end).trim();
  const match = /^([\w-]+)(?:\s+([\s\S]*))?$/.exec(body);
  if (!match) return false;
  const name = (match[1] as string).toLowerCase();
  const args = (match[2] ?? '').trim();
  // Alone in a paragraph, these are blocks: the core rule below makes them.
  if (name === 'pagebreak' || name === 'include') return false;
  if (!silent) {
    if (name === 'meta') {
      const context = wdEnv(state.env).context;
      const value = context ? metadataValue(context.metadata, args) : null;
      state.push('text', '', 0).content = value ?? `?meta:${args}`;
    } else if (name === 'kbd') {
      state.push('kbd_open', 'kbd', 1);
      state.push('text', '', 0).content = args;
      state.push('kbd_close', 'kbd', -1);
    } else {
      const code = state.push('code_inline', 'code', 0);
      code.attrs = [['class', 'shortcode']];
      code.markup = '{{<';
      code.content = src.slice(pos, end + 3);
    }
  }
  state.pos = end + 3;
  return true;
}

const BLOCK = /^\{\{<\s*(pagebreak|include)(?:\s+([^>]*?))?\s*>\}\}$/;

const innerContexts = new WeakMap<DocContext, DocContext>();

/** The context for an included file: the line-based numbers of the document are not its own. */
function innerContext(context: DocContext | null): DocContext | null {
  if (!context) return null;
  let inner = innerContexts.get(context);
  if (!inner) {
    const labels = new Map(
      [...context.labels].filter(
        ([key]) => !key.startsWith('exline:') && !key.startsWith('secnum:'),
      ),
    );
    inner = { ...context, labels };
    innerContexts.set(context, inner);
  }
  return inner;
}

function cardToken(state: StateCore, open: Token, message: string, href: string): Token {
  const card = new state.Token('include_card', '', 0);
  card.block = true;
  card.map = open.map;
  card.level = open.level;
  card.content = message;
  card.meta = { href };
  return card;
}

function blocksRule(state: StateCore): void {
  const tokens = state.tokens;
  const wd = wdEnv(state.env);
  const quarto = (state.env as QuartoEnv).quarto ?? { depth: 0, stack: [] };
  for (let i = 0; i + 2 < tokens.length; i++) {
    const open = tokens[i] as Token;
    const inline = tokens[i + 1] as Token;
    if (open.type !== 'paragraph_open' || inline.type !== 'inline') continue;
    if ((tokens[i + 2] as Token).type !== 'paragraph_close') continue;
    const match = BLOCK.exec(inline.content.trim());
    if (!match) continue;

    if (match[1] === 'pagebreak') {
      const rule = new state.Token('pagebreak', 'hr', 0);
      rule.block = true;
      rule.map = open.map;
      rule.level = open.level;
      tokens.splice(i, 3, rule);
      continue;
    }

    const href = (match[2] ?? '').trim().replace(/^(["'])(.*)\1$/, '$2');
    const key = resolveIncludeKey(quarto.stack.at(-1) ?? '', href);
    const text = wd.context?.includes.get(key);
    if (href === '' || text === undefined) {
      tokens.splice(i, 3, cardToken(state, open, `Include not found: ${href}`, href));
      continue;
    }
    if (quarto.stack.includes(key)) {
      tokens.splice(i, 3, cardToken(state, open, `Include cycle: ${href}`, href));
      continue;
    }
    if (quarto.depth >= MAX_INCLUDE_DEPTH) {
      tokens.splice(i, 3, cardToken(state, open, `Include nesting limit: ${href}`, href));
      continue;
    }

    // The included file is parsed with its own state, but the same heading ids.
    const innerWd = createWdEnv(() => wd.slugger);
    innerWd.context = innerContext(wd.context);
    // A line offset other than 0: no title block, no example numbers, in the included file.
    innerWd.lineOffset = 1;
    innerWd.lastWindow = false;
    const innerEnv: QuartoEnv = {
      wd: innerWd,
      quarto: { depth: quarto.depth + 1, stack: [...quarto.stack, key] },
    };
    const parsed = state.md.parse(text, innerEnv);
    const map = open.map;
    for (const token of parsed) if (token.map && map) token.map = [map[0], map[1]];
    // Its notes continue the document's numbering and join the document's list.
    const inner = mergeIncludeFootnotes(tokens, i, parsed);

    const line = (map ? map[0] : 0) + wd.lineOffset;
    if (innerWd.headings.length > 0) {
      const added = innerWd.headings.map((heading) => ({ ...heading, line }));
      let at = wd.headings.findIndex((heading) => heading.line > line);
      if (at < 0) at = wd.headings.length;
      wd.headings.splice(at, 0, ...added);
    }

    const wrapper = new state.Token('include_open', 'div', 1);
    wrapper.block = true;
    wrapper.map = map;
    wrapper.level = open.level;
    wrapper.attrs = [
      ['class', 'include'],
      ['data-src', href],
    ];
    const end = new state.Token('include_close', 'div', -1);
    end.block = true;
    end.level = open.level;
    tokens.splice(i, 3, wrapper, ...inner, end);
    i += inner.length + 1;
  }
}

export function installShortcodes(md: MarkdownIt): void {
  md.inline.ruler.before('escape', 'wd_quarto_shortcode', shortcodeRule);
  // The last core rule: the headings of the document have their ids and places by now.
  md.core.ruler.push('wd_quarto_shortcode_blocks', blocksRule);
  md.renderer.rules.pagebreak = () => '<hr class="pagebreak">\n';
  md.renderer.rules.include_card = (tokens, idx) => {
    const token = tokens[idx] as Token;
    const href = String((token.meta as { href?: string } | null)?.href ?? '');
    return `<div class="include include-card" data-src="${escapeHtml(href)}"><span class="include-message">${escapeHtml(token.content)}</span></div>\n`;
  };
}
