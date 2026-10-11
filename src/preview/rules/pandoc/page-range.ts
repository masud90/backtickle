/**
 * Page ranges as Pandoc's default style (Chicago author-date, `page-range-format: chicago`) prints
 * them: "105-110" gives "105-10", "1496-1504" gives "1496-504". The separator stays as written.
 * Expected values in `tests/unit/pandoc-page-range.test.ts` come from Pandoc 3.8.3 itself.
 */

const RANGE = /(\d+)(\s*(?:--|-|–|—)\s*)(\d+)/g;

/** The end of a range, shortened by the Chicago rule. Both are digit strings. */
export function collapseRangeEnd(first: string, second: string): string {
  // A short end is completed first ("12-9" is 12 to 19).
  const end =
    second.length < first.length ? first.slice(0, first.length - second.length) + second : second;
  if (end.length !== first.length || Number(end) <= Number(first)) return second;
  const a = Number(first);
  if (a < 100 || a % 100 === 0) return end;
  let changed = 0;
  while (changed < first.length && first[changed] === end[changed]) changed++;
  const length = first.length;
  if (changed < length - 2) return end.slice(-3);
  const low = a % 100;
  // 101 to 109 (and 1001 to 1009): only the digits that changed.
  return low >= 1 && low <= 9 ? end.slice(changed) : end.slice(-2);
}

/** Collapses every digit range in the text ("105-110, 120-125" gives "105-10, 120-25"). */
export function collapsePageRanges(text: string): string {
  return text.replace(RANGE, (_all, first: string, separator: string, second: string) => {
    return `${first}${separator}${collapseRangeEnd(first, second)}`;
  });
}
