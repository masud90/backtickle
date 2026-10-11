/**
 * Cross-reference targets: a cheap scan of the
 * whole source (the `prepare` step) that finds every figure, table, equation, section and listing
 * with a label and numbers each kind in document order. `render` only reads the result.
 *
 * Label keys as the document writes them: Quarto `fig-x`, `tbl-x`, `eq-x`, `sec-x`, `lst-x`;
 * bookdown `fig:x`, `tab:x`, `eq:x` and a plain heading id (`results`). The id of the element in
 * the page is the key with `:` replaced by `-`. Headings also get an entry `secnum:<line>` with
 * their number, which the heading rule reads when `number-sections` is on.
 */
import type { Label } from '../../types';
import { type Attributes, parseAttributes } from '../pandoc/attributes';
import { parseOpener } from '../pandoc/divs';
import { chunkFigureKey, chunkListingKey, parseChunk, plainListing } from './chunk-parse';

/** Where a scanned line came from when included files were put in: the line of the document. */
export interface LineOrigin {
  line: number;
  included: boolean;
}

export type LabelKind = 'fig' | 'tbl' | 'sec' | 'eq' | 'lst';

const KINDS: Record<string, LabelKind> = {
  fig: 'fig',
  tbl: 'tbl',
  sec: 'sec',
  eq: 'eq',
  lst: 'lst',
};

/** `fig` for `Fig` or `fig`: the kind a cross-reference prefix names, or undefined. */
export function kindOfPrefix(prefix: string): LabelKind | undefined {
  return KINDS[prefix.toLowerCase()];
}

/** The id of the page element for a label key. */
export function idOfKey(key: string): string {
  return key.replace(/:/g, '-');
}

const DEFAULT_PREFIX: Record<LabelKind, string> = {
  fig: 'Figure',
  tbl: 'Table',
  sec: 'Section',
  eq: 'Equation',
  lst: 'Listing',
};

export interface CrossrefOptions {
  numberSections: boolean;
  /** The word before a number in a reference (`fig-prefix`), by kind. */
  prefix: Record<LabelKind, string>;
  /** The word before a number in a caption (`fig-title`), by kind. */
  title: Record<LabelKind, string>;
  delim: string;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** The options of the `crossref` metadata (`fig-prefix`, `tbl-title`, `title-delim`, ...). */
export function crossrefOptions(metadata: Record<string, unknown>): CrossrefOptions {
  const crossref =
    typeof metadata.crossref === 'object' &&
    metadata.crossref !== null &&
    !Array.isArray(metadata.crossref)
      ? (metadata.crossref as Record<string, unknown>)
      : {};
  const prefix = { ...DEFAULT_PREFIX };
  const title = { ...DEFAULT_PREFIX };
  for (const kind of Object.keys(DEFAULT_PREFIX) as LabelKind[]) {
    const custom = text(crossref[`${kind}-prefix`]);
    if (custom !== null) prefix[kind] = custom;
    const caption = text(crossref[`${kind}-title`]);
    if (caption !== null) title[kind] = caption;
  }
  return {
    numberSections: metadata['number-sections'] === true,
    prefix,
    title,
    delim: text(crossref['title-delim']) ?? ':',
  };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * The text of a reference: "Figure 1" (`@fig-x`), "Figure 1" with a capital (`@Fig-x`), or the
 * number alone (`[-@fig-x]`, bookdown `\@ref()`). A section reads "Section" and its number whether or
 * not `number-sections` is on (Quarto 1.9); an unnumbered section has no number to show.
 */
export function referenceText(
  label: Label,
  options: CrossrefOptions,
  form: { suppress?: boolean; capital?: boolean } = {},
): string {
  if (form.suppress) return label.kind === 'sec' && label.number === '' ? label.text : label.number;
  const prefix = options.prefix[label.kind as LabelKind] ?? '';
  const word = form.capital ? capitalize(prefix) : prefix;
  return word === '' ? label.number : `${word} ${label.number}`;
}

/** The label that starts a caption: "Figure 1:" (or "Figure 1" for an empty caption). */
export function captionLabel(label: Label, options: CrossrefOptions, empty: boolean): string {
  const word = options.title[label.kind as LabelKind] ?? '';
  const head = word === '' ? label.number : `${word} ${label.number}`;
  return empty ? head : `${head}${options.delim}`;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*$/;
const TRAILING_ATTRS = /[ \t]*\{((?:[^{}"\\\n]|"(?:[^"\\\n]|\\.)*"|\\.)*)\}[ \t]*$/u;
const IMAGE_ATTRS = /!\[((?:[^\]\\]|\\.)*)\]\((?:[^)\\]|\\.)*\)\{([^}]*)\}/g;
const CAPTION_LINE = /^(?:Table)?:[ \t]+(.*)$/;
const BOOKDOWN_TABLE = /^\(\\#(tab:[^)\s]+)\)[ \t]*(.*)$/;
const EQUATION_END = /\$\$[ \t]*\{#(eq[-:][^\s{}]+)[^}]*\}[ \t]*$/;
const BOOKDOWN_EQUATION = /\(\\#(eq:[^)\s]+)\)/;

interface DivState {
  tabset: boolean;
  callout: boolean;
  /** True until the first line of content: a heading there is the callout title. */
  titleCandidate: boolean;
  tabLevel: number;
}

function stripInline(value: string): string {
  return value.replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Finds the cross-reference targets of the source. `lines` are the lines of the whole source;
 * `numberSections` is the document's `number-sections`.
 */
export function scanLabels(
  lines: readonly string[],
  numberSections: boolean,
  origin?: readonly LineOrigin[],
): Map<string, Label> {
  const labels = new Map<string, Label>();
  const counters: Record<'fig' | 'tbl' | 'eq' | 'lst', number> = {
    fig: 0,
    tbl: 0,
    eq: 0,
    lst: 0,
  };
  const sections = [0, 0, 0, 0, 0, 0];
  const divs: DivState[] = [];

  const add = (key: string, kind: 'fig' | 'tbl' | 'eq' | 'lst', caption: string, line: number) => {
    if (labels.has(key)) return;
    counters[kind]++;
    labels.set(key, {
      kind,
      number: String(counters[kind]),
      text: caption,
      line,
    });
  };

  let first = 0;
  if (lines[0]?.trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[i] as string)) {
        first = i + 1;
        break;
      }
    }
  }

  for (let i = first; i < lines.length; i++) {
    const line = lines[i] as string;
    const marks = FENCE.exec(line)?.[1];
    if (marks) {
      const info = line.slice(line.indexOf(marks) + marks.length).trim();
      let end = i + 1;
      const body: string[] = [];
      for (; end < lines.length; end++) {
        const row = lines[end] as string;
        const closing = FENCE.exec(row)?.[1];
        if (
          closing?.startsWith(marks.charAt(0)) &&
          closing.length >= marks.length &&
          row.slice(row.indexOf(closing) + closing.length).trim() === ''
        ) {
          break;
        }
        body.push(row);
      }
      const chunk = parseChunk(info, body.join('\n'));
      if (chunk) {
        const figure = chunkFigureKey(chunk);
        if (figure) add(figure, 'fig', chunk.figCap ?? '', i);
        const listing = chunkListingKey(chunk);
        if (listing) add(listing, 'lst', chunk.lstCap, i);
      } else {
        const plain = plainListing(info);
        if (plain) add(plain.key, 'lst', plain.cap, i);
      }
      const holder = divs.at(-1);
      if (holder) holder.titleCandidate = false;
      i = end;
      continue;
    }

    if (line.startsWith(':::')) {
      if (/^:{3,}[ \t]*$/.test(line)) {
        divs.pop();
      } else {
        const attrs = parseOpener(line);
        if (attrs) {
          const callout = attrs.classes.some((name) => name.startsWith('callout-'));
          divs.push({
            tabset: attrs.classes.includes('panel-tabset'),
            callout,
            titleCandidate: callout && !attrs.pairs.some(([key]) => key === 'title'),
            tabLevel: 0,
          });
        }
      }
      continue;
    }

    const top = divs.at(-1);
    const heading = HEADING.exec(line);
    if (heading) {
      const level = (heading[1] as string).length;
      let body = (heading[2] as string).replace(/[ \t]+#+$/, '');
      let attrs: Attributes | null = null;
      const trailing = TRAILING_ATTRS.exec(body);
      if (trailing && trailing.index > 0) {
        const parsed = parseAttributes(trailing[1] ?? '');
        if (parsed?.raw === '') {
          attrs = parsed;
          body = body.slice(0, trailing.index);
        }
      }
      let skip = false;
      if (top?.callout && top.titleCandidate) {
        skip = true;
      } else if (top?.tabset) {
        if (top.tabLevel === 0) top.tabLevel = level;
        if (level === top.tabLevel) skip = true;
      }
      if (top) top.titleCandidate = false;
      if (skip) continue;
      const unnumbered = attrs?.classes.includes('unnumbered') ?? false;
      let number = '';
      if (!unnumbered) {
        sections[level - 1] = (sections[level - 1] ?? 0) + 1;
        for (let deeper = level; deeper < sections.length; deeper++) sections[deeper] = 0;
        number = sections.slice(0, level).join('.');
      }
      const here = origin?.[i];
      if (number !== '' && numberSections && !here?.included) {
        labels.set(`secnum:${here?.line ?? i}`, {
          kind: 'sec',
          number,
          text: '',
          line: here?.line ?? i,
        });
      }
      const id = attrs?.id ?? '';
      if (id !== '' && !labels.has(id)) {
        labels.set(id, {
          kind: 'sec',
          number,
          text: stripInline(body),
          line: i,
        });
      }
      continue;
    }
    if (top && line.trim() !== '') top.titleCandidate = false;
    if (!line.includes('{#') && !line.includes('(\\#') && !CAPTION_LINE.test(line)) continue;

    for (const match of line.matchAll(IMAGE_ATTRS)) {
      const attrs = parseAttributes(match[2] ?? '');
      if (attrs?.id.startsWith('fig-')) add(attrs.id, 'fig', stripInline(match[1] ?? ''), i);
    }
    const caption = CAPTION_LINE.exec(line);
    if (caption) {
      const body = caption[1] as string;
      const bookdown = BOOKDOWN_TABLE.exec(body);
      if (bookdown) {
        add(bookdown[1] as string, 'tbl', stripInline(bookdown[2] ?? ''), i);
      } else {
        const trailing = TRAILING_ATTRS.exec(body);
        const attrs = trailing ? parseAttributes(trailing[1] ?? '') : null;
        if (trailing && attrs?.id.startsWith('tbl-')) {
          add(attrs.id, 'tbl', stripInline(body.slice(0, trailing.index)), i);
        }
      }
    }
    const equation = EQUATION_END.exec(line) ?? BOOKDOWN_EQUATION.exec(line);
    if (equation) add(equation[1] as string, 'eq', '', i);
  }
  return labels;
}

const optionsCache = new WeakMap<object, CrossrefOptions>();

/** The cross-reference options of a document context (remembered per context). */
export function optionsOf(
  context: { metadata: Record<string, unknown> } | null | undefined,
): CrossrefOptions {
  if (!context) return crossrefOptions({});
  let options = optionsCache.get(context);
  if (!options) {
    options = crossrefOptions(context.metadata);
    optionsCache.set(context, options);
  }
  return options;
}
