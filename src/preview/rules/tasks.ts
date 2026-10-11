/**
 * Task lists (GFM): a list item whose first paragraph begins with `[ ]`, `[x]` or `[X]` followed
 * by whitespace and then content. The marker becomes a checkbox that is a plain `span` with
 * `role="checkbox"`, not a form control, so it can be styled to the design, takes the keyboard
 * focus, and is toggled by the app (the source line is in `data-task-line`).
 *
 * The line of a checkbox is written relative to its block (`data-wd-trl`), so the HTML of a
 * block does not change when the block moves. The preview turns it into `data-task-line` when
 * the block is shown (see `lines.ts`).
 */
import type { Env, Renderer, StateCore, Token } from 'markdown-it';
import { inlineProse } from '../stats';
import { wdEnv } from './env';
import { escapeHtml } from './escape';

const TASK_MARKER = /^\[([ xX])\][ \t]+/;
const LABEL_LIMIT = 160;

function accessibleLabel(children: readonly Token[] | null): string {
  const text = inlineProse(children).replace(/\s+/g, ' ').trim();
  return text.length > LABEL_LIMIT ? `${text.slice(0, LABEL_LIMIT - 1)}…` : text;
}

/** Turns a leading `[ ]` or `[x]` in a list item into a checkbox token. */
export function tasksRule(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i];
    const paragraph = tokens[i - 1];
    const item = tokens[i - 2];
    if (
      !inline ||
      !paragraph ||
      !item ||
      inline.type !== 'inline' ||
      paragraph.type !== 'paragraph_open' ||
      item.type !== 'list_item_open' ||
      !inline.children
    ) {
      continue;
    }
    const first = inline.children[0];
    if (first?.type !== 'text') continue;
    const match = TASK_MARKER.exec(first.content);
    if (!match) continue;

    first.content = first.content.slice(match[0].length);
    inline.content = inline.content.slice(match[0].length);
    const checked = match[1] !== ' ';
    const checkbox = new state.Token('task_checkbox', 'span', 0);
    checkbox.meta = {
      checked,
      line: item.map ? item.map[0] : 0,
      label: accessibleLabel(inline.children),
    };
    inline.children.unshift(checkbox);

    item.attrJoin('class', checked ? 'task-list-item is-checked' : 'task-list-item');
    // The list that holds this item is the closest earlier list opener one level up.
    for (let j = i - 3; j >= 0; j--) {
      const candidate = tokens[j];
      if (
        candidate &&
        candidate.level === item.level - 1 &&
        candidate.type.endsWith('_list_open')
      ) {
        const classes = candidate.attrGet('class');
        if (typeof classes !== 'string' || !classes.split(' ').includes('contains-task-list')) {
          candidate.attrJoin('class', 'contains-task-list');
        }
        break;
      }
    }
  }
}

export function renderTaskCheckbox(
  tokens: Token[],
  idx: number,
  _options: unknown,
  env: Env | undefined,
  _renderer: Renderer,
): string {
  const token = tokens[idx];
  const meta = token?.meta;
  if (!token || !meta) return '';
  const checked = meta.checked === true;
  const line = typeof meta.line === 'number' ? meta.line : 0;
  const label = typeof meta.label === 'string' ? meta.label : '';
  const relative = Math.max(0, line - wdEnv(env).blockStart);
  return (
    `<span class="task-checkbox" role="checkbox" aria-checked="${checked}" tabindex="0"` +
    `${label === '' ? '' : ` aria-label="${escapeHtml(label)}"`} data-wd-trl="${relative}"></span>`
  );
}
