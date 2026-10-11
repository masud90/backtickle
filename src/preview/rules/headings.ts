/**
 * Heading ids and the list of headings. Every heading gets a GitHub-style id (see `slug.ts`), in
 * document order, and the list of headings (text, level, id, line) is collected for the outline.
 */
import type { StateCore, Token } from 'markdown-it';
import type { Heading } from '../types';
import { wdEnv } from './env';

const WHITESPACE_RUN = /\s+/g;

/** The plain text of a heading: text, inline code, emoji, image alt text and math source. */
export function headingText(children: readonly Token[] | null): string {
  if (!children) return '';
  let out = '';
  for (const token of children) {
    switch (token.type) {
      case 'text':
      case 'code_inline':
      case 'emoji':
      case 'math_inline':
        out += token.content;
        break;
      case 'softbreak':
      case 'hardbreak':
        out += ' ';
        break;
      case 'image':
        out += headingText(token.children);
        break;
      default:
        break;
    }
  }
  return out.replace(WHITESPACE_RUN, ' ').trim();
}

export function headingsRule(state: StateCore): void {
  const wd = wdEnv(state.env);
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const open = tokens[i];
    if (open?.type !== 'heading_open') continue;
    const inline = tokens[i + 1];
    const text = inline?.type === 'inline' ? headingText(inline.children) : '';
    const id = wd.slugger.slug(text);
    if (id !== '') open.attrSet('id', id);
    const level = Number(open.tag.slice(1)) as Heading['level'];
    wd.headings.push({ level, text, id, line: (open.map ? open.map[0] : 0) + wd.lineOffset });
    if (level === 1) wd.hasH1 = true;
  }
}
