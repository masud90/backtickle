/**
 * The find model of the preview: the text of every block, and the
 * matches of a query in it. It works on the HTML a block was made from (also the blocks of a
 * large document that are not drawn) or on the elements of the page, with one rule for what
 * counts as text, so that a match found in the model is found again in the page.
 */

/** Elements whose text is not prose: controls added to the page, scripts, styles. */
const SKIPPED = '.code-copy, script, style, template';
/** Text in different elements of these kinds is never one run (a match cannot span them). */
const BREAKS =
  'p, li, td, th, tr, h1, h2, h3, h4, h5, h6, pre, blockquote, div, dd, dt, figcaption, summary';

/** More matches than this are not collected (the count shows the limit). */
export const MAX_MATCHES = 100000;

export interface TextPiece {
  node: Text;
  /** Where the text of this node starts in the block's text. */
  start: number;
}

export interface BlockText {
  text: string;
  pieces: TextPiece[];
}

function skipped(node: Node, root: Node): boolean {
  for (let el = node.parentElement; el && el !== root; el = el.parentElement) {
    if (el.matches(SKIPPED)) return true;
  }
  return false;
}

/** The text of a block: its text nodes in order, a newline between different paragraphs, cells... */
export function textOf(root: Node): BlockText {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const pieces: TextPiece[] = [];
  let text = '';
  let lastBreak: Element | null | undefined;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const data = node.nodeValue ?? '';
    if (data === '' || skipped(node, root)) continue;
    const parent = node.parentElement;
    const owner = parent?.closest(BREAKS) ?? null;
    if (lastBreak !== undefined && owner !== lastBreak) text += '\n';
    lastBreak = owner;
    pieces.push({ node: node as Text, start: text.length });
    text += data;
  }
  return { text, pieces };
}

/** The text of a block from the HTML it is made from. */
export function textOfHtml(html: string, doc: Document): string {
  const template = doc.createElement('template');
  template.innerHTML = html;
  return textOf(template.content).text;
}

export interface FindMatch {
  /** Index of the block in the document. */
  block: number;
  /** Offsets in the block's text (UTF-16 units). */
  start: number;
  end: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The offsets of the matches of `query` in `text`; empty for an empty query. */
export function matchesIn(
  text: string,
  query: string,
  matchCase: boolean,
  limit = MAX_MATCHES,
): [number, number][] {
  if (query === '' || text === '') return [];
  const expression = new RegExp(escapeRegExp(query), matchCase ? 'gu' : 'giu');
  const found: [number, number][] = [];
  for (let m = expression.exec(text); m && found.length < limit; m = expression.exec(text)) {
    found.push([m.index, m.index + m[0].length]);
  }
  return found;
}

/** All matches in the blocks' texts, in document order, at most `limit`. */
export function findAll(
  texts: readonly string[],
  query: string,
  matchCase: boolean,
  limit = MAX_MATCHES,
): FindMatch[] {
  const all: FindMatch[] = [];
  for (let block = 0; block < texts.length && all.length < limit; block++) {
    for (const [start, end] of matchesIn(
      texts[block] as string,
      query,
      matchCase,
      limit - all.length,
    )) {
      all.push({ block, start, end });
    }
  }
  return all;
}

/** The next index after `current` (-1 for none yet), wrapping; `step` is 1 or -1. */
export function stepIndex(current: number, count: number, step: 1 | -1): number {
  if (count === 0) return -1;
  if (current < 0) return step === 1 ? 0 : count - 1;
  return (current + step + count) % count;
}

/** The first match at or after a block (for the match nearest the reader), or 0. */
export function firstFromBlock(matches: readonly FindMatch[], block: number): number {
  const at = matches.findIndex((match) => match.block >= block);
  return at < 0 ? 0 : at;
}

/** A DOM range for offsets in a block's text, or null when they do not fit the pieces. */
export function rangeFor(
  doc: Document,
  block: BlockText,
  start: number,
  end: number,
): Range | null {
  const locate = (offset: number, isEnd: boolean): { node: Text; offset: number } | null => {
    for (const piece of block.pieces) {
      const length = piece.node.length;
      const from = piece.start;
      if (offset < from + length || (isEnd && offset === from + length)) {
        if (offset < from) continue;
        return { node: piece.node, offset: offset - from };
      }
    }
    return null;
  };
  const a = locate(start, false);
  const b = locate(end, true);
  if (!a || !b) return null;
  const range = doc.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}
