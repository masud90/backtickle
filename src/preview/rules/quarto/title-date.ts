/**
 * Quarto shows a title-block date written as `YYYY-MM-DD` in its long form ("October 6, 2026").
 * Any other value (`today`, `last-modified`, free text) stays as written. `date-format` is not
 * honored: the long English form is always used.
 */
import type { MarkdownIt } from 'markdown-it';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "2026-10-06" gives "October 6, 2026"; anything else (or an impossible date) is unchanged. */
export function formatQuartoDate(value: string): string {
  const match = ISO_DATE.exec(value.trim());
  if (!match) return value;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    month < 1 ||
    month > 12 ||
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return value;
  }
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/** Wraps the Pandoc title-block renderer so that its date is shown as Quarto shows it. */
export function installQuartoTitleDate(md: MarkdownIt): void {
  const base = md.renderer.rules.title_block;
  if (!base) return;
  md.renderer.rules.title_block = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const data = token?.meta?.data as Record<string, unknown> | undefined;
    if (token && data && typeof data.date === 'string') {
      const date = formatQuartoDate(data.date);
      if (date !== data.date) {
        // The renderer reads the data once; it is restored right after.
        const original = token.meta;
        token.meta = { ...token.meta, data: { ...data, date } };
        try {
          return base(tokens, idx, options, env, self);
        } finally {
          token.meta = original;
        }
      }
    }
    return base(tokens, idx, options, env, self);
  };
}
