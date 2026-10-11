/**
 * The markdown-it instance used by the preview, with two small in-house rules:
 * - `data-line` on every top-level block (source line, 0-based), for sync scroll later;
 * - task list items (`- [ ]` / `- [x]`) rendered as disabled checkboxes.
 */
import MarkdownItConstructor, { type MarkdownIt, type StateCore, type Token } from 'markdown-it';

const TASK_MARKER = /^\[([ xX])\][ \t]+/;
/** The inline style markdown-it puts on aligned table cells, for example `text-align:center`. */
const CELL_ALIGNMENT = /^text-align:(left|center|right)$/;
/** The first tag of a raw HTML block, so a `data-line` attribute can be added to it. */
const FIRST_TAG = /^(<[A-Za-z][A-Za-z0-9-]*)/;

/** Marks the source line of every top-level block token. */
function dataLineRule(state: StateCore): void {
  for (const token of state.tokens) {
    if (token.level !== 0 || !token.map || token.nesting === -1) continue;
    const line = String(token.map[0]);
    if (token.type === 'html_block') {
      // Raw HTML is emitted verbatim, so the attribute goes into its first tag. A block that
      // starts with a comment or text has no element to carry it.
      token.content = token.content.replace(FIRST_TAG, `$1 data-line="${line}"`);
    } else {
      token.attrSet('data-line', line);
    }
  }
}

/**
 * Table column alignment as a class instead of markdown-it's inline `style` attribute. The
 * content security policy forbids inline style attributes (`style-src-attr 'none'`), and a
 * class works in every context.
 */
function tableAlignmentRule(state: StateCore): void {
  for (const token of state.tokens) {
    if (token.type !== 'th_open' && token.type !== 'td_open') continue;
    const alignment = CELL_ALIGNMENT.exec(String(token.attrGet('style') ?? ''))?.[1];
    if (!alignment) continue;
    token.attrs = (token.attrs ?? []).filter(([name]) => name !== 'style');
    token.attrJoin('class', `align-${alignment}`);
  }
}

function makeTaskCheckbox(state: StateCore, checked: boolean): Token {
  const token = new state.Token('html_inline', '', 0);
  token.content = `<input class="task-list-item-checkbox" type="checkbox" disabled${checked ? ' checked' : ''}> `;
  return token;
}

/** Turns a leading `[ ]` or `[x]` in a list item into a checkbox. */
function taskListRule(state: StateCore): void {
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
      item.type !== 'list_item_open'
    ) {
      continue;
    }
    const first = inline.children?.[0];
    if (first?.type !== 'text') continue;
    const match = TASK_MARKER.exec(first.content);
    if (!match) continue;

    first.content = first.content.slice(match[0].length);
    inline.content = inline.content.slice(match[0].length);
    inline.children?.unshift(makeTaskCheckbox(state, match[1] !== ' '));

    item.attrJoin('class', 'task-list-item');
    // The list that contains this item is the closest earlier list opener one level up.
    for (let j = i - 3; j >= 0; j--) {
      const candidate = tokens[j];
      if (
        candidate &&
        candidate.level === item.level - 1 &&
        candidate.type.endsWith('_list_open')
      ) {
        candidate.attrJoin('class', 'contains-task-list');
        break;
      }
    }
  }
}

/** Fenced and indented code: the attributes go on `<pre>`, the top-level element. */
function installCodeRules(md: MarkdownIt): void {
  const escapeHtml = md.utils.escapeHtml;
  md.renderer.rules.fence = (tokens, idx, _options, _env, self) => {
    const token = tokens[idx];
    if (!token) return '';
    const language = token.info.trim().split(/\s+/)[0] ?? '';
    const cls = language ? ` class="language-${escapeHtml(language)}"` : '';
    return `<pre${self.renderAttrs(token)}><code${cls}>${escapeHtml(token.content)}</code></pre>\n`;
  };
  md.renderer.rules.code_block = (tokens, idx, _options, _env, self) => {
    const token = tokens[idx];
    if (!token) return '';
    return `<pre${self.renderAttrs(token)}><code>${escapeHtml(token.content)}</code></pre>\n`;
  };
}

export function createMarkdownIt(): MarkdownIt {
  const md = new MarkdownItConstructor({ html: true, linkify: true, typographer: false });
  md.enable(['table', 'strikethrough']);
  md.core.ruler.push('wd_task_list', taskListRule);
  md.core.ruler.push('wd_table_alignment', tableAlignmentRule);
  md.core.ruler.push('wd_data_line', dataLineRule);
  installCodeRules(md);
  return md;
}
