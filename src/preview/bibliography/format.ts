/**
 * Author-date text from `CslItem`s: the in-text author and year, the sort order, and the entries
 * of the reference list. The expected output is that of Pandoc 3.8.3 `--citeproc` with its
 * default style (Chicago author-date), for the entry types the fixtures and the guides use
 *. This is an approximation of that style, not a CSL
 * processor: `csl:` styles are ignored, titles keep the case they have in the bibliography.
 * The differences are listed in tests/fidelity/ALLOWED.md by the gate.
 */
import { escapeHtml } from '../rules/escape';
import { titleCase } from './title-case';
import type { CslItem, CslName } from './types';

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

/** Most authors listed in an entry before "et al." (Chicago: more than ten). */
const MAX_LISTED_AUTHORS = 10;
const LISTED_BEFORE_ET_AL = 7;

export interface FormattedEntry {
  html: string;
  text: string;
}

function particle(name: CslName): string {
  return [name['dropping-particle'], name['non-dropping-particle']].filter(Boolean).join(' ');
}

/** "van der Berg" (the form used inside a sentence). */
function inTextName(name: CslName): string {
  if (name.literal) return name.literal;
  return [particle(name), name.family].filter(Boolean).join(' ');
}

/** "Jan Willem van der Berg". */
function directName(name: CslName): string {
  if (name.literal) return name.literal;
  const family = [particle(name), name.family].filter(Boolean).join(' ');
  return [name.given, family, name.suffix].filter(Boolean).join(' ');
}

/** "Berg, Jan Willem van der" (Chicago moves the particle behind the given names). */
function invertedName(name: CslName): string {
  if (name.literal) return name.literal;
  const given = [name.given, particle(name)].filter(Boolean).join(' ');
  return [name.family, given].filter(Boolean).join(', ');
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/** The names of an entry's lead: the first one inverted. */
function leadingNames(names: readonly CslName[]): string {
  const listed = names.length > MAX_LISTED_AUTHORS ? names.slice(0, LISTED_BEFORE_ET_AL) : names;
  const texts = listed.map((name, index) => (index === 0 ? invertedName(name) : directName(name)));
  if (names.length > MAX_LISTED_AUTHORS) return `${texts.join(', ')}, et al.`;
  if (texts.length === 2) return `${texts[0]}, and ${texts[1]}`;
  return joinNames(texts);
}

function quoted(title: string): string {
  return /[.?!]$/.test(title) ? `“${title}”` : `“${title}.”`;
}

export function yearOf(item: CslItem): string | null {
  const date = item.issued;
  const year = date?.['date-parts']?.[0]?.[0];
  if (typeof year === 'number' && Number.isFinite(year)) return String(year);
  const literal = date?.literal ? /\d{4}/.exec(date.literal)?.[0] : undefined;
  return literal ?? null;
}

/** The title, as the text that stands for the author when there is none. */
/** A title or container title as the default style prints it. */
function titled(text: string | undefined, item: CslItem): string {
  return titleCase(text ?? '', item.language);
}

function titleAsAuthor(item: CslItem): string {
  const title = titled(item.title, item);
  if (title === '') return '';
  return isQuotedType(item) ? `“${title}”` : title;
}

function isQuotedType(item: CslItem): boolean {
  switch (item.type) {
    case 'article-journal':
    case 'chapter':
    case 'paper-conference':
    case 'webpage':
    case 'thesis':
    case 'article':
    case 'article-magazine':
    case 'article-newspaper':
    case 'post':
    case 'post-weblog':
      return true;
    default:
      return false;
  }
}

/** The author text of an in-text citation: authors, else editors, else the title. */
export function inTextAuthor(item: CslItem): string {
  const names = item.author?.length ? item.author : item.editor;
  if (names?.length) {
    const texts = names.map(inTextName);
    if (texts.length === 1) return texts[0] as string;
    if (texts.length === 2) return `${texts[0]} and ${texts[1]}`;
    return `${texts[0]} et al.`;
  }
  return titleAsAuthor(item);
}

/** "Author Year" for the completion popup (without the year letter). */
export function shortLabel(item: CslItem): string {
  const author = inTextAuthor(item);
  return [author, yearOf(item) ?? 'n.d.'].filter(Boolean).join(' ');
}

/** The key the reference list is sorted by: author (or editor, or title), year, title. */
export function sortKeys(item: CslItem): { name: string; year: number; title: string } {
  const names = item.author?.length ? item.author : item.editor;
  const name = names?.length ? names.map(invertedName).join(' ') : (item.title ?? '');
  const year = Number(yearOf(item));
  return {
    name: fold(name),
    year: Number.isFinite(year) && year > 0 ? year : Number.POSITIVE_INFINITY,
    title: fold(item.title ?? ''),
  };
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function compareItems(a: CslItem, b: CslItem): number {
  const x = sortKeys(a);
  const y = sortKeys(b);
  if (x.name !== y.name) return x.name < y.name ? -1 : 1;
  if (x.year !== y.year) return x.year < y.year ? -1 : 1;
  if (x.title !== y.title) return x.title < y.title ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** a, b, ... z, aa, ab, ... */
export function yearLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

function ordinal(value: string): string {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return value;
  const tail = n % 100;
  if (tail >= 11 && tail <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function pages(text: string): string {
  return text.replace(/\s*(?:--|-|–|—)\s*/g, '–');
}

function titleCaseWords(text: string): string {
  return text.replace(
    /(^|\s)(\p{L})/gu,
    (_all, space: string, letter: string) => space + letter.toUpperCase(),
  );
}

const em = (text: string): string => `<em>${escapeHtml(text)}</em>`;

/** `https:` and `http:` addresses become links; anything else is shown as text. */
function link(address: string): string {
  const safe = /^https?:\/\//i.test(address);
  const text = escapeHtml(address);
  return safe ? `<a href="${text}">${text}</a>` : text;
}

function addressOf(item: CslItem): string | undefined {
  if (item.DOI) {
    const doi = item.DOI.trim();
    return /^https?:\/\//i.test(doi) ? doi : `https://doi.org/${doi}`;
  }
  return item.URL?.trim() || undefined;
}

/** The text of a chunk with its closing period, unless it already ends with one. */
function closed(html: string): string {
  const text = html.replace(/<[^>]*>/g, '');
  return /[.?!]$|[.?!]”$/.test(text) ? html : `${html}.`;
}

function dateText(item: CslItem): string | undefined {
  const parts = item.issued?.['date-parts']?.[0];
  const month = parts?.[1];
  if (!month || month < 1 || month > 12) return undefined;
  const day = parts?.[2];
  return day ? `${MONTHS[month - 1]} ${day}` : (MONTHS[month - 1] as string);
}

function volumeLine(item: CslItem): string {
  const container = item['container-title'] ? titled(item['container-title'], item) : undefined;
  const month = item.issued?.['date-parts']?.[0]?.[1];
  const monthName = month && month >= 1 && month <= 12 ? MONTHS[month - 1] : undefined;
  let line = container ? em(container) : '';
  if (item.volume) {
    line += `${line ? ' ' : ''}${escapeHtml(item.volume)}`;
    if (item.issue) line += ` (${escapeHtml(item.issue)})`;
    else if (monthName) line += ` (${monthName})`;
    if (item.page) line += `: ${escapeHtml(pages(item.page))}`;
  } else if (item.issue) {
    line += `${line ? ' ' : ''}(${escapeHtml(item.issue)})`;
    if (item.page) line += `: ${escapeHtml(pages(item.page))}`;
  } else if (item.page) {
    line += `${line ? ', ' : ''}${escapeHtml(pages(item.page))}`;
  } else if (item.DOI && line) {
    line += ', ahead of print';
  }
  return line;
}

/** The entry of the reference list, with the year as it is cited (letter included). */
export function formatEntry(item: CslItem, year: string): FormattedEntry {
  const chunks: string[] = [];
  const hasAuthors = Boolean(item.author?.length);
  const hasEditors = Boolean(item.editor?.length);
  const title = titled(item.title, item);
  const quotedType = isQuotedType(item);
  const titleHtml = quotedType ? escapeHtml(quoted(title)) : em(title);

  let titleDone = false;
  if (hasAuthors) {
    chunks.push(escapeHtml(leadingNames(item.author as CslName[])));
  } else if (hasEditors) {
    const editors = item.editor as CslName[];
    chunks.push(escapeHtml(`${leadingNames(editors)}, ${editors.length > 1 ? 'eds.' : 'ed.'}`));
  } else if (title !== '') {
    chunks.push(titleHtml);
    titleDone = true;
  }
  chunks.push(escapeHtml(year));
  if (!titleDone && title !== '') chunks.push(titleHtml);

  const container = item['container-title'] ? titled(item['container-title'], item) : undefined;
  const publisher = item.publisher ? escapeHtml(item.publisher) : '';
  const address = addressOf(item);
  switch (item.type) {
    case 'article-journal':
    case 'article':
    case 'article-magazine':
    case 'article-newspaper': {
      const line = volumeLine(item);
      if (line) chunks.push(line);
      break;
    }
    case 'chapter': {
      let line = container ? `In ${em(container)}` : '';
      if (hasAuthors || hasEditors) {
        const editors = item.editor?.length && hasAuthors ? item.editor : undefined;
        if (editors)
          line += `${line ? ', ' : ''}edited by ${escapeHtml(joinNames(editors.map(directName)))}`;
      }
      if (line) chunks.push(line);
      if (publisher) chunks.push(publisher);
      break;
    }
    case 'paper-conference': {
      let line = container ? em(container) : '';
      if (item.page) line += `${line ? ', ' : ''}${escapeHtml(pages(item.page))}`;
      if (line) chunks.push(line);
      break;
    }
    case 'thesis': {
      const line = [item.genre, item.publisher]
        .filter(Boolean)
        .map((part) => escapeHtml(part as string));
      if (line.length > 0) chunks.push(line.join(', '));
      break;
    }
    case 'webpage': {
      const date = dateText(item);
      const line = [container ? em(container) : '', container ? (date ?? '') : '']
        .filter(Boolean)
        .join(', ');
      if (line) chunks.push(line);
      break;
    }
    case 'report': {
      const kind = item.genre ? titleCaseWords(item.genre) : '';
      const number = item.number ? `No. ${item.number}` : '';
      const line = [kind, number].filter(Boolean).join(' ');
      if (line) chunks.push(escapeHtml(line));
      if (publisher) chunks.push(publisher);
      break;
    }
    default: {
      if (item.edition) chunks.push(escapeHtml(`${ordinal(item.edition)} ed.`));
      if (item.volume) chunks.push(escapeHtml(`Vol. ${item.volume}`));
      if (publisher) chunks.push(publisher);
      break;
    }
  }
  if (item.type === 'report' && item.edition)
    chunks.push(escapeHtml(`${ordinal(item.edition)} ed.`));
  if (address) chunks.push(link(address));

  const html = chunks.map(closed).join(' ');
  return { html, text: textOf(html) };
}

/** The plain text of the entry HTML this module makes (`em`, `a`, entities). */
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
