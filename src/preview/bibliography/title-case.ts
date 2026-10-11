/**
 * Title case for English titles in the reference list, as Pandoc's default style (citeproc 3.8.3)
 * prints them. The rules were read off Pandoc's output:
 *
 * - Not applied when the item's `language` is set and is not English.
 * - A word with an uppercase letter anywhere (`iPhone`, `GDP`) or a period inside (`u.s.`) stays.
 * - The first word of the title, and the first word after a word that ends in `:`, `?`, `!` or
 *   `.`, gets a capital whatever it is.
 * - Other words get a capital unless they are one letter, or one of the stop words (a an and as
 *   at but by down for from in into nor of on onto or over so the till to up via with yet about
 *   de van von). There is no rule for the last word.
 * - The parts of a hyphenated or slashed word are treated as words; after an apostrophe nothing
 *   changes (`O'brien's`).
 */
const STOP = new Set(
  'a an and as at but by down for from in into nor of on onto or over so the till to up via with yet about de van von'.split(
    ' ',
  ),
);

function capitalize(text: string): string {
  const first = [...text][0] ?? '';
  return first.toUpperCase() + text.slice(first.length);
}

function part(piece: string, forced: boolean): string {
  const match = /^([^\p{L}\p{N}]*)(.*)$/su.exec(piece);
  const prefix = match?.[1] ?? '';
  const rest = match?.[2] ?? '';
  if (!/^\p{L}/u.test(rest)) return piece;
  if (/\p{Lu}/u.test(rest) || /\p{L}\.\p{L}/u.test(rest)) {
    return forced ? prefix + capitalize(rest) : piece;
  }
  const apostrophe = rest.search(/['’]/);
  const head = apostrophe < 0 ? rest : rest.slice(0, apostrophe);
  const tail = apostrophe < 0 ? '' : rest.slice(apostrophe);
  const letters = head.replace(/[^\p{L}]/gu, '');
  if (!forced && ([...letters].length <= 1 || STOP.has(letters.toLowerCase()))) return piece;
  return prefix + capitalize(head) + tail;
}

export function titleCase(title: string, language?: string): string {
  if (language && !/^en\b/i.test(language)) return title;
  let forced = true;
  return title
    .split(/(\s+)/)
    .map((token) => {
      if (/^\s*$/.test(token)) return token;
      const parts = token.split(/([-/])/);
      const out = parts.map((piece, index) =>
        index % 2 === 1 ? piece : part(piece, forced && index === 0),
      );
      forced = /[:?!.]$/.test(token);
      return out.join('');
    })
    .join('');
}
