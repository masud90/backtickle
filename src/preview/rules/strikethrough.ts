/**
 * Strikethrough as the GFM spec defines it: text wrapped in a matching pair of one or two tildes.
 * A run of three or more tildes is plain text, and the two ends of a pair must have the same
 * length (`~~a~` is not strikethrough). markdown-it's own rule only knows double tildes, so this
 * replaces it. The element is `<del>`, as in the spec.
 */
import type { MarkdownIt, StateInline } from 'markdown-it';

const TILDE = 0x7e;
/** The delimiter marker of a single tilde. Markers only pair with markers of the same value. */
const SINGLE_MARKER = 0x7e01;

function tokenize(state: StateInline, silent: boolean): boolean {
  if (silent) return false;
  const start = state.pos;
  if (state.src.charCodeAt(start) !== TILDE) return false;

  const scanned = state.scanDelims(start, true);
  if (scanned.length > 2) {
    // Three or more tildes never form strikethrough.
    state.pending += state.src.slice(start, start + scanned.length);
    state.pos += scanned.length;
    return true;
  }

  const token = state.push('text', '', 0);
  token.content = scanned.length === 2 ? '~~' : '~';
  state.delimiters.push({
    marker: scanned.length === 2 ? TILDE : SINGLE_MARKER,
    length: 0,
    token: state.tokens.length - 1,
    end: -1,
    open: scanned.can_open,
    close: scanned.can_close,
  });
  state.pos += scanned.length;
  return true;
}

function postProcessDelimiters(state: StateInline, delimiters: StateInline['delimiters']): void {
  for (const start of delimiters) {
    if (start.marker !== TILDE && start.marker !== SINGLE_MARKER) continue;
    if (start.end === -1) continue;
    const end = delimiters[start.end];
    const open = state.tokens[start.token];
    const close = end ? state.tokens[end.token] : undefined;
    if (!open || !close) continue;
    const markup = start.marker === TILDE ? '~~' : '~';
    open.type = 's_open';
    open.tag = 'del';
    open.nesting = 1;
    open.markup = markup;
    open.content = '';
    close.type = 's_close';
    close.tag = 'del';
    close.nesting = -1;
    close.markup = markup;
    close.content = '';
  }
}

function postProcess(state: StateInline): void {
  postProcessDelimiters(state, state.delimiters);
  for (const meta of state.tokens_meta) {
    if (meta?.delimiters) postProcessDelimiters(state, meta.delimiters);
  }
}

/** Puts GFM strikethrough in the place of markdown-it's own rule. */
export function installStrikethrough(md: MarkdownIt): void {
  md.inline.ruler.at('strikethrough', tokenize);
  md.inline.ruler2.at('strikethrough', postProcess);
}
