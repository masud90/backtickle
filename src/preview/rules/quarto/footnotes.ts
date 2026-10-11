/**
 * Footnotes of an included file. Quarto includes a file as if
 * its text stood in the document, so its notes continue the document's numbering in reading
 * order and join the document's list. The included file is parsed with its own state (its notes
 * are numbered from 1 in a list of its own); this moves its list into the document's tokens and
 * renumbers: notes of the document that are first referenced after the include move up, the
 * notes of the include move up by the number referenced before it.
 */
import type { Token } from 'markdown-it';

function isNote(token: Token): boolean {
  return (
    token.type === 'footnote_ref' ||
    token.type === 'footnote_open' ||
    token.type === 'footnote_anchor'
  );
}

/** Every token with a note id: the block tokens and the children of inline tokens. */
function noteTokens(tokens: readonly Token[]): Token[] {
  const found: Token[] = [];
  for (const token of tokens) {
    if (isNote(token)) found.push(token);
    if (token.children) for (const child of token.children) if (isNote(child)) found.push(child);
  }
  return found;
}

function shift(tokens: readonly Token[], from: number, by: number): void {
  for (const token of noteTokens(tokens)) {
    const meta = token.meta as { id?: number } | null;
    if (meta && typeof meta.id === 'number' && meta.id >= from) meta.id += by;
  }
}

/**
 * Moves the footnote list out of `inner` (the tokens of an included file) into `outer` (the
 * document's tokens, where the include will stand at index `at`), and renumbers both.
 * Returns the `inner` tokens without their footnote list.
 */
export function mergeIncludeFootnotes(outer: Token[], at: number, inner: Token[]): Token[] {
  const start = inner.findIndex((token) => token.type === 'footnote_block_open');
  if (start < 0) return inner;
  const block = inner.slice(start);
  const rest = inner.slice(0, start);
  const items = block.slice(1, -1);
  const count = items.filter((token) => token.type === 'footnote_open').length;

  // The notes the document has referenced before the include (their ids are 0 to known - 1).
  let known = 0;
  for (const token of noteTokens(outer.slice(0, at))) {
    const meta = token.meta as { id?: number } | null;
    if (token.type === 'footnote_ref' && typeof meta?.id === 'number') {
      known = Math.max(known, meta.id + 1);
    }
  }

  shift(outer, known, count);
  shift(rest, 0, known);
  shift(items, 0, known);

  const open = outer.findIndex((token) => token.type === 'footnote_block_open');
  if (open < 0) {
    outer.push(...block);
    return rest;
  }
  let place = outer.findIndex(
    (token, index) =>
      index > open &&
      token.type === 'footnote_open' &&
      ((token.meta as { id?: number } | null)?.id ?? 0) >= known + count,
  );
  if (place < 0) place = outer.findIndex((token) => token.type === 'footnote_block_close');
  outer.splice(place, 0, ...items);
  return rest;
}
