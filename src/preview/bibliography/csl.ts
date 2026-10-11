/**
 * CSL JSON and CSL YAML (also the `references` of a document's metadata): read into `CslItem`s.
 * YAML is read with the core schema of js-yaml (no code tags, no timestamps: a date stays text).
 */
import { CORE_SCHEMA, load } from 'js-yaml';
import type { CslDate, CslItem, CslName, ParsedBibliography } from './types';

/** Larger bibliographies are not read from YAML: they are far more likely a mistake. */
const MAX_YAML_CHARS = 8 * 1024 * 1024;
const MAX_ITEMS = 100_000;

const STRING_FIELDS = [
  'title',
  'title-short',
  'container-title',
  'collection-title',
  'publisher',
  'publisher-place',
  'volume',
  'issue',
  'number',
  'page',
  'edition',
  'genre',
  'note',
  'abstract',
  'DOI',
  'URL',
  'ISBN',
  'ISSN',
] as const;

const NAME_FIELDS = ['author', 'editor', 'translator'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scalarText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function nameOf(value: unknown): CslName | undefined {
  if (typeof value === 'string') return value.trim() === '' ? undefined : { literal: value.trim() };
  if (!isRecord(value)) return undefined;
  const name: CslName = {};
  for (const key of [
    'family',
    'given',
    'literal',
    'non-dropping-particle',
    'dropping-particle',
    'suffix',
  ] as const) {
    const text = scalarText(value[key]);
    if (text !== undefined && text !== '') name[key] = text;
  }
  return name.family || name.given || name.literal ? name : undefined;
}

/** `2020`, `2020-05`, `2020-05-01`, `2020/05/01`, or text that starts with a year. */
function dateFromText(text: string): CslDate | undefined {
  const match = /^\s*(\d{4})(?:[-/](\d{1,2})(?:[-/](\d{1,2}))?)?(?![\d])/.exec(text);
  if (!match) return text.trim() === '' ? undefined : { literal: text.trim() };
  const parts = [Number(match[1])];
  if (match[2]) parts.push(Number(match[2]));
  if (match[3]) parts.push(Number(match[3]));
  return { 'date-parts': [parts] };
}

function dateOf(value: unknown): CslDate | undefined {
  if (typeof value === 'number')
    return Number.isFinite(value) ? { 'date-parts': [[value]] } : undefined;
  if (typeof value === 'string') return dateFromText(value);
  if (!isRecord(value)) return undefined;
  const parts = value['date-parts'];
  if (Array.isArray(parts) && Array.isArray(parts[0])) {
    const first = (parts[0] as unknown[]).map((part) => Number(part)).filter(Number.isFinite);
    if (first.length > 0) return { 'date-parts': [first.slice(0, 3)] };
  }
  const raw = scalarText(value.raw) ?? scalarText(value.literal);
  return raw === undefined ? undefined : dateFromText(raw);
}

/** One CSL JSON object as an item, or undefined when it has no id. */
export function itemFromRecord(record: unknown): CslItem | undefined {
  if (!isRecord(record)) return undefined;
  const id = scalarText(record.id);
  if (id === undefined || id.trim() === '') return undefined;
  const item: CslItem = { id: id.trim(), type: scalarText(record.type) ?? 'document' };
  for (const field of STRING_FIELDS) {
    const text = scalarText(record[field]);
    if (text !== undefined && text !== '') item[field] = text;
  }
  for (const field of NAME_FIELDS) {
    const list = record[field];
    if (!Array.isArray(list)) continue;
    const names = list.map(nameOf).filter((name): name is CslName => name !== undefined);
    if (names.length > 0) item[field] = names;
  }
  const issued = dateOf(record.issued);
  if (issued) item.issued = issued;
  const accessed = dateOf(record.accessed);
  if (accessed) item.accessed = accessed;
  return item;
}

function itemsFromList(list: unknown): ParsedBibliography {
  const items: CslItem[] = [];
  let skipped = 0;
  if (!Array.isArray(list)) return { items, errors: ['No list of references was found.'] };
  for (const entry of list.slice(0, MAX_ITEMS)) {
    const item = itemFromRecord(entry);
    if (item) items.push(item);
    else skipped++;
  }
  const errors = skipped > 0 ? [`${skipped} entries without an id were skipped.`] : [];
  return { items, errors };
}

/** The list inside a parsed document: the value itself, or its `references` or `items`. */
function listOf(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (isRecord(value)) return value.references ?? value.items;
  return undefined;
}

export function parseCslJson(text: string): ParsedBibliography {
  try {
    return itemsFromList(listOf(JSON.parse(text)));
  } catch {
    return { items: [], errors: ['The bibliography is not valid JSON.'] };
  }
}

export function parseCslYaml(text: string): ParsedBibliography {
  if (text.length > MAX_YAML_CHARS) {
    return { items: [], errors: ['The bibliography file is too large to read.'] };
  }
  try {
    return itemsFromList(listOf(load(text, { schema: CORE_SCHEMA, maxAliases: 20 })));
  } catch {
    return { items: [], errors: ['The bibliography is not valid YAML.'] };
  }
}

/** The inline `references` of a document's metadata (CSL YAML). */
export function referencesFromMetadata(metadata: Record<string, unknown>): ParsedBibliography {
  if (!Object.hasOwn(metadata, 'references')) return { items: [], errors: [] };
  return itemsFromList(metadata.references);
}
