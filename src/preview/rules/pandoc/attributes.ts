/**
 * Pandoc attributes `{#id .class key=value}`: the parser, and what a
 * document may do with them. Classes become `doc-<name>` so that a document can never claim a
 * class of the app; `key=value` pairs are dropped except `width` and `height`, which are kept as
 * `data-wd-width` and `data-wd-height` (applied after sanitizing, see `enhance.ts`).
 */
import type { Token } from 'markdown-it';

export interface Attributes {
  id: string;
  classes: string[];
  pairs: Array<[string, string]>;
  /** The format of a raw attribute `{=html}`, or ''. */
  raw: string;
}

/** The inside of braces (no nested braces, quoted values may hold any character). */
export const BRACED = /^\{((?:[^{}"\\]|"(?:[^"\\]|\\.)*"|\\.)*)\}/su;

const ID = /^[^\s{}"'`<>&]+$/u;
const CLASS = /^[\p{L}\p{N}_:.-]+$/u;
const KEY = /^[A-Za-z_:][\w:.-]*$/;
const SIZE = /^(\d+(?:\.\d+)?)(px|%|em)?$/;

/** Parses the text between the braces, or null when it is not a valid attribute list. */
export function parseAttributes(text: string): Attributes | null {
  const attrs: Attributes = { id: '', classes: [], pairs: [], raw: '' };
  let rest = text.trim();
  if (rest === '') return null;
  if (rest === '-') {
    attrs.classes.push('unnumbered');
    return attrs;
  }
  while (rest !== '') {
    const char = rest.charAt(0);
    if (char === '#') {
      const word = /^#([^\s{}]+)/u.exec(rest);
      if (!word?.[1] || !ID.test(word[1])) return null;
      attrs.id = word[1];
      rest = rest.slice(word[0].length);
    } else if (char === '.') {
      const word = /^\.([^\s{}=]+)/u.exec(rest);
      if (!word?.[1]) return null;
      attrs.classes.push(word[1]);
      rest = rest.slice(word[0].length);
    } else if (char === '=') {
      const word = /^=([A-Za-z0-9_-]+)\s*$/.exec(rest);
      if (!word?.[1]) return null;
      attrs.raw = word[1].toLowerCase();
      rest = '';
    } else {
      const pair = /^([^\s=#.{}"'][^\s={}"']*)=(?:"((?:[^"\\]|\\.)*)"|([^\s{}"']+))/su.exec(rest);
      if (!pair?.[1]) return null;
      const value = pair[2] !== undefined ? pair[2].replace(/\\(.)/gsu, '$1') : (pair[3] ?? '');
      if (KEY.test(pair[1])) attrs.pairs.push([pair[1].toLowerCase(), value]);
      rest = rest.slice(pair[0].length);
    }
    rest = rest.replace(/^\s+/u, '');
  }
  return attrs;
}

/** A width or height from a document as `50%`, `300px` or `2em`; a bare number is pixels. */
export function normalizeSize(value: string): string | null {
  const match = SIZE.exec(value.trim());
  if (!match?.[1]) return null;
  const number = Number(match[1]);
  if (!(number > 0) || number > 100_000) return null;
  const unit = match[2] ?? 'px';
  if (unit === '%' && number > 100) return null;
  return `${match[1]}${unit}`;
}

/** The class names a document may add: namespaced, and only characters that cannot break out. */
export function docClasses(classes: readonly string[]): string[] {
  return classes.filter((name) => CLASS.test(name)).map((name) => `doc-${name}`);
}

/** Puts the attributes of a document on a token (id, namespaced classes, width and height). */
export function applyAttributes(token: Token, attrs: Attributes): void {
  if (attrs.id !== '') token.attrSet('id', attrs.id);
  const classes = docClasses(attrs.classes);
  if (classes.length > 0) token.attrJoin('class', classes.join(' '));
  for (const [key, value] of attrs.pairs) {
    if (key !== 'width' && key !== 'height') continue;
    const size = normalizeSize(value);
    if (size !== null) token.attrSet(`data-wd-${key}`, size);
  }
}

/** True if the class list has this class (as written in the document, without the prefix). */
export function hasClass(attrs: Attributes | null | undefined, name: string): boolean {
  return attrs?.classes.includes(name) ?? false;
}
