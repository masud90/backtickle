/**
 * Obsidian callouts: `> [!type] Title`, with `+` (foldable, open) or
 * `-` (foldable, closed) after the type. Every type and alias Obsidian knows (any case) maps to
 * one of twelve looks; an unknown type looks like a note. The structure is the Phase 1 one
 * (`div.callout.callout-<look> > p.callout-title > span.callout-icon + title`, then the content),
 * and a foldable callout is `details.callout > summary.callout-title`, open for `+`.
 *
 * A custom title is inline Markdown and counts as prose; the default title (the type, capitalized)
 * is generated text and does not. The GitHub alert rule of the GFM pack is replaced by this one:
 * `[!NOTE]` and the other four alert types are callouts here too.
 */
import type { MarkdownIt, Renderer, StateCore, Token } from 'markdown-it';
import { escapeHtml } from '../escape';

export type CalloutLook =
  | 'note'
  | 'abstract'
  | 'info'
  | 'todo'
  | 'tip'
  | 'success'
  | 'question'
  | 'warning'
  | 'failure'
  | 'danger'
  | 'bug'
  | 'example'
  | 'quote';

const ALIASES: Record<string, CalloutLook> = {
  note: 'note',
  abstract: 'abstract',
  summary: 'abstract',
  tldr: 'abstract',
  info: 'info',
  todo: 'todo',
  tip: 'tip',
  hint: 'tip',
  important: 'tip',
  success: 'success',
  check: 'success',
  done: 'success',
  question: 'question',
  help: 'question',
  faq: 'question',
  warning: 'warning',
  caution: 'warning',
  attention: 'warning',
  failure: 'failure',
  fail: 'failure',
  missing: 'failure',
  danger: 'danger',
  error: 'danger',
  bug: 'bug',
  example: 'example',
  quote: 'quote',
  cite: 'quote',
};

/** An icon name of the preview's icon set for each look. */
export const CALLOUT_ICONS: Record<CalloutLook, string> = {
  note: 'edit-note',
  abstract: 'subject',
  info: 'info',
  todo: 'check-circle',
  tip: 'lightbulb',
  success: 'check',
  question: 'report',
  warning: 'warning',
  failure: 'close',
  danger: 'error',
  bug: 'error',
  example: 'format-list-bulleted',
  quote: 'format-quote',
};

/** The look of a type (any case): unknown types look like a note. */
export function calloutLook(type: string): CalloutLook {
  return ALIASES[type.toLowerCase()] ?? 'note';
}

const MARKER = /^\[!([A-Za-z0-9_-]+)\]([+-])?[ \t]*([^\n]*)(?:\n|$)/;

function capitalize(type: string): string {
  const lower = type.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Runs after the block rules and before the inline rules, while the text is still raw. */
export function obsidianCalloutsRule(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const open = tokens[i];
    if (open?.type !== 'blockquote_open') continue;
    const paragraph = tokens[i + 1];
    const inline = tokens[i + 2];
    if (paragraph?.type !== 'paragraph_open' || inline?.type !== 'inline') continue;
    const match = MARKER.exec(inline.content);
    const type = match?.[1];
    if (!match || !type) continue;

    let closeIndex = -1;
    for (let j = i + 1; j < tokens.length; j++) {
      const candidate = tokens[j];
      if (candidate?.type === 'blockquote_close' && candidate.level === open.level) {
        closeIndex = j;
        break;
      }
    }
    const close = tokens[closeIndex];
    if (!close) continue;

    const look = calloutLook(type);
    const fold = match[2];
    const tag = fold ? 'details' : 'div';
    open.tag = tag;
    close.tag = tag;
    open.attrJoin('class', `callout callout-${look}`);
    open.attrSet('data-callout', type.toLowerCase());
    if (fold === '+') open.attrSet('open', '');
    open.meta = { callout: look };

    const customTitle = (match[3] ?? '').trim();
    const titleOpen = new state.Token('wd_callout_title_open', fold ? 'summary' : 'p', 1);
    titleOpen.block = true;
    titleOpen.level = open.level + 1;
    titleOpen.meta = { look, title: customTitle === '' ? capitalize(type) : null };
    const titleClose = new state.Token('wd_callout_title_close', fold ? 'summary' : 'p', -1);
    titleClose.block = true;
    titleClose.level = open.level + 1;
    const parts: Token[] = [titleOpen];
    if (customTitle !== '') {
      const title = new state.Token('inline', '', 0);
      title.content = customTitle;
      title.level = open.level + 2;
      title.map = inline.map;
      title.children = [];
      parts.push(title);
    }
    parts.push(titleClose);

    inline.content = inline.content.slice(match[0].length);
    if (inline.content.trim() === '') {
      // The marker line was alone in its paragraph: the title replaces the empty paragraph.
      tokens.splice(i + 1, 3, ...parts);
    } else {
      tokens.splice(i + 1, 0, ...parts);
    }
  }
}

export function renderCalloutTitleOpen(
  tokens: Token[],
  idx: number,
  _options: unknown,
  _env: unknown,
  _renderer: Renderer,
): string {
  const token = tokens[idx];
  const meta = token?.meta as { look: CalloutLook; title: string | null } | undefined;
  if (!token || !meta) return '';
  const icon = `<span class="callout-icon" data-icon="${CALLOUT_ICONS[meta.look]}"></span>`;
  const title = meta.title === null ? '' : escapeHtml(meta.title);
  return `<${token.tag} class="callout-title">${icon}${title}`;
}

export function renderCalloutTitleClose(
  tokens: Token[],
  idx: number,
  _options: unknown,
  _env: unknown,
  _renderer: Renderer,
): string {
  return `</${tokens[idx]?.tag ?? 'p'}>\n`;
}

export function installObsidianCallouts(md: MarkdownIt): void {
  // Instead of the GitHub alert rule of the GFM pack.
  md.core.ruler.disable('wd_callouts');
  md.core.ruler.after('block', 'wd_obsidian_callouts', obsidianCalloutsRule);
  md.renderer.rules.wd_callout_title_open = renderCalloutTitleOpen;
  md.renderer.rules.wd_callout_title_close = renderCalloutTitleClose;
}
