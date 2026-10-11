/**
 * BibTeX and BibLaTeX with `@retorquere/bibtex-parser`, mapped to `CslItem`s (the mapping Pandoc
 * uses for the common entry types and fields). Titles keep the case they have in the file.
 */
import { type Creator, type Entry, parse } from '@retorquere/bibtex-parser';
import { itemFromRecord } from './csl';
import type { CslItem, CslName, ParsedBibliography } from './types';

const TYPES: Record<string, string> = {
  article: 'article-journal',
  periodical: 'article-journal',
  suppperiodical: 'article-journal',
  book: 'book',
  mvbook: 'book',
  booklet: 'pamphlet',
  inbook: 'chapter',
  incollection: 'chapter',
  suppbook: 'chapter',
  suppcollection: 'chapter',
  inproceedings: 'paper-conference',
  conference: 'paper-conference',
  proceedings: 'book',
  collection: 'book',
  mvcollection: 'book',
  manual: 'book',
  techreport: 'report',
  report: 'report',
  thesis: 'thesis',
  phdthesis: 'thesis',
  mastersthesis: 'thesis',
  unpublished: 'manuscript',
  online: 'webpage',
  electronic: 'webpage',
  www: 'webpage',
  patent: 'patent',
  misc: 'document',
  software: 'software',
  dataset: 'dataset',
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const TAGS = /<\/?[A-Za-z][^>]*>/g;

function plain(value: unknown): string | undefined {
  let text: string | undefined;
  if (typeof value === 'string') text = value;
  else if (Array.isArray(value)) text = value.filter((v) => typeof v === 'string').join(' and ');
  if (text === undefined) return undefined;
  const clean = text.replace(TAGS, '').replace(/\s+/g, ' ').trim();
  return clean === '' ? undefined : clean;
}

function nameOf(creator: Creator): CslName | undefined {
  if (creator.name) return { literal: creator.name };
  const name: CslName = {};
  if (creator.lastName) name.family = creator.lastName;
  if (creator.firstName) name.given = creator.firstName;
  if (creator.prefix) name['non-dropping-particle'] = creator.prefix;
  if (creator.suffix) name.suffix = creator.suffix;
  return name.family || name.given ? name : undefined;
}

function namesOf(value: unknown): CslName[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value
    .filter((entry): entry is Creator => typeof entry === 'object' && entry !== null)
    .map(nameOf)
    .filter((name): name is CslName => name !== undefined);
  return names.length > 0 ? names : undefined;
}

/** BibTeX `45--67` and `45-67` both mean a range. */
function pagesOf(text: string): string {
  return text.replace(/\s*(?:--|[–—])\s*/g, '-');
}

/** `date` (BibLaTeX) first, then `year` with an optional `month`. */
function issuedOf(fields: Record<string, unknown>): string | undefined {
  const date = plain(fields.date);
  if (date) return date;
  const year = plain(fields.year);
  if (!year) return undefined;
  const month = plain(fields.month);
  if (!month) return year;
  const index = MONTHS.indexOf(month.slice(0, 3).toLowerCase()) + 1;
  const number = index > 0 ? index : Number(month);
  return number >= 1 && number <= 12 ? `${year}-${number}` : year;
}

function itemOf(entry: Entry): CslItem | undefined {
  const fields = entry.fields as Record<string, unknown>;
  const type = TYPES[entry.type.toLowerCase()] ?? 'document';
  const isArticle = type === 'article-journal';
  const record: Record<string, unknown> = {
    id: entry.key,
    type,
    title: plain(fields.title),
    'title-short': plain(fields.shorttitle),
    publisher: plain(fields.publisher) ?? plain(fields.organization) ?? plain(fields.institution),
    'publisher-place': plain(fields.location) ?? plain(fields.address),
    volume: plain(fields.volume),
    edition: plain(fields.edition),
    genre: plain(fields.type),
    note: plain(fields.note),
    abstract: plain(fields.abstract),
    DOI: plain(fields.doi),
    URL: plain(fields.url),
    ISBN: plain(fields.isbn),
    ISSN: plain(fields.issn),
    issued: issuedOf(fields),
    author: namesOf(fields.author),
    editor: namesOf(fields.editor),
    translator: namesOf(fields.translator),
    'collection-title': plain(fields.series),
  };
  const pages = plain(fields.pages);
  if (pages) record.page = pagesOf(pages);
  const number = plain(fields.number);
  const issue = plain(fields.issue);
  if (isArticle) record.issue = issue ?? number;
  else {
    record.number = number;
    record.issue = issue;
  }
  const journal = plain(fields.journaltitle) ?? plain(fields.journal);
  const bookTitle = plain(fields.booktitle);
  record['container-title'] = isArticle ? (journal ?? bookTitle) : (bookTitle ?? journal);
  return itemFromRecord(record);
}

export function parseBibtex(text: string): ParsedBibliography {
  let library: ReturnType<typeof parse>;
  try {
    library = parse(text, {
      english: false,
      sentenceCase: false,
      caseProtection: false,
      unsupported: 'ignore',
      applyCrossRef: true,
    });
  } catch {
    return { items: [], errors: ['The bibliography is not valid BibTeX.'] };
  }
  const items: CslItem[] = [];
  for (const entry of library.entries) {
    const item = itemOf(entry);
    if (item) items.push(item);
  }
  const errors =
    library.errors.length > 0 ? [`${library.errors.length} BibTeX entries had errors.`] : [];
  return { items, errors };
}
