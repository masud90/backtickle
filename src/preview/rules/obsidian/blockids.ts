/**
 * Block ids: a paragraph that ends with ` ^id` (letters, digits and
 * hyphens) gives that id to its block, and the marker is hidden. A list item gets it when the
 * paragraph is the text of the item. A paragraph that is only `^id` gives it to the block before
 * it (a table, a quote, a list). The element id is `^id` with the caret, so that it can never
 * collide with a heading id: `[[Note#^id]]` links to `#%5Eid`.
 */
import type { MarkdownIt, StateCore, Token } from 'markdown-it';

const TRAILING_ID = /(?:^|[ \t\n])\^([A-Za-z0-9-]+)[ \t]*$/;
const ONLY_ID = /^\^([A-Za-z0-9-]+)[ \t]*$/;

/** Index of the opening token that matches the closing token at `closeIndex`, or -1. */
function openerOf(tokens: readonly Token[], closeIndex: number): number {
  const close = tokens[closeIndex];
  if (!close) return -1;
  if (close.nesting === 0) return closeIndex;
  for (let i = closeIndex - 1; i >= 0; i--) {
    const token = tokens[i];
    if (token?.nesting === 1 && token.level === close.level) return i;
  }
  return -1;
}

function blockIdsRule(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 0; i + 2 < tokens.length; i++) {
    const open = tokens[i];
    const inline = tokens[i + 1];
    const close = tokens[i + 2];
    if (open?.type !== 'paragraph_open' || inline?.type !== 'inline') continue;
    if (close?.type !== 'paragraph_close') continue;

    const only = ONLY_ID.exec(inline.content);
    if (only?.[1]) {
      // The block before this paragraph, at the same level.
      const before = tokens[i - 1];
      if (!before || before.level !== open.level) continue;
      const target = tokens[openerOf(tokens, i - 1)];
      if (!target || target.type === 'paragraph_open') continue;
      target.attrSet('id', `^${only[1]}`);
      tokens.splice(i, 3);
      i--;
      continue;
    }

    const match = TRAILING_ID.exec(inline.content);
    if (!match?.[1]) continue;
    const id = `^${match[1]}`;
    inline.content = inline.content.slice(0, match.index).replace(/[ \t]+$/, '');
    // The text of a list item (the previous token opens the item): the item has the id.
    const parent = tokens[i - 1];
    if (parent?.type === 'list_item_open' && parent.level === open.level - 1) {
      parent.attrSet('id', id);
    } else {
      open.attrSet('id', id);
    }
  }
}

export function installBlockIds(md: MarkdownIt): void {
  md.core.ruler.after('block', 'wd_block_ids', blockIdsRule);
}
