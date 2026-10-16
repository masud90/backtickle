/** Pure helpers for documents: names, labels, sizes. Nothing here touches the DOM or the platform. */
import { parentFolder } from '@/lib/paths';
import type { Encoding, LineEnding } from '@/lib/platform';

export const UNTITLED = 'Untitled';
export const GUIDE_NAME = 'Markdown Guide';

/** The last segment of a path. */
export function fileName(path: string): string {
  const name = path.split(/[\\/]/).filter(Boolean).pop();
  return name ?? path;
}

/** The folder of a path, or null when it has none. */
export function directoryOf(path: string): string | null {
  return parentFolder(path);
}

/**
 * The name of a new untitled document: "Untitled", then "Untitled 2", "Untitled 3" and so on,
 * the lowest number that no open untitled document uses.
 */
export function nextUntitledName(taken: readonly string[]): string {
  const used = new Set(taken);
  if (!used.has(UNTITLED)) return UNTITLED;
  for (let n = 2; ; n++) {
    const candidate = `${UNTITLED} ${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Removes the inline Markdown that makes a heading hard to read as a file name. */
function plainHeading(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/<[^>]+>/g, '');
}

/** The text of the first heading outside frontmatter and code fences, or null. */
export function firstHeading(text: string): string | null {
  const lines = text.slice(0, 20_000).split(/\r?\n/);
  let index = 0;
  if (lines[0]?.trim() === '---') {
    const close = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line));
    if (close > 0) index = close + 1;
  }
  let fence: string | null = null;
  for (; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (fence === null) fence = marker[0] ?? null;
      else if (marker[0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const heading = /^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line)?.[1];
    if (heading) {
      const plain = plainHeading(heading).trim();
      if (plain) return plain;
    }
  }
  return null;
}

const MAX_NAME_LENGTH = 80;

/** The file name Save As suggests: the first heading, else "Untitled", with the `.md` extension. */
export function suggestSaveName(text: string): string {
  const heading = firstHeading(text);
  let base = Array.from(heading ?? '')
    .filter((char) => char.charCodeAt(0) >= 32)
    .join('')
    // macOS reserves "/" and ":"; the rest are awkward in file names.
    .replace(/[/\\:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .trim();
  if (base.length > MAX_NAME_LENGTH) base = base.slice(0, MAX_NAME_LENGTH).trim();
  return `${base || UNTITLED}.md`;
}

/** A readable message for an error from the platform, the mock or the browser. */
export function errorMessage(error: unknown): string {
  if (typeof error === 'string' && error !== '') return error;
  if (error instanceof Error && error.message !== '') return error.message;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string' &&
    (error as { message: string }).message !== ''
  ) {
    return (error as { message: string }).message;
  }
  return 'Something went wrong.';
}

/** True for the error the platform uses when the user cancelled a dialog. */
export function isCancelled(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'cancelled'
  );
}

// ---- labels ---------------------------------------------------------------------------------

const LEGACY_WORDS: Record<string, string> = {
  windows: 'Windows',
  iso: 'ISO',
  utf: 'UTF',
  euc: 'EUC',
  koi8: 'KOI8',
  gbk: 'GBK',
  gb18030: 'GB18030',
  big5: 'Big5',
  macintosh: 'Macintosh',
  shift_jis: 'Shift JIS',
  ibm866: 'IBM866',
};

/** The name of a legacy encoding as a person writes it: "Windows-1252", "ISO-8859-2". */
export function legacyEncodingLabel(name: string): string {
  return name
    .split('-')
    .map((part, index) => {
      const known = LEGACY_WORDS[part.toLowerCase()];
      if (known) return known;
      if (index === 0) return part.charAt(0).toUpperCase() + part.slice(1);
      return part.toUpperCase();
    })
    .join('-');
}

/** What the status bar shows for the encoding a document is saved in. */
export function encodingLabel(encoding: Encoding, legacyEncoding: string | null): string {
  if (legacyEncoding) return legacyEncodingLabel(legacyEncoding);
  switch (encoding) {
    case 'utf-8':
      return 'UTF-8';
    case 'utf-8-bom':
      return 'UTF-8 with BOM';
    case 'utf-16le':
      return 'UTF-16 LE';
    case 'utf-16be':
      return 'UTF-16 BE';
  }
}

export function lineEndingLabel(lineEnding: LineEnding): string {
  return lineEnding === 'crlf' ? 'CRLF' : 'LF';
}

const NUMBER = new Intl.NumberFormat('en-US');

/** A count with en-US grouping: 1,420. */
export function formatCount(value: number): string {
  return NUMBER.format(value);
}

/** A file size in decimal units, as Finder shows it: "812 bytes", "3.4 KB", "124 KB", "1.2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 'bytes';
  for (const next of units) {
    value /= 1000;
    unit = next;
    if (value < 1000) break;
  }
  const rounded = value < 100 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${rounded} ${unit}`;
}
