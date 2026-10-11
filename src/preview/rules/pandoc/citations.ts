/**
 * Pandoc citations: `[@a]`, `@a`, `[-@a]`, `[see @a, p. 33; @b]`,
 * `@a [p. 5]`, `[@{key with spaces}]` and the MultiMarkdown form `[#a]`, as inline tokens whose
 * text comes from the whole-document `CitationPlan` (which `prepareCitations` builds, once per
 * document, from the bibliography). The text is what Pandoc 3.8.3 `--citeproc` gives with its
 * default style, see `bibliography/format.ts`.
 *
 * Three parts:
 * - parsing (`parseBracketCitation`, `parseNarrativeCitation`), pure functions of the text;
 * - `prepareCitations`: the cited keys in order, the year letters, the reference list;
 * - `installCitations`: the markdown-it rule and renderer. A `citation` token carries its plain
 *   text in `content` (the word counter reads it) and its HTML in `meta.html`.
 *
 * A key that is not in the bibliography shows as `@key?` in a `span.citation.citation-missing`.
 * A `[#key]` whose key is not in the bibliography stays literal text (it is probably not a
 * citation).
 */
import type { Env, MarkdownIt, StateInline } from 'markdown-it';
import type { CitationEntry } from '@/editor/complete';
import {
  compareItems,
  formatEntry,
  inTextAuthor,
  shortLabel,
  yearLetter,
  yearOf,
} from '../../bibliography/format';
import type { Bibliography, CslItem } from '../../bibliography/types';
import { hashString } from '../../hash';
import type { DocContext } from '../../types';
import { wdEnv } from './../env';
import { escapeHtml } from '../escape';
import { collapsePageRanges } from './page-range';

// ---- parsing -------------------------------------------------------------------------------

export interface CitationItem {
  key: string;
  /** Text before the key, for example "see". */
  prefix: string;
  /** Text after the key (locator and suffix), trimmed, without a leading comma. */
  suffix: string;
  /** The suffix was introduced by a comma. */
  comma: boolean;
  /** `-@key`: the author is not printed. */
  suppressAuthor: boolean;
  /** Written in the MultiMarkdown form `#key`. */
  mmd: boolean;
}

export interface ParsedCitation {
  items: CitationItem[];
  /** `@key` in running text: the author is part of the sentence and the year is in brackets. */
  narrative: boolean;
  /** Index in the source just after the citation. */
  end: number;
}

const WORD = /[\p{L}\p{N}_]/u;
const KEY_PATTERN =
  /\{([^{}]+)\}|[\p{L}\p{N}_](?:[\p{L}\p{N}_]|[:.#$%&+?<>~/-](?=[\p{L}\p{N}_]))*/uy;
/** A bracket group longer than this is not read as a citation. */
const MAX_GROUP_CHARS = 2000;

/** The key that starts at `start` (just after `@` or `#`): the key and the index after it. */
function readKey(text: string, start: number): { key: string; end: number } | null {
  KEY_PATTERN.lastIndex = start;
  const match = KEY_PATTERN.exec(text);
  if (!match) return null;
  const key = match[1] ?? match[0];
  return key === '' ? null : { key, end: start + match[0].length };
}

/** The index of the `]` that closes the `[` at `open`, or -1. Nested brackets and escapes count. */
function findClosing(text: string, open: number): number {
  let depth = 0;
  const limit = Math.min(text.length, open + MAX_GROUP_CHARS);
  for (let i = open; i < limit; i++) {
    const char = text.charCodeAt(i);
    if (char === 0x5c) i++;
    else if (char === 0x5b) depth++;
    else if (char === 0x5d && --depth === 0) return i;
  }
  return -1;
}

/** A citation group with `;` between its items, outside nested brackets. */
function splitParts(content: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    if (char === 0x5c) i++;
    else if (char === 0x5b || char === 0x7b) depth++;
    else if (char === 0x5d || char === 0x7d) depth--;
    else if (char === 0x3b && depth <= 0) {
      parts.push(content.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(content.slice(from));
  return parts;
}

function itemOfPart(part: string): CitationItem | null {
  for (let at = part.indexOf('@'); at !== -1; at = part.indexOf('@', at + 1)) {
    const before = at > 0 ? part.charAt(at - 1) : '';
    const suppress = before === '-';
    const charBefore = suppress ? (at > 1 ? part.charAt(at - 2) : '') : before;
    if (charBefore !== '' && WORD.test(charBefore)) continue;
    const read = readKey(part, at + 1);
    if (!read) continue;
    const prefix = part.slice(0, suppress ? at - 1 : at).trim();
    let suffix = part.slice(read.end).trim();
    const comma = suffix.startsWith(',');
    if (comma) suffix = suffix.slice(1).trim();
    return {
      key: read.key,
      prefix,
      suffix,
      comma,
      suppressAuthor: suppress,
      mmd: false,
    };
  }
  return null;
}

function itemOfMmdPart(part: string): CitationItem | null {
  const match = /^\s*#/.exec(part);
  if (!match) return null;
  const read = readKey(part, match[0].length);
  if (!read || part.slice(read.end).trim() !== '') return null;
  return {
    key: read.key,
    prefix: '',
    suffix: '',
    comma: false,
    suppressAuthor: false,
    mmd: true,
  };
}

/**
 * The citation group that starts with `[` at `start`: `[@a]`, `[see @a, p. 3; @b]`, `[#a]`, and
 * the MultiMarkdown form `[p. 3][#a]`. Null if it is not one (a link, a task box, plain brackets).
 */
export function parseBracketCitation(text: string, start: number): ParsedCitation | null {
  if (text.charAt(start) !== '[') return null;
  const close = findClosing(text, start);
  if (close === -1) return null;
  const content = text.slice(start + 1, close);
  if (!content.includes('@') && !content.includes('#') && text.charAt(close + 1) !== '[')
    return null;
  // A link or an image with this text, or a reference link, is not a citation.
  const after = text.charAt(close + 1);
  if (after === '(') return null;

  if (after === '[') {
    // `[locator][#key]`
    const secondClose = findClosing(text, close + 1);
    if (secondClose !== -1) {
      const item = itemOfMmdPart(text.slice(close + 2, secondClose));
      if (item && !content.includes('@')) {
        item.suffix = content.trim();
        item.comma = true;
        return { items: [item], narrative: false, end: secondClose + 1 };
      }
    }
    return null;
  }

  const parts = splitParts(content);
  const items: CitationItem[] = [];
  for (const part of parts) {
    const item = itemOfPart(part) ?? itemOfMmdPart(part);
    if (!item) return null;
    items.push(item);
  }
  return { items, narrative: false, end: close + 1 };
}

/**
 * `@key` in running text, with an optional `[locator]` right after it. The `@` must not follow
 * a letter or digit (an e-mail address is not a citation).
 */
export function parseNarrativeCitation(text: string, start: number): ParsedCitation | null {
  if (text.charAt(start) !== '@') return null;
  if (start > 0 && WORD.test(text.charAt(start - 1))) return null;
  const read = readKey(text, start + 1);
  if (!read) return null;
  const item: CitationItem = {
    key: read.key,
    prefix: '',
    suffix: '',
    comma: false,
    suppressAuthor: false,
    mmd: false,
  };
  let end = read.end;
  const bracket = /^[ \t]?\[/.exec(text.slice(end, end + 2));
  if (bracket) {
    const open = end + bracket[0].length - 1;
    const close = findClosing(text, open);
    const next = close === -1 ? '' : text.charAt(close + 1);
    const content = close === -1 ? '' : text.slice(open + 1, close);
    if (close !== -1 && content.trim() !== '' && !content.includes('@') && !/[([:]/.test(next)) {
      item.suffix = content.trim();
      item.comma = true;
      end = close + 1;
    }
  }
  return { items: [item], narrative: true, end };
}

// ---- the plan ------------------------------------------------------------------------------

export interface ReferenceEntry {
  key: string;
  html: string;
  text: string;
}

/** What the whole document needs to print its citations and its reference list. */
export interface CitationPlan {
  readonly kind: 'citation-plan';
  items: ReadonlyMap<string, CslItem>;
  /** Cited keys in order of first use, in the bibliography or not. */
  keys: string[];
  /** In-text author and year (with the year letter) of every listed item. */
  labels: ReadonlyMap<string, { author: string; year: string }>;
  /** The reference list: cited items and `nocite` items, sorted. */
  references: ReferenceEntry[];
  linkCitations: boolean;
  suppressBibliography: boolean;
  /** A bibliography file is still being loaded: unknown keys are pending, not missing. */
  pending?: boolean;
  /** A hash of everything that changes the printed text. */
  signature: string;
}

/** A plan for a document without a bibliography: every key is missing. */
export const EMPTY_PLAN: CitationPlan = Object.freeze({
  kind: 'citation-plan',
  items: new Map(),
  keys: [],
  labels: new Map(),
  references: [],
  linkCitations: false,
  suppressBibliography: false,
  signature: 'none',
}) as CitationPlan;

export function isCitationPlan(value: unknown): value is CitationPlan {
  return (
    typeof value === 'object' && value !== null && (value as CitationPlan).kind === 'citation-plan'
  );
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const INLINE_CODE = /(`+)(?:(?!\1)[\s\S])*?\1/g;

/** The source with frontmatter, code blocks, code spans and HTML comments blanked out. */
function withoutCode(source: string): string {
  const lines = source.split('\n');
  let fence: { char: string; length: number } | null = null;
  let start = 0;
  if (lines[0]?.trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (/^(?:---|\.\.\.)\s*$/.test(lines[i] as string)) {
        for (let j = 0; j <= i; j++) lines[j] = '';
        start = i + 1;
        break;
      }
    }
  }
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] as string;
    const match = FENCE.exec(line);
    if (fence) {
      if (
        match &&
        (match[1] as string).startsWith(fence.char) &&
        (match[1] as string).length >= fence.length &&
        /^\s*$/.test(line.slice(match[0].length))
      ) {
        fence = null;
      }
      lines[i] = '';
    } else if (
      match &&
      !((match[1] as string).startsWith('`') && line.slice(match[0].length).includes('`'))
    ) {
      fence = {
        char: (match[1] as string).charAt(0),
        length: (match[1] as string).length,
      };
      lines[i] = '';
    } else if (line.includes('`')) {
      lines[i] = line.replace(INLINE_CODE, (code) => ' '.repeat(code.length));
    }
  }
  return lines.join('\n').replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '));
}

/**
 * The keys cited in the source, in order of first use. `[#key]` counts only for keys of the
 * bibliography. A cheap scan of the whole document (the `prepare` step).
 */
export function scanCitedKeys(source: string, known?: ReadonlyMap<string, unknown>): string[] {
  if (!source.includes('@') && !source.includes('#')) return [];
  const text = withoutCode(source);
  const keys: string[] = [];
  const seen = new Set<string>();
  const add = (key: string) => {
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  };
  const marks = /[[@]/g;
  for (let match = marks.exec(text); match; match = marks.exec(text)) {
    const at = match.index;
    const found =
      text.charAt(at) === '[' ? parseBracketCitation(text, at) : parseNarrativeCitation(text, at);
    if (!found) continue;
    if (found.items.some((item) => item.mmd && !known?.has(item.key))) continue;
    for (const item of found.items) add(item.key);
    marks.lastIndex = found.end;
  }
  return keys;
}

/** The keys of the `nocite` metadata: `@a, @b` in a string or a list; `@*` means every item. */
function nociteKeys(metadata: Record<string, unknown>): {
  keys: string[];
  all: boolean;
} {
  const raw = Object.hasOwn(metadata, 'nocite') ? metadata.nocite : undefined;
  const texts = (Array.isArray(raw) ? raw : [raw]).filter(
    (value): value is string => typeof value === 'string',
  );
  const keys: string[] = [];
  let all = false;
  for (const text of texts) {
    for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
      if (text.charAt(at + 1) === '*') {
        all = true;
        continue;
      }
      const read = readKey(text, at + 1);
      if (read) keys.push(read.key);
    }
  }
  return { keys, all };
}

function truthy(value: unknown): boolean {
  return value === true || value === 'true';
}

/**
 * Builds the plan of a document: which keys are cited (in order), which items the reference list
 * has, the year letters ("2020a", "2020b": items with the same author text and year, in the order
 * of the reference list) and the printed entries.
 */
export function prepareCitations(input: {
  source: string;
  bibliography: Bibliography | null;
  metadata: Record<string, unknown>;
}): CitationPlan {
  const items: ReadonlyMap<string, CslItem> = input.bibliography?.items ?? new Map();
  const metadata = input.metadata;
  const keys = scanCitedKeys(input.source, items);
  const nocite = nociteKeys(metadata);

  const listedKeys = new Set<string>();
  for (const key of keys) if (items.has(key)) listedKeys.add(key);
  if (nocite.all) for (const key of items.keys()) listedKeys.add(key);
  else for (const key of nocite.keys) if (items.has(key)) listedKeys.add(key);

  const listed = [...listedKeys].map((key) => items.get(key) as CslItem).sort(compareItems);

  // Year letters for items that read the same in the text.
  const groups = new Map<string, CslItem[]>();
  for (const item of listed) {
    const label = `${inTextAuthor(item)}\u0000${yearOf(item) ?? ''}`;
    const group = groups.get(label);
    if (group) group.push(item);
    else groups.set(label, [item]);
  }
  const labels = new Map<string, { author: string; year: string }>();
  for (const group of groups.values()) {
    group.forEach((item, index) => {
      const base = yearOf(item);
      const letter = group.length > 1 ? yearLetter(index) : '';
      const year = base === null ? (letter ? `n.d.-${letter}` : 'n.d.') : `${base}${letter}`;
      labels.set(item.id, { author: inTextAuthor(item), year });
    });
  }

  const references = listed.map((item): ReferenceEntry => {
    const entry = formatEntry(
      item.page ? { ...item, page: collapsePageRanges(item.page) } : item,
      labels.get(item.id)?.year ?? 'n.d.',
    );
    return { key: item.id, html: entry.html, text: entry.text };
  });

  const linkCitations = truthy(metadata['link-citations']);
  const suppressBibliography = truthy(metadata['suppress-bibliography']);
  const signature = hashString(
    JSON.stringify([
      linkCitations,
      suppressBibliography,
      keys,
      [...labels].map(([key, label]) => [key, label.author, label.year]),
      references.map((reference) => reference.html),
    ]),
  );
  return {
    kind: 'citation-plan',
    items,
    keys,
    labels,
    references,
    linkCitations,
    suppressBibliography,
    signature,
  };
}

// ---- the text of a citation ----------------------------------------------------------------

/** What a label of a locator is printed as (Pandoc, Chicago author-date). */
const LOCATOR_LABELS: Array<[RegExp, string]> = [
  [/^§§\s*/, 'secs. '],
  [/^§\s*/, 'sec. '],
  [/^chapters?\.?\s+/i, 'chap. '],
  [/^sections?\s+/i, 'sec. '],
  [/^paragraphs?\s+/i, 'para. '],
  [/^volumes?\s+/i, 'vol. '],
  [/^figures?\s+/i, 'fig. '],
  [/^ll\.\s*/, 'lines '],
  [/^l\.\s*/, 'line '],
];
const PAGE_LABEL = /^(?:pp?\.|pages?)\s*(?=[\dIVXLCivxlc])/;
/** A suffix that starts with a locator label and a number: "p. 5", "ch. 2", "sec. 3". */
const LOCATOR_START =
  /^(?:[A-Za-z]{1,12}\.|§§?|pages?|chapters?|sections?|paragraphs?|volumes?|figures?|lines?)\s*[\dIVXLCivxlc]/;

function normalizeLocator(locator: string): string {
  const text = locator.trim();
  const page = PAGE_LABEL.exec(text);
  if (page) return collapsePageRanges(text.slice(page[0].length));
  for (const [pattern, replacement] of LOCATOR_LABELS) {
    const match = pattern.exec(text);
    if (match) return replacement + text.slice(match[0].length);
  }
  // No label: a bare number or range is a page locator.
  return collapsePageRanges(text);
}

/** The text after the year: ", 33", ", ch. 2", " and others". */
function suffixText(item: CitationItem): string {
  if (item.suffix === '') return '';
  if (item.comma || LOCATOR_START.test(item.suffix)) return `, ${normalizeLocator(item.suffix)}`;
  return ` ${item.suffix}`;
}

export interface CitationText {
  /** Plain text, as printed. */
  text: string;
  /** HTML (escaped), with links when the document sets `link-citations`. */
  html: string;
  keys: string[];
  missing: boolean;
  /** Some key waits for a bibliography that is still loading. */
  pending?: boolean;
}

interface Piece {
  text: string;
  html: string;
}

function piece(text: string, linkKey?: string): Piece {
  const html = escapeHtml(text);
  return {
    text,
    html: linkKey === undefined ? html : `<a href="#ref-${escapeHtml(linkKey)}">${html}</a>`,
  };
}

function concat(...pieces: Piece[]): Piece {
  return {
    text: pieces.map((p) => p.text).join(''),
    html: pieces.map((p) => p.html).join(''),
  };
}

function textPiece(text: string): Piece {
  return { text, html: escapeHtml(text) };
}

/** The printed text of one parsed citation. */
export function citationText(citation: ParsedCitation, plan: CitationPlan): CitationText {
  const link = (key: string) => (plan.linkCitations ? key : undefined);
  let missing = false;
  let pending = false;
  const unknown = (key: string): string => {
    if (plan.pending) {
      pending = true;
      return `@${key}`;
    }
    missing = true;
    return `@${key}?`;
  };
  const labelOf = (key: string) => {
    const known = plan.labels.get(key);
    if (known) return known;
    const item = plan.items.get(key);
    return item ? { author: inTextAuthor(item), year: yearOf(item) ?? 'n.d.' } : undefined;
  };

  if (citation.narrative) {
    const item = citation.items[0] as CitationItem;
    const label = labelOf(item.key);
    if (!label) {
      const p = textPiece(unknown(item.key));
      return { ...p, keys: [item.key], missing, pending };
    }
    const inner = piece(`${label.year}${suffixText(item)}`, link(item.key));
    const p = concat(textPiece(label.author ? `${label.author} (` : '('), inner, textPiece(')'));
    return { ...p, keys: [item.key], missing, pending };
  }

  const rendered: Piece[] = [];
  let previousAuthor: string | null = null;
  let previousHadSuffix = false;
  citation.items.forEach((item, index) => {
    const label = labelOf(item.key);
    const prefix = item.prefix === '' ? '' : `${item.prefix} `;
    if (!label) {
      rendered.push(
        concat(textPiece(prefix), textPiece(unknown(item.key)), textPiece(suffixText(item))),
      );
      previousAuthor = null;
      previousHadSuffix = false;
      return;
    }
    const collapse =
      index > 0 &&
      previousAuthor !== null &&
      previousAuthor === label.author &&
      item.prefix === '' &&
      !item.suppressAuthor &&
      label.author !== '';
    const body =
      collapse || item.suppressAuthor || label.author === ''
        ? `${label.year}${suffixText(item)}`
        : `${label.author}${label.year.startsWith('n.d.') ? ',' : ''} ${label.year}${suffixText(item)}`;
    const part = concat(textPiece(prefix), piece(body, link(item.key)));
    if (collapse) {
      const separator = previousHadSuffix ? '; ' : ', ';
      rendered[rendered.length - 1] = concat(
        rendered[rendered.length - 1] as Piece,
        textPiece(separator),
        part,
      );
    } else {
      rendered.push(part);
    }
    previousAuthor = item.suppressAuthor ? null : label.author;
    previousHadSuffix = item.suffix !== '';
  });

  const joined = rendered.map((p) => p.text).join('; ');
  const joinedHtml = rendered.map((p) => p.html).join('; ');
  return {
    text: `(${joined})`,
    html: `(${joinedHtml})`,
    keys: citation.items.map((item) => item.key),
    missing,
    pending,
  };
}

// ---- markdown-it ---------------------------------------------------------------------------

function planOf(env: Env | undefined, fallback: DocContext | undefined): CitationPlan {
  const context = wdEnv(env).context ?? fallback ?? null;
  const bibliography = context?.bibliography;
  return isCitationPlan(bibliography) ? bibliography : EMPTY_PLAN;
}

/**
 * The inline rule and the renderer. `context` is used when the pipeline gives none (tests); the
 * pipeline's own context is `wdEnv(env).context`.
 */
export function installCitations(md: MarkdownIt, context?: DocContext): void {
  md.inline.ruler.before('link', 'wd_citation', (state: StateInline, silent: boolean) => {
    const char = state.src.charCodeAt(state.pos);
    if (char !== 0x5b && char !== 0x40) return false;
    const plan = planOf(state.env, context);
    const found =
      char === 0x5b
        ? parseBracketCitation(state.src, state.pos)
        : parseNarrativeCitation(state.src, state.pos);
    if (!found) return false;
    if (found.items.some((item) => item.mmd && !plan.items.has(item.key))) return false;
    // `(@label)` that names an example of the document is a reference to it, not a citation.
    if (
      char === 0x40 &&
      state.pos > 0 &&
      state.src.charCodeAt(state.pos - 1) === 0x28 &&
      state.src.charCodeAt(found.end) === 0x29 &&
      wdEnv(state.env).context?.labels.has(`ex:${(found.items[0] as CitationItem).key}`)
    ) {
      return false;
    }
    // A citation group stays inside the inline content (a bracket that closes after the end of
    // the span being parsed, for example inside emphasis, is not read).
    if (found.end > state.posMax) return false;
    if (!silent) {
      const text = citationText(found, plan);
      const token = state.push('citation', '', 0);
      token.content = text.text;
      token.meta = {
        html: text.html,
        keys: text.keys,
        missing: text.missing,
        pending: text.pending === true,
      };
    }
    state.pos = found.end;
    return true;
  });

  md.renderer.rules.citation = (tokens, index) => {
    const token = tokens[index];
    const meta = token?.meta as {
      html: string;
      keys: string[];
      missing: boolean;
      pending: boolean;
    };
    const classes = meta.pending
      ? 'citation is-pending'
      : meta.missing
        ? 'citation citation-missing'
        : 'citation';
    return `<span class="${classes}" data-cites="${escapeHtml(meta.keys.join(' '))}">${meta.html}</span>`;
  };
}

// ---- the reference list --------------------------------------------------------------------

/** The entries of the reference list: `div.reference#ref-<key>`, or '' when it is suppressed. */
export function renderReferenceEntries(plan: CitationPlan): string {
  if (plan.suppressBibliography) return '';
  return plan.references
    .map(
      (reference) =>
        `<div class="reference" id="ref-${escapeHtml(reference.key)}">${reference.html}</div>`,
    )
    .join('\n');
}

/**
 * The whole list, `div.references#refs > div.reference`, with an `h1` when a title is given
 * (`reference-section-title`). Empty when the plan suppresses it or has no entries.
 */
export function renderReferenceList(plan: CitationPlan, title?: string): string {
  const entries = renderReferenceEntries(plan);
  if (entries === '') return '';
  const heading = title ? `<h1>${escapeHtml(title)}</h1>\n` : '';
  return `${heading}<div class="references" id="refs">\n${entries}\n</div>`;
}

/** The completion entries for the editor: `{ key, label: 'Author Year', detail: title }`. */
export function citationCompletions(
  bibliography: { items: ReadonlyMap<string, CslItem> } | null,
): CitationEntry[] {
  if (!bibliography) return [];
  const entries: CitationEntry[] = [];
  for (const item of bibliography.items.values()) {
    const entry: CitationEntry = { key: item.id, label: shortLabel(item) };
    if (item.title) entry.detail = item.title;
    entries.push(entry);
  }
  return entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
