/**
 * Emoji shortcodes (`:tada:`), GFM only. The shortcode table is the one of `markdown-it-emoji`
 * (maintained, about 1,900 names); the scanning is our own. The plugin builds one regular
 * expression with an alternative for every name and tests every text token against it, which
 * measured at about half of the parse time of a 5 MiB document. Here a text token is only looked
 * at if it has a colon, and the name between two colons is looked up in a table.
 *
 * Text shortcuts such as `:)` are not part of GFM and are not replaced. Text inside autolinks
 * (`<https://...>`) is left alone.
 */

import type { MarkdownIt, Renderer, StateCore, Token } from 'markdown-it';
import emojiDefinitions from 'markdown-it-emoji/lib/data/full.mjs';
import { escapeHtml } from './escape';

const TABLE = new Map<string, string>(Object.entries(emojiDefinitions));
const SHORTCODE = /:([a-z0-9_+-]+):/g;

/** Web addresses in plain text: they become autolinks later, and their colons are not shortcodes. */
const ADDRESS = /(?:https?|ftp):\/\/[^\s<]*|www\.[^\s<]*/gi;

function addressRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  if (!/:\/\/|www\./i.test(text)) return ranges;
  ADDRESS.lastIndex = 0;
  for (let match = ADDRESS.exec(text); match; match = ADDRESS.exec(text)) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

function split(state: StateCore, token: Token): Token[] | null {
  const text = token.content;
  const addresses = addressRanges(text);
  let last = 0;
  let out: Token[] | null = null;
  SHORTCODE.lastIndex = 0;
  for (let match = SHORTCODE.exec(text); match; match = SHORTCODE.exec(text)) {
    const name = match[1] as string;
    const character = TABLE.get(name);
    const inAddress = addresses.some(([from, to]) => match.index >= from && match.index < to);
    if (character === undefined || inAddress) {
      // ":a:b:" may still hold a shortcode that starts at the second colon.
      SHORTCODE.lastIndex = match.index + 1;
      continue;
    }
    out ??= [];
    if (match.index > last) {
      const before = new state.Token('text', '', 0);
      before.content = text.slice(last, match.index);
      out.push(before);
    }
    const emoji = new state.Token('emoji', '', 0);
    emoji.markup = name;
    emoji.content = character;
    out.push(emoji);
    last = match.index + match[0].length;
  }
  if (!out) return null;
  if (last < text.length) {
    const after = new state.Token('text', '', 0);
    after.content = text.slice(last);
    out.push(after);
  }
  return out;
}

function renderEmoji(tokens: Token[], idx: number, _o: unknown, _e: unknown, _r: Renderer): string {
  return escapeHtml(tokens[idx]?.content ?? '');
}

export function installEmoji(md: MarkdownIt): void {
  md.renderer.rules.emoji = renderEmoji;
  // After `linkify` like the plugin, so that escapes (`\:`) are still separate tokens.
  md.core.ruler.after('linkify', 'wd_emoji', (state: StateCore) => {
    for (const block of state.tokens) {
      if (block.type !== 'inline' || !block.children || !block.content.includes(':')) continue;
      let inAutolink = false;
      let changed = false;
      const out: Token[] = [];
      for (const token of block.children) {
        if (token.type === 'link_open' && token.info === 'auto') inAutolink = true;
        else if (token.type === 'link_close') inAutolink = false;
        const pieces =
          token.type === 'text' && !inAutolink && token.content.includes(':')
            ? split(state, token)
            : null;
        if (pieces) {
          out.push(...pieces);
          changed = true;
        } else {
          out.push(token);
        }
      }
      if (changed) block.children = out;
    }
  });
}
