/**
 * CriticMarkup:
 *   {++added++}    ins.critic
 *   {--deleted--}  del.critic
 *   {~~old~>new~~} span.critic-sub > del + ins
 *   {==marked==}   mark.critic
 *   {>>comment<<}  span.critic-comment
 * The text of an addition, a highlight and the new text of a substitution is ordinary inline
 * Markdown and counts as prose. The deleted and replaced text and the comments are `critic_text`
 * tokens: shown, but not prose.
 */
import type { MarkdownIt, StateInline, Token } from 'markdown-it';
import { escapeHtml } from '../escape';

const BRACE = 0x7b;

type Kind = '++' | '--' | '~~' | '==' | '>>';
const CLOSERS: Record<Kind, string> = {
  '++': '++}',
  '--': '--}',
  '~~': '~~}',
  '==': '==}',
  '>>': '<<}',
};

function isKind(text: string): text is Kind {
  return text === '++' || text === '--' || text === '~~' || text === '==' || text === '>>';
}

function open(state: StateInline, tag: string, className: string): Token {
  const token = state.push(`critic_${tag}_open`, tag, 1);
  if (className !== '') token.attrSet('class', className);
  return token;
}

function close(state: StateInline, tag: string): void {
  state.push(`critic_${tag}_close`, tag, -1);
}

function verbatim(state: StateInline, text: string): void {
  const token = state.push('critic_text', '', 0);
  token.content = text;
}

/** Parses `src[from, to)` as inline Markdown into the tokens of the state. */
function inner(state: StateInline, from: number, to: number): void {
  const oldMax = state.posMax;
  state.pos = from;
  state.posMax = to;
  state.md.inline.tokenize(state);
  state.posMax = oldMax;
}

function critic(state: StateInline, silent: boolean): boolean {
  const start = state.pos;
  const src = state.src;
  if (src.charCodeAt(start) !== BRACE) return false;
  const kind = src.slice(start + 1, start + 3);
  if (!isKind(kind)) return false;
  const closer = CLOSERS[kind];
  const contentStart = start + 3;
  const end = src.indexOf(closer, contentStart);
  if (end < 0 || end + closer.length > state.posMax) return false;
  const after = end + closer.length;

  if (kind === '~~') {
    const arrow = src.indexOf('~>', contentStart);
    if (arrow < 0 || arrow > end) return false;
    if (!silent) {
      open(state, 'span', 'critic-sub');
      open(state, 'del', '');
      verbatim(state, src.slice(contentStart, arrow));
      close(state, 'del');
      open(state, 'ins', '');
      inner(state, arrow + 2, end);
      close(state, 'ins');
      close(state, 'span');
    }
    state.pos = after;
    return true;
  }
  if (!silent) {
    if (kind === '++') {
      open(state, 'ins', 'critic');
      inner(state, contentStart, end);
      close(state, 'ins');
    } else if (kind === '==') {
      open(state, 'mark', 'critic');
      inner(state, contentStart, end);
      close(state, 'mark');
    } else if (kind === '--') {
      open(state, 'del', 'critic');
      verbatim(state, src.slice(contentStart, end));
      close(state, 'del');
    } else {
      open(state, 'span', 'critic-comment');
      verbatim(state, src.slice(contentStart, end));
      close(state, 'span');
    }
  }
  state.pos = after;
  return true;
}

export function installCritic(md: MarkdownIt): void {
  md.inline.ruler.push('wd_critic', critic);
  md.renderer.rules.critic_text = (tokens, idx) => escapeHtml(tokens[idx]?.content ?? '');
}
