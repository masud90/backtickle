/**
 * The header and the `#|` option lines of a Quarto / R Markdown code chunk:
 *
 *   ```{r label, echo=FALSE}      R Markdown: language, a label, options after commas
 *   ```{python}                   Quarto: the language alone
 *   #| label: fig-x               Quarto: options as YAML in comment lines at the top
 *   #| fig-cap: "A caption"
 *
 * Nothing here runs anything: the text is only read. Values stay text (`FALSE` is shown as
 * written), except that the YAML of `#|` lines is read with js-yaml (core schema, no code tags).
 */
import { load } from 'js-yaml';
import { BRACED, parseAttributes } from '../pandoc/attributes';

export interface Chunk {
  lang: string;
  /** The chunk's label, or ''. */
  label: string;
  /** The options as shown in the header pills (the label is not one of them), in order. */
  options: Array<[string, string]>;
  /** The code without its `#|` lines. */
  code: string;
  /** The figure caption, or null when the chunk has none. */
  figCap: string | null;
  /** True when the caption came from bookdown's `fig.cap`. */
  bookdown: boolean;
  lstLabel: string;
  lstCap: string;
}

const HEADER = /^\{\s*([A-Za-z][\w+-]*)((?:[\s,][\s\S]*)?)\}$/;
const MAX_OPTIONS = 40;

/** Splits at the commas that are not inside quotes or brackets. */
function splitPieces(text: string): string[] {
  const pieces: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (quote !== '') {
      if (char === '\\') i++;
      else if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(' || char === '[' || char === '{') {
      depth++;
    } else if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1);
    } else if (char === ',' && depth === 0) {
      pieces.push(text.slice(start, i));
      start = i + 1;
    }
  }
  pieces.push(text.slice(start));
  return pieces;
}

function unquote(value: string): string {
  const text = value.trim();
  if (text.length >= 2) {
    const first = text.charAt(0);
    if ((first === '"' || first === "'") && text.endsWith(first)) return text.slice(1, -1);
  }
  return text;
}

/** One option value as text for a pill. */
function show(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

/** The `#|` lines at the top of the code, and the code after them. */
function splitOptionLines(code: string): { lines: string[]; rest: string } {
  const lines: string[] = [];
  let offset = 0;
  while (offset < code.length) {
    const stop = code.indexOf('\n', offset);
    const end = stop === -1 ? code.length : stop;
    const line = code.slice(offset, end);
    if (!line.startsWith('#|')) break;
    lines.push(line.slice(2).replace(/^ /, ''));
    offset = stop === -1 ? code.length : stop + 1;
  }
  return { lines, rest: code.slice(offset) };
}

function readOptionLines(lines: string[]): Array<[string, unknown]> {
  if (lines.length === 0) return [];
  try {
    const data = load(lines.join('\n'), { json: true, maxAliases: 10 });
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      return Object.entries(data as Record<string, unknown>).slice(0, MAX_OPTIONS);
    }
  } catch {
    // Not YAML: show each line as it is.
  }
  return lines
    .filter((line) => line.trim() !== '')
    .slice(0, MAX_OPTIONS)
    .map((line): [string, unknown] => [line.trim(), '']);
}

/**
 * The chunk the info string of a fence describes, or null when it is not a chunk header (a plain
 * language word, or Pandoc attributes `{.python #id}`, or a raw format `{=html}`).
 */
export function parseChunk(info: string, content: string): Chunk | null {
  const match = HEADER.exec(info.trim());
  if (!match) return null;
  const lang = (match[1] as string).toLowerCase();
  const rest = match[2] ?? '';
  const pieces = splitPieces(rest).map((piece) => piece.trim());

  let label = '';
  let figCap: string | null = null;
  let bookdown = false;
  let lstLabel = '';
  let lstCap = '';
  const options: Array<[string, string]> = [];

  const note = (key: string, value: string) => {
    const name = key.trim();
    const lower = name.toLowerCase();
    if (lower === 'label') {
      label = value;
      return;
    }
    if (lower === 'fig-cap' || lower === 'fig.cap') {
      figCap = value.replace(/\s+/g, ' ').trim();
      bookdown = lower === 'fig.cap';
    } else if (lower === 'lst-label') {
      lstLabel = value;
    } else if (lower === 'lst-cap') {
      lstCap = value;
    }
    if (options.length < MAX_OPTIONS) options.push([name, value]);
  };

  // The first piece without `=` is the label (`{r setup, echo=FALSE}`); `{r, echo=FALSE}` has none.
  const startsWithSpace = /^\s/.test(rest);
  let firstBare = '';
  pieces.forEach((piece, index) => {
    if (piece === '') return;
    if (piece.startsWith('#|')) {
      const text = piece.slice(2).trim();
      const colon = text.indexOf(':');
      if (colon > 0) note(text.slice(0, colon), unquote(text.slice(colon + 1)));
      else if (text !== '') options.push([text, '']);
      return;
    }
    const equals = piece.indexOf('=');
    if (equals > 0) {
      note(piece.slice(0, equals), unquote(piece.slice(equals + 1)));
    } else if (index === 0 && startsWithSpace) {
      firstBare = piece;
    } else {
      options.push([piece, '']);
    }
  });

  const { lines, rest: code } = splitOptionLines(content);
  for (const [key, value] of readOptionLines(lines)) note(key, show(value));
  if (label === '' && firstBare !== '') label = firstBare;
  // `label` from the header is not shown as an option; keep the order of the others.
  return { lang, label, options, code, figCap, bookdown, lstLabel, lstCap };
}

/** True when the chunk makes a figure (a caption, or a label that starts with `fig-`). */
export function isFigureChunk(chunk: Chunk): boolean {
  return chunk.figCap !== null || chunk.label.startsWith('fig-');
}

/** The cross-reference key of a figure chunk, or null when it has no label. */
export function chunkFigureKey(chunk: Chunk): string | null {
  if (!isFigureChunk(chunk) || chunk.label === '') return null;
  if (chunk.label.startsWith('fig-')) return chunk.label;
  return chunk.bookdown ? `fig:${chunk.label}` : `fig-${chunk.label}`;
}

/** The key of a listing (a chunk with `lst-label`, or a `lst-` label), or null. */
export function chunkListingKey(chunk: Chunk): string | null {
  if (chunk.lstLabel !== '') return chunk.lstLabel;
  if (chunk.label.startsWith('lst-')) return chunk.label;
  return null;
}

/**
 * A plain fenced block that is a listing: ```` ```{#lst-x .python lst-cap="A caption"} ````
 * (Quarto 1.9). Returns the label key and the caption, or null.
 */
export function plainListing(info: string): { key: string; cap: string } | null {
  const text = info.trim();
  const braced = BRACED.exec(text);
  if (!braced || braced[0].length !== text.length) return null;
  const attrs = parseAttributes(braced[1] ?? '');
  if (!attrs) return null;
  if (attrs.raw !== '' || !attrs.id.startsWith('lst-')) return null;
  const cap = attrs.pairs.find(([key]) => key === 'lst-cap')?.[1] ?? '';
  return { key: attrs.id, cap: cap.replace(/\s+/g, ' ').trim() };
}
