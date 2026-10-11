/**
 * What a paste should do, decided from plain facts so it can be tested without an
 * editor or a converter. The order of the rules is the order of the spec.
 */
import type { FlavorId } from '../flavor';

export interface PasteFacts {
  /** `text/plain` of the clipboard. */
  text: string;
  /** `text/html` of the clipboard, or ''. */
  html: string;
  flavor: FlavorId;
  /** The selected text of the main selection ('' for a caret). */
  selectedText: string;
  /** The selection already is, or lies inside, a link. */
  selectionIsLink: boolean;
  /** The paste position is in a fenced block, a chunk, inline code or frontmatter. */
  inCode: boolean;
}

export type PasteDecision =
  | { kind: 'link'; url: string }
  | { kind: 'table-html' }
  | { kind: 'table-tsv'; rows: string[][] }
  | { kind: 'html' }
  | { kind: 'plain' };

const URL_RE = /^(?:https?:\/\/|mailto:)\S+$/i;

/** The URL when the clipboard text is exactly one http, https or mailto URL. */
export function singleUrl(text: string): string | null {
  const trimmed = text.trim();
  return URL_RE.test(trimmed) ? trimmed : null;
}

/** HTML that Excel puts on the clipboard. */
export function isExcelHtml(html: string): boolean {
  return (
    /xmlns:x\s*=\s*["']?urn:schemas-microsoft-com:office:excel/i.test(html) ||
    /<meta[^>]*name\s*=\s*["']?ProgId["']?[^>]*content\s*=\s*["']?Excel/i.test(html)
  );
}

/**
 * Rows of cells when `text` is tab-separated with at least 2 rows and 2 columns and the same
 * column count in every row; otherwise null.
 */
export function tsvRows(text: string): string[][] | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length < 2) return null;
  const rows = lines.map((line) => line.split('\t'));
  const width = rows[0]?.length ?? 0;
  if (width < 2) return null;
  return rows.every((row) => row.length === width) ? rows : null;
}

export function decidePaste(facts: PasteFacts): PasteDecision {
  const { text, html, selectedText } = facts;
  if (facts.inCode) return { kind: 'plain' };
  const url = singleUrl(text);
  if (url && selectedText !== '' && !selectedText.includes('\n') && !facts.selectionIsLink) {
    return { kind: 'link', url };
  }
  if (html && isExcelHtml(html)) return { kind: 'table-html' };
  if (!html.trim()) {
    const rows = tsvRows(text);
    if (rows) return { kind: 'table-tsv', rows };
    return { kind: 'plain' };
  }
  return { kind: 'html' };
}
