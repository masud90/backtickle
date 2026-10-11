/**
 * `#tag` pills. Obsidian always has them; GFM and Pandoc have them
 * when the `hashtagPills` setting is on. Kept outside `rules/obsidian/` so no Obsidian code loads
 * for the other flavors.
 *
 * A tag follows the start of the text, a space or an opening mark; it has letters, digits, `_`,
 * `-` and `/`, and at least one character that is not a digit (`#2024` is not a tag).
 */
import type { MarkdownIt, StateInline } from 'markdown-it';
import { previewOptions } from '../options';

const HASH = 0x23;

const TAG_CHAR = /[\p{L}\p{N}_/-]/u;

function isTagBoundary(src: string, pos: number): boolean {
  if (pos === 0) return true;
  const before = src.charAt(pos - 1);
  return /[\s([{"'>*~=]/.test(before);
}

export function tag(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== HASH || !isTagBoundary(src, start)) return false;
  let end = start + 1;
  while (end < state.posMax && TAG_CHAR.test(src.charAt(end))) {
    // A surrogate pair is one character.
    end += src.charCodeAt(end) >= 0xd800 && src.charCodeAt(end) <= 0xdbff ? 2 : 1;
  }
  const name = src.slice(start + 1, end);
  // Not all digits (`#2024`), and not empty.
  if (name === '' || /^\d+$/.test(name)) return false;
  if (!silent) {
    const open = state.push('tag_open', 'span', 1);
    open.attrSet('class', 'tag');
    open.markup = '#';
    state.push('text', '', 0).content = `#${name}`;
    state.push('tag_close', 'span', -1);
  }
  state.pos = end;
  return true;
}

/** `#tag` pills in the flavors that do not have them by themselves (setting, off by default). */
function optionalTag(state: StateInline, silent: boolean): boolean {
  return previewOptions().hashtagPills && tag(state, silent);
}

export function installHashtagPills(md: MarkdownIt): void {
  md.inline.ruler.before('emphasis', 'wd_hashtag', optionalTag);
}
