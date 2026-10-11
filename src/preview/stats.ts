/**
 * Words, characters and reading time,
 * computed from the parse tokens, never from the DOM.
 *
 * Prose is inline text, including inline code, link text, table cells (header row included) and
 * footnote text. Not prose: code blocks, frontmatter, raw HTML blocks, inline HTML tags (the
 * text between two tags is prose), math, image alt text, URLs, and generated markers (footnote
 * reference numbers, back-links, the title of an alert). Soft and hard breaks are one space.
 *
 * Prose is collected per top-level block, in the order of the tokens (so footnote definitions
 * come last). Inside a block the text of separate inline runs (list items, table cells,
 * paragraphs in a quote) is joined with one space, whitespace runs collapse to one space, and
 * the result is trimmed. Blocks without prose count for nothing.
 */
import type { Token } from 'markdown-it';
import type { DocStats } from './types';

/** The average adult silent reading rate for English non-fiction (Brysbaert, 2019). */
export const DEFAULT_READING_WPM = 238;

export const EMPTY_STATS: DocStats = Object.freeze({
  words: 0,
  characters: 0,
  charactersNoSpaces: 0,
});

let wordSegmenter: Intl.Segmenter | undefined;
let graphemeSegmenter: Intl.Segmenter | undefined;

/** One locale for every machine, so the same text always gives the same numbers. */
function words(): Intl.Segmenter {
  wordSegmenter ??= new Intl.Segmenter('en', { granularity: 'word' });
  return wordSegmenter;
}

function graphemes(): Intl.Segmenter {
  graphemeSegmenter ??= new Intl.Segmenter('en', { granularity: 'grapheme' });
  return graphemeSegmenter;
}

/** The plain text of one run of inline tokens. */
export function inlineProse(children: readonly Token[] | null): string {
  if (!children) return '';
  let out = '';
  // The text of an autolink is the URL itself, which is not prose.
  let inAutolink = false;
  for (const token of children) {
    switch (token.type) {
      case 'link_open':
        if (token.info === 'auto') inAutolink = true;
        break;
      case 'link_close':
        inAutolink = false;
        break;
      case 'text':
        if (!inAutolink) out += token.content;
        break;
      case 'code_inline':
      case 'emoji':
      // The printed text of a citation counts.
      case 'citation':
        out += token.content;
        break;
      case 'softbreak':
      case 'hardbreak':
        out += ' ';
        break;
      default:
        // html_inline, image (alt text), math_inline, footnote_ref, task_checkbox, and the
        // opening and closing tokens of emphasis: no prose.
        break;
    }
  }
  return out;
}

const WHITESPACE_RUN = /\s+/g;

/** The prose of one top-level block, or '' if it has none. */
export function blockProse(tokens: readonly Token[]): string {
  let joined = '';
  for (const token of tokens) {
    if (token.type !== 'inline') continue;
    const run = inlineProse(token.children);
    if (run === '') continue;
    joined = joined === '' ? run : `${joined} ${run}`;
  }
  return joined.replace(WHITESPACE_RUN, ' ').trim();
}

/** The word segments of a prose string. */
export function proseWords(prose: string): string[] {
  const found: string[] = [];
  for (const part of words().segment(prose)) {
    if (part.isWordLike) found.push(part.segment);
  }
  return found;
}

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
const WHITESPACE_ONLY = /^\s+$/;

/** Words and characters of one prose string. */
export function countProse(prose: string): DocStats {
  if (prose === '') return EMPTY_STATS;
  let wordCount = 0;
  for (const part of words().segment(prose)) {
    if (part.isWordLike) wordCount++;
  }

  let characters = 0;
  let noSpaces = 0;
  if (PRINTABLE_ASCII.test(prose)) {
    // Every printable ASCII character is a grapheme of its own: no need to segment.
    characters = prose.length;
    let spaces = 0;
    for (let i = prose.indexOf(' '); i !== -1; i = prose.indexOf(' ', i + 1)) spaces++;
    noSpaces = characters - spaces;
  } else {
    for (const part of graphemes().segment(prose)) {
      characters++;
      if (!WHITESPACE_ONLY.test(part.segment)) noSpaces++;
    }
  }
  return { words: wordCount, characters, charactersNoSpaces: noSpaces };
}

export function addStats(total: DocStats, add: DocStats): void {
  total.words += add.words;
  total.characters += add.characters;
  total.charactersNoSpaces += add.charactersNoSpaces;
}

/**
 * Reading time: words divided by the reading speed, rounded up to whole minutes.
 * '0 min' for no words, '< 1 min' when there are fewer words than one minute reads.
 */
export function readingMinutes(wordCount: number, wpm: number): string {
  if (!(wordCount > 0)) return '0 min';
  const speed = wpm > 0 ? wpm : DEFAULT_READING_WPM;
  if (wordCount < speed) return '< 1 min';
  return `${Math.ceil(wordCount / speed)} min`;
}
