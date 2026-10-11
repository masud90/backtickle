/**
 * Autolink literals as the GFM spec defines them (section "Autolinks (extension)"), replacing
 * markdown-it's linkify, which differs in several details:
 *
 * - `www.` followed by a valid domain links to `http://www...`; a bare domain does not link.
 * - `http://`, `https://` and `ftp://` followed by a valid domain link as they are.
 * - An email address links to `mailto:`.
 * - Trailing punctuation (`?`, `!`, `.`, `,`, `:`, `*`, `_`, `~`, quotes) and a trailing `;` are
 *   not part of the link; an entity-like `&name;` at the end is cut off as a whole; unmatched
 *   closing parentheses at the end are cut off; `<` ends a link.
 *
 * A valid domain is made of segments of letters, digits, underscores and hyphens separated by
 * periods, with at least one period (not for a scheme URL), and no underscore in the last two
 * segments. The rule runs on the text tokens of every inline run, except inside links.
 */
import type { MarkdownIt, StateCore, Token } from 'markdown-it';

interface Match {
  start: number;
  end: number;
  href: string;
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

function isLetterOrDigit(char: string | undefined): boolean {
  return char !== undefined && char !== '' && LETTER_OR_DIGIT.test(char);
}

function isSpace(char: string | undefined): boolean {
  return char !== undefined && /\s/.test(char);
}

/**
 * The length of the valid domain at `from` (0 if there is none). `needPeriod` is false for URLs
 * that start with a scheme, where `http://localhost` is fine.
 */
function domainLength(text: string, from: number, needPeriod: boolean): number {
  let index = from;
  let periods = 0;
  let underscoresBefore = 0;
  let underscoresNow = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '_') underscoresNow++;
    else if (char === '.') {
      underscoresBefore = underscoresNow;
      underscoresNow = 0;
      periods++;
    } else if (!isLetterOrDigit(char) && char !== '-') break;
    index++;
  }
  if (index === from) return 0;
  if (underscoresBefore > 0 || underscoresNow > 0) return 0;
  if (needPeriod && periods === 0) return 0;
  return index - from;
}

const TRAILING_PUNCTUATION = '?!.,:*_~\'"';

/** Cuts the trailing characters that do not belong to the link; returns the new end. */
function trimLink(text: string, start: number, endIn: number): number {
  let end = endIn;
  while (end > start) {
    const last = text[end - 1] ?? '';
    if (TRAILING_PUNCTUATION.includes(last)) {
      end--;
    } else if (last === ';') {
      // "&hl;" looks like an entity reference: cut it off whole. Any other ";" is cut off alone.
      let k = end - 2;
      while (k > start && /[A-Za-z0-9]/.test(text[k] ?? '')) k--;
      end = k < end - 2 && text[k] === '&' ? k : end - 1;
    } else if (last === ')') {
      let opening = 0;
      let closing = 0;
      for (let i = start; i < end; i++) {
        if (text[i] === '(') opening++;
        else if (text[i] === ')') closing++;
      }
      if (closing <= opening) break;
      end--;
    } else {
      break;
    }
  }
  return end;
}

/** The end of the run after a domain: up to white space or `<`. */
function runEnd(text: string, from: number): number {
  let index = from;
  while (index < text.length) {
    const char = text[index];
    if (isSpace(char) || char === '<') break;
    index++;
  }
  return index;
}

const SCHEME_URL = /(?<![A-Za-z])(https?|ftp):\/\//gi;
const WWW = /www\./gi;

function findSchemeUrls(text: string, found: Match[]): void {
  SCHEME_URL.lastIndex = 0;
  for (let match = SCHEME_URL.exec(text); match; match = SCHEME_URL.exec(text)) {
    const start = match.index;
    const afterScheme = start + match[0].length;
    const domain = domainLength(text, afterScheme, false);
    if (domain === 0) continue;
    const end = trimLink(text, start, runEnd(text, afterScheme + domain));
    if (end <= afterScheme) continue;
    found.push({ start, end, href: text.slice(start, end) });
  }
}

function findWww(text: string, found: Match[]): void {
  WWW.lastIndex = 0;
  for (let match = WWW.exec(text); match; match = WWW.exec(text)) {
    const start = match.index;
    const before = start > 0 ? text[start - 1] : undefined;
    // `www.` must start the text or follow white space or one of * _ ~ (
    if (before !== undefined && !isSpace(before) && !'*_~('.includes(before)) continue;
    // The domain includes "www." itself, which supplies the required period.
    const domain = domainLength(text, start, true);
    if (domain <= 4) continue;
    const end = trimLink(text, start, runEnd(text, start + domain));
    if (end <= start + 4) continue;
    found.push({ start, end, href: `http://${text.slice(start, end)}` });
  }
}

const LOCAL_CHAR = /[\p{L}\p{N}._+-]/u;

function findEmails(text: string, found: Match[]): void {
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    let start = at;
    while (start > 0 && LOCAL_CHAR.test(text[start - 1] ?? '')) start--;
    if (start === at) continue;

    // After "@": segments of letters, digits, "-" and "_" separated by periods, at least one period.
    let end = at + 1;
    let periods = 0;
    while (end < text.length) {
      const char = text[end];
      if (isLetterOrDigit(char) || char === '-' || char === '_') {
        end++;
      } else if (char === '.' && isLetterOrDigit(text[end + 1])) {
        periods++;
        end++;
      } else {
        break;
      }
    }
    if (periods === 0 || end === at + 1) continue;
    const last = text[end - 1];
    if (last === '-' || last === '_') continue; // the last character must not be - or _
    const trimmed = trimLink(text, start, end);
    if (trimmed <= at + 1) continue;
    found.push({ start, end: trimmed, href: `mailto:${text.slice(start, trimmed)}` });
  }
}

/** All links in `text`, left to right, without overlaps (an earlier one wins). */
function findLinks(text: string): Match[] {
  const found: Match[] = [];
  if (text.includes('://')) findSchemeUrls(text, found);
  if (/www\./i.test(text)) findWww(text, found);
  if (text.includes('@')) findEmails(text, found);
  if (found.length === 0) return found;
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Match[] = [];
  let lastEnd = -1;
  for (const match of found) {
    if (match.start < lastEnd) continue;
    kept.push(match);
    lastEnd = match.end;
  }
  return kept;
}

/** Splits one text token into text and link tokens, or returns null if it has no link. */
function splitText(state: StateCore, md: MarkdownIt, token: Token): Token[] | null {
  const text = token.content;
  const links = findLinks(text);
  if (links.length === 0) return null;

  const out: Token[] = [];
  let last = 0;
  const addText = (content: string) => {
    if (content === '') return;
    const piece = new state.Token('text', '', 0);
    piece.content = content;
    piece.level = token.level;
    out.push(piece);
  };
  for (const link of links) {
    const href = md.normalizeLink(link.href);
    if (!md.validateLink(href)) continue;
    addText(text.slice(last, link.start));
    const open = new state.Token('link_open', 'a', 1);
    open.attrs = [['href', href]];
    open.markup = 'linkify';
    open.info = 'auto';
    open.level = token.level;
    out.push(open);
    const label = new state.Token('text', '', 0);
    label.content = text.slice(link.start, link.end);
    label.level = token.level + 1;
    out.push(label);
    const close = new state.Token('link_close', 'a', -1);
    close.markup = 'linkify';
    close.info = 'auto';
    close.level = token.level;
    out.push(close);
    last = link.end;
  }
  if (out.length === 0) return null;
  addText(text.slice(last));
  return out;
}

/** The core rule. It runs after `text_join`, so entities and escapes are plain text already. */
export function installAutolink(md: MarkdownIt): void {
  md.core.ruler.after('text_join', 'wd_autolink', (state: StateCore) => {
    for (const block of state.tokens) {
      if (block.type !== 'inline' || !block.children) continue;
      // Cheap exit: every autolink needs one of these.
      if (!/:\/\/|www\.|@/i.test(block.content)) continue;
      const out: Token[] = [];
      let inLink = 0;
      for (const token of block.children) {
        if (token.type === 'link_open') inLink++;
        else if (token.type === 'link_close') inLink--;
        const pieces = token.type === 'text' && inLink === 0 ? splitText(state, md, token) : null;
        if (pieces) out.push(...pieces);
        else out.push(token);
      }
      block.children = out;
    }
  });
}
