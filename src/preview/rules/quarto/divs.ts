/**
 * Quarto's fenced divs, read from the `fenced_div_open` tokens of the
 * Pandoc pack before the inline rules run:
 *
 *   ::: {.callout-note title="T" collapse="true"}   the Phase 1 callout structure; collapsible
 *                                                    ones are details.callout > summary.callout-title
 *   ::: {.panel-tabset}                              div.tabset > section.tabset-panel[data-tab-title]
 *   :::: {.columns} / ::: {.column width="40%"}      div.columns > div.column (width: data-wd-width)
 *
 * The title of a callout is the `title` attribute or its first heading; the headings that name
 * the tabs are not headings of the document (they are not in the outline). The tab buttons are
 * added after sanitizing (`tabset-enhance.ts`).
 */
import type { MarkdownIt, StateCore, Token } from 'markdown-it';
import { CALLOUTS, type CalloutType } from '../callouts';
import { escapeHtml } from '../escape';
import { type Attributes, docClasses } from '../pandoc/attributes';

const CALLOUT_TYPES = new Set<string>(Object.keys(CALLOUTS));

/** The attributes of the opening token, with these classes instead of the document's own. */
function setClasses(open: Token, base: string[], attrs: Attributes, consumed: string[]): void {
  const rest = attrs.classes.filter((name) => !consumed.includes(name));
  const keep = (open.attrs ?? []).filter(([name]) => name !== 'class');
  open.attrs = [['class', [...base, ...docClasses(rest)].join(' ')], ...keep];
}

function closeOf(tokens: readonly Token[], index: number): number {
  let depth = 0;
  for (let i = index; i < tokens.length; i++) {
    depth += (tokens[i] as Token).nesting;
    if (depth === 0) return i;
  }
  return -1;
}

function pair(attrs: Attributes, name: string): string | undefined {
  return attrs.pairs.find(([key]) => key === name)?.[1];
}

function calloutRule(state: StateCore, index: number, type: CalloutType, attrs: Attributes) {
  const tokens = state.tokens;
  const open = tokens[index] as Token;
  const close = tokens[closeOf(tokens, index)] as Token | undefined;
  if (!close) return;
  const collapse = pair(attrs, 'collapse');
  const collapsible = collapse === 'true' || collapse === 'false';
  setClasses(open, ['callout', `callout-${type}`], attrs, [`callout-${type}`]);
  if (collapsible) {
    open.tag = 'details';
    close.tag = 'details';
    if (collapse === 'false') open.attrSet('open', '');
  }
  const tag = collapsible ? 'summary' : 'p';
  const titleOpen = new state.Token('quarto_callout_title_open', tag, 1);
  titleOpen.block = true;
  titleOpen.level = open.level + 1;
  titleOpen.meta = { type, custom: false };
  const titleClose = new state.Token('quarto_callout_title_close', tag, -1);
  titleClose.block = true;
  titleClose.level = open.level + 1;

  const title = pair(attrs, 'title');
  if (title !== undefined && title.trim() !== '') {
    const inline = new state.Token('inline', '', 0);
    inline.content = title;
    inline.children = [];
    inline.level = open.level + 2;
    inline.map = open.map;
    titleOpen.meta = { type, custom: true };
    tokens.splice(index + 1, 0, titleOpen, inline, titleClose);
    return;
  }
  const heading = tokens[index + 1];
  const inline = tokens[index + 2];
  if (heading?.type === 'heading_open' && inline?.type === 'inline') {
    // The first heading is the title: it stays a token of the document's text, not a heading.
    titleOpen.meta = { type, custom: true };
    tokens.splice(index + 1, 3, titleOpen, inline, titleClose);
    return;
  }
  tokens.splice(index + 1, 0, titleOpen, titleClose);
}

/** The plain text of the title of a tab, from its Markdown source. */
function plainTitle(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tabsetRule(state: StateCore, index: number, attrs: Attributes) {
  const tokens = state.tokens;
  const open = tokens[index] as Token;
  const closeIndex = closeOf(tokens, index);
  if (closeIndex < 0) return;
  setClasses(open, ['tabset'], attrs, ['panel-tabset']);
  const childLevel = open.level + 1;
  let tabLevel = 0;
  const out: Token[] = [];
  let inPanel = false;
  const closePanel = () => {
    const close = new state.Token('tabset_panel_close', 'section', -1);
    close.block = true;
    close.level = childLevel;
    out.push(close);
    inPanel = false;
  };
  for (let j = index + 1; j < closeIndex; ) {
    const token = tokens[j] as Token;
    const level = token.type === 'heading_open' ? Number(token.tag.slice(1)) : 0;
    if (token.type === 'heading_open' && token.level === childLevel) {
      if (tabLevel === 0) tabLevel = level;
      const inline = tokens[j + 1];
      if (level === tabLevel && inline?.type === 'inline') {
        if (inPanel) closePanel();
        const panel = new state.Token('tabset_panel_open', 'section', 1);
        panel.block = true;
        panel.level = childLevel;
        panel.map = token.map;
        panel.attrSet('class', 'tabset-panel');
        panel.attrSet('data-tab-title', plainTitle(inline.content));
        out.push(panel);
        inPanel = true;
        j += 3;
        continue;
      }
    }
    out.push(token);
    j++;
  }
  if (inPanel) closePanel();
  tokens.splice(index + 1, closeIndex - index - 1, ...out);
}

function divsRule(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const open = tokens[i] as Token;
    if (open.type !== 'fenced_div_open') continue;
    const attrs = (open.meta as { attrs?: Attributes } | null)?.attrs;
    if (!attrs) continue;
    const callout = attrs.classes
      .find((name) => name.startsWith('callout-') && CALLOUT_TYPES.has(name.slice(8)))
      ?.slice(8) as CalloutType | undefined;
    if (callout) {
      calloutRule(state, i, callout, attrs);
    } else if (attrs.classes.includes('panel-tabset')) {
      tabsetRule(state, i, attrs);
    } else if (attrs.classes.includes('columns')) {
      setClasses(open, ['columns'], attrs, ['columns']);
    } else if (attrs.classes.includes('column')) {
      setClasses(open, ['column'], attrs, ['column']);
    }
  }
}

export function installQuartoDivs(md: MarkdownIt): void {
  md.core.ruler.after('wd_pandoc_heading_attrs', 'wd_quarto_divs', divsRule);
  md.renderer.rules.quarto_callout_title_open = (tokens, idx) => {
    const token = tokens[idx] as Token;
    const meta = token.meta as { type: CalloutType; custom: boolean };
    const callout = CALLOUTS[meta.type];
    return (
      `<${token.tag} class="callout-title"><span class="callout-icon" data-icon="${callout.icon}"></span>` +
      (meta.custom ? '' : escapeHtml(callout.title))
    );
  };
  md.renderer.rules.quarto_callout_title_close = (tokens, idx) => `</${tokens[idx]?.tag}>\n`;
}
