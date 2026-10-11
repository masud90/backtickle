/**
 * The fuzzy scorer of Quick Open and the command palette. In-house, no
 * package. A query matches when its characters occur in the text in order (case-insensitive).
 * Among the ways to place them, the best score wins:
 *
 *   each matched character      +1
 *   at a word start             +4   (start of the text, after `/ - _ . space`, or lower to upper case)
 *   directly after the previous matched character   +5
 *   in the file name (after the last `/`)           +2
 *   each skipped character between two matches      -1
 */

export const MATCH_SCORE = 1;
export const CONSECUTIVE_BONUS = 5;
export const BOUNDARY_BONUS = 4;
export const BASENAME_BONUS = 2;
export const GAP_PENALTY = -1;

export interface FuzzyMatch {
  score: number;
  /** Indices (UTF-16 units) of the matched characters of the text. */
  indices: number[];
}

const SEPARATORS = '/-_. ';

function isBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text.charAt(index - 1);
  if (SEPARATORS.includes(previous)) return true;
  const current = text.charAt(index);
  return (
    previous !== previous.toUpperCase() &&
    previous === previous.toLowerCase() &&
    current !== current.toLowerCase()
  );
}

/** The best match of `query` in `text`, or null when it does not match. An empty query matches everything with score 0. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = Array.from(query.toLowerCase().replace(/\s+/g, ''));
  if (q.length === 0) return { score: 0, indices: [] };
  const lower = text.toLowerCase();
  const n = text.length;
  if (lower.length !== n) return null; // a case mapping that changes the length: no match
  const baseStart = text.lastIndexOf('/') + 1;
  const bonus: number[] = [];
  for (let j = 0; j < n; j++) {
    bonus.push(
      MATCH_SCORE +
        (j >= baseStart ? BASENAME_BONUS : 0) +
        (isBoundary(text, j) ? BOUNDARY_BONUS : 0),
    );
  }
  const NONE = Number.NEGATIVE_INFINITY;
  let previous: number[] = [];
  const back: number[][] = [];
  for (let i = 0; i < q.length; i++) {
    const row: number[] = new Array<number>(n).fill(NONE);
    const from: number[] = new Array<number>(n).fill(-1);
    // Best earlier match (two or more characters back) with its gaps already charged.
    let gapBest = NONE;
    let gapFrom = -1;
    for (let j = 0; j < n; j++) {
      if (i > 0 && j >= 2) {
        const candidate = previous[j - 2] as number;
        // Move the window: everything older than j-2 gets one more skipped character.
        if (gapBest > NONE) gapBest += GAP_PENALTY;
        if (candidate > NONE && candidate + GAP_PENALTY > gapBest) {
          gapBest = candidate + GAP_PENALTY;
          gapFrom = j - 2;
        }
      }
      if (lower.charAt(j) !== q[i]) continue;
      if (i === 0) {
        row[j] = bonus[j] as number;
        continue;
      }
      let best = NONE;
      let source = -1;
      const adjacent = j >= 1 ? (previous[j - 1] as number) : NONE;
      if (adjacent > NONE) {
        best = adjacent + CONSECUTIVE_BONUS;
        source = j - 1;
      }
      if (gapBest > best) {
        best = gapBest;
        source = gapFrom;
      }
      if (best > NONE) {
        row[j] = best + (bonus[j] as number);
        from[j] = source;
      }
    }
    back.push(from);
    previous = row;
  }
  let end = -1;
  let top = NONE;
  for (let j = 0; j < n; j++) {
    const value = previous[j] as number;
    if (value > top) {
      top = value;
      end = j;
    }
  }
  if (end < 0) return null;
  const indices: number[] = [];
  let at = end;
  for (let i = q.length - 1; i >= 0; i--) {
    indices.unshift(at);
    at = (back[i] as number[])[at] as number;
  }
  return { score: top, indices };
}

export interface Ranked<T> {
  item: T;
  score: number;
  indices: number[];
}

/** Items that match, best first; equal scores keep the shorter text first, then the input order. */
export function fuzzyRank<T>(
  items: readonly T[],
  query: string,
  textOf: (item: T) => string,
): Ranked<T>[] {
  const out: Array<Ranked<T> & { order: number; length: number }> = [];
  items.forEach((item, order) => {
    const text = textOf(item);
    const match = fuzzyMatch(query, text);
    if (match)
      out.push({ item, score: match.score, indices: match.indices, order, length: text.length });
  });
  out.sort((a, b) => b.score - a.score || a.length - b.length || a.order - b.order);
  return out.map(({ item, score, indices }) => ({ item, score, indices }));
}
