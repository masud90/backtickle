/**
 * GitHub alerts (GFM): a blockquote whose first line is `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`,
 * `[!WARNING]` or `[!CAUTION]` (any case, nothing else on that line) becomes
 *
 *   div.callout.callout-note > p.callout-title > span.callout-icon[data-icon] + title text
 *
 * followed by the rest of the quote. The icon is an empty placeholder: the preview fills it with
 * an inline SVG after sanitizing, from its own icon set.
 */
import type { Renderer, StateCore, Token } from 'markdown-it';

export type CalloutType = 'note' | 'tip' | 'important' | 'warning' | 'caution';

export const CALLOUTS: Record<CalloutType, { title: string; icon: string }> = {
  note: { title: 'Note', icon: 'info' },
  tip: { title: 'Tip', icon: 'lightbulb' },
  important: { title: 'Important', icon: 'report' },
  warning: { title: 'Warning', icon: 'warning' },
  caution: { title: 'Caution', icon: 'error' },
};

const MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i;

/** Runs after the block rules and before the inline rules, while the text is still raw. */
export function calloutsRule(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const open = tokens[i];
    if (open?.type !== 'blockquote_open') continue;
    const paragraph = tokens[i + 1];
    const inline = tokens[i + 2];
    if (paragraph?.type !== 'paragraph_open' || inline?.type !== 'inline') continue;
    const match = MARKER.exec(inline.content);
    const marker = match?.[1];
    if (!match || !marker) continue;

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

    const type = marker.toLowerCase() as CalloutType;
    open.tag = 'div';
    close.tag = 'div';
    open.attrJoin('class', `callout callout-${type}`);
    open.meta = { callout: type };

    const title = new state.Token('callout_title', 'p', 0);
    title.block = true;
    title.level = open.level + 1;
    title.meta = { type };

    inline.content = inline.content.slice(match[0].length);
    if (inline.content.trim() === '') {
      // The marker was alone in its paragraph: the title replaces the empty paragraph.
      tokens.splice(i + 1, 3, title);
    } else {
      tokens.splice(i + 1, 0, title);
    }
  }
}

export function renderCalloutTitle(
  tokens: Token[],
  idx: number,
  _options: unknown,
  _env: unknown,
  _renderer: Renderer,
): string {
  const type = tokens[idx]?.meta?.type as CalloutType | undefined;
  const callout = type ? CALLOUTS[type] : undefined;
  if (!callout) return '';
  return `<p class="callout-title"><span class="callout-icon" data-icon="${callout.icon}"></span>${callout.title}</p>\n`;
}
