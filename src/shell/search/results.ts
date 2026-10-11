/** The pure parts of the Search tab: display helpers for results. */

export interface HitSegment {
  text: string;
  marked: boolean;
}

/** Splits a result line into runs of matched and unmatched text. Ranges are UTF-16 units of `text`. */
export function hitSegments(
  text: string,
  ranges: ReadonlyArray<readonly [number, number]>,
): HitSegment[] {
  const sorted = ranges
    .map(([a, b]) => [Math.max(0, a), Math.min(text.length, b)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const out: HitSegment[] = [];
  let at = 0;
  for (const [a, b] of sorted) {
    if (b <= at) continue;
    const from = Math.max(a, at);
    if (from > at) out.push({ text: text.slice(at, from), marked: false });
    out.push({ text: text.slice(from, b), marked: true });
    at = b;
  }
  if (at < text.length) out.push({ text: text.slice(at), marked: false });
  return out.length > 0 ? out : [{ text, marked: false }];
}

/** The file name and the folder of a result, the folder relative to the searched folder ("" for its top level). */
export function resultPlace(root: string, path: string): { name: string; folder: string } {
  const slash = path.lastIndexOf('/');
  const name = path.slice(slash + 1);
  const dir = slash > 0 ? path.slice(0, slash) : '';
  const base = root.length > 1 ? root.replace(/\/$/, '') : root;
  const folder = dir === base ? '' : dir.startsWith(`${base}/`) ? dir.slice(base.length + 1) : dir;
  return { name, folder };
}

export const MAX_MATCHES = 1000;
export const MAX_FILES = 500;

/** The note under the summary when a cap was reached, or null. */
export function capsNote(matchCount: number, fileCount: number, truncated: boolean): string | null {
  if (!truncated) return null;
  if (fileCount >= MAX_FILES && matchCount < MAX_MATCHES) return 'Showing the first 500 files';
  return 'Showing the first 1,000 matches';
}

export function summary(matchCount: number, fileCount: number): string {
  const matches = `${matchCount.toLocaleString('en-US')} ${matchCount === 1 ? 'match' : 'matches'}`;
  return `${matches} in ${fileCount.toLocaleString('en-US')} ${fileCount === 1 ? 'file' : 'files'}`;
}
