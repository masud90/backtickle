/**
 * From the mdast tree of an MDX document to the contract HTML of the preview, one string per
 * top-level node. The GFM constructs produce exactly the HTML
 * of the Phase 1 pack (tables, task lists, code cards, footnotes, alerts, the frontmatter header,
 * math placeholders), so the shared enhancement code works on them unchanged.
 *
 * Nothing here evaluates anything. Components are drawn as labeled boxes with the source text of
 * their props; expressions are shown as code; lower-case elements are written out as HTML (a short
 * list of plain string attributes only) and go through the sanitizer afterwards like all HTML.
 *
 * Lines inside a block are written relative to the block (`data-wd-rl`, `data-wd-trl`), as in the
 * Phase 1 pack, so the HTML of a block does not change when the block moves.
 */
import { load } from 'js-yaml';
import type {
  Definition,
  FootnoteDefinition,
  List,
  ListItem,
  Nodes,
  Root,
  RootContent,
  Table,
} from 'mdast';
import type { MdxJsxFlowElement, MdxJsxTextElement } from 'mdast-util-mdx';
import { previewOptions } from '../../options';
import { CALLOUTS, type CalloutType } from '../../rules/callouts';
import { renderCodeCard } from '../../rules/code';
import { escapeHtml } from '../../rules/escape';
import { renderFrontmatterHeader } from '../../rules/frontmatter';
import { Slugger } from '../../slug';
import type { Frontmatter, Heading } from '../../types';

/** One top-level block: raw (unsanitized) HTML and its 0-based inclusive lines. */
export interface MdxBlock {
  raw: string;
  line: number;
  endLine: number;
  ids: ReadonlySet<string> | null;
  /** The prose runs of the block, for the word counts. */
  runs: string[];
}

export interface MdxDocument {
  blocks: MdxBlock[];
  headings: Heading[];
  frontmatter: Frontmatter | null;
  languages: string[];
  math: boolean;
}

type Element = MdxJsxFlowElement | MdxJsxTextElement;

interface State {
  source: string;
  slugger: Slugger;
  headings: Heading[];
  definitions: Map<string, Definition>;
  footnoteDefinitions: Map<string, FootnoteDefinition>;
  /** Footnote identifier to its number, in the order of first reference. */
  footnoteNumbers: Map<string, number>;
  /** How many references each footnote has had so far (ids of the back-links). */
  footnoteRefs: Map<string, number>;
  hasH1: boolean;
  blockStart: number;
  ids: Set<string> | null;
  languages: Set<string>;
  math: boolean;
}

const MAX_YAML_CHARS = 64 * 1024;
const MAX_PROP_CHARS = 120;
const ALERT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i;
const COMMENT_ONLY = /^\s*(?:\/\*[\s\S]*?\*\/\s*)*$/;
const TASK_LABEL_LIMIT = 160;

/** Never written out, whatever the sanitizer would do with them. */
const DENIED_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'template',
  'noscript',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'link',
  'meta',
  'base',
]);

const VOID_TAGS = new Set(['area', 'br', 'col', 'hr', 'img', 'source', 'track', 'wbr']);

/** Block elements: a paragraph that holds only these is not wrapped in `p`. */
const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'details',
  'div',
  'dl',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'ul',
]);

/** Elements whose text is a word of its own: the text next to them does not run into it. */
const SEPARATING_TAGS = new Set([
  ...BLOCK_TAGS,
  'caption',
  'dd',
  'dt',
  'figcaption',
  'li',
  'summary',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
]);

/** Attributes of lower-case elements that are carried over (React spellings mapped to HTML). */
const ATTRIBUTE_NAMES = new Map<string, string>([
  ['id', 'id'],
  ['href', 'href'],
  ['src', 'src'],
  ['alt', 'alt'],
  ['title', 'title'],
  ['width', 'width'],
  ['height', 'height'],
  ['colspan', 'colspan'],
  ['colSpan', 'colspan'],
  ['rowspan', 'rowspan'],
  ['rowSpan', 'rowspan'],
  ['open', 'open'],
  ['lang', 'lang'],
  ['dir', 'dir'],
  ['start', 'start'],
  ['scope', 'scope'],
  ['align', 'align'],
  ['cite', 'cite'],
  ['datetime', 'datetime'],
  ['dateTime', 'datetime'],
  ['role', 'role'],
]);

const CLASS_TOKEN = /^[A-Za-z0-9_-]+$/;
const ARIA_NAME = /^aria-[a-z]+$/;
const PLAIN_TAG = /^[a-z][a-z0-9]*$/;

function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name) || !PLAIN_TAG.test(name);
}

function lineOf(node: Nodes): number {
  return (node.position?.start.line ?? 1) - 1;
}

// ---- scan --------------------------------------------------------------------------------

function scan(node: Nodes, state: State): void {
  switch (node.type) {
    case 'definition':
      if (!state.definitions.has(node.identifier)) state.definitions.set(node.identifier, node);
      return;
    case 'footnoteDefinition':
      state.footnoteDefinitions.set(node.identifier, node);
      break;
    case 'footnoteReference':
      if (!state.footnoteNumbers.has(node.identifier)) {
        state.footnoteNumbers.set(node.identifier, state.footnoteNumbers.size + 1);
      }
      return;
    case 'heading':
      if (node.depth === 1) state.hasH1 = true;
      break;
    default:
      break;
  }
  if ('children' in node) for (const child of node.children as Nodes[]) scan(child, state);
}

// ---- text --------------------------------------------------------------------------------

/** The plain text of inline nodes, for the title of a heading and the labels of checkboxes. */
function plainText(nodes: readonly Nodes[]): string {
  let out = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
      case 'inlineCode':
      case 'inlineMath':
        out += node.value;
        break;
      case 'break':
        out += ' ';
        break;
      case 'image':
        out += node.alt ?? '';
        break;
      default:
        if ('children' in node) {
          out += plainText(node.children as Nodes[]);
        }
    }
  }
  return out;
}

/** True for a link that the autolink literal extension made: its text is the URL itself. */
function isAutolink(node: Nodes, source: string): boolean {
  if (node.type !== 'link') return false;
  const offset = node.position?.start.offset;
  return typeof offset === 'number' && source.charCodeAt(offset) !== 0x5b;
}

/** The prose of inline nodes: no URLs, props, expressions or math. */
function prose(nodes: readonly Nodes[], source: string): string {
  let out = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
      case 'inlineCode':
        out += node.value;
        break;
      case 'break':
        out += ' ';
        break;
      case 'link':
        if (!isAutolink(node, source)) out += prose(node.children, source);
        break;
      case 'emphasis':
      case 'strong':
      case 'delete':
      case 'linkReference':
        out += prose(node.children as Nodes[], source);
        break;
      case 'mdxJsxTextElement':
        // The children count, the props do not. A block-level element ends the word before it.
        out += SEPARATING_TAGS.has(node.name ?? '')
          ? ` ${prose(node.children as Nodes[], source)} `
          : prose(node.children as Nodes[], source);
        break;
      default:
        // images (alt text), math, expressions, footnote references: no prose.
        break;
    }
  }
  return out;
}

/** Adds the prose runs of a block-level node, in order. */
function collectRuns(node: Nodes, source: string, runs: string[]): void {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
    case 'tableCell': {
      const run = prose(node.children, source);
      if (run.trim() !== '') runs.push(run);
      return;
    }
    case 'code':
    case 'math':
    case 'yaml':
    case 'mdxjsEsm':
    case 'mdxFlowExpression':
    case 'definition':
    case 'footnoteDefinition':
      return;
    default:
      if ('children' in node) {
        for (const child of node.children as Nodes[]) collectRuns(child, source, runs);
      }
  }
}

// ---- JSX ---------------------------------------------------------------------------------

function shorten(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > MAX_PROP_CHARS ? `${clean.slice(0, MAX_PROP_CHARS - 1)}…` : clean;
}

/** The props of a component: the name and the literal source of each value, never evaluated. */
function renderProps(node: Element): string {
  if (node.attributes.length === 0) return '';
  let html = '<span class="mdx-props">';
  for (const attribute of node.attributes) {
    if (attribute.type === 'mdxJsxExpressionAttribute') {
      html += `<span class="mdx-prop">${escapeHtml(shorten(`{${attribute.value}}`))}</span>`;
      continue;
    }
    const name = `<span class="mdx-prop-name">${escapeHtml(attribute.name)}</span>`;
    const value = attribute.value;
    if (value === null || value === undefined) {
      html += `<span class="mdx-prop">${name}</span>`;
      continue;
    }
    const literal = typeof value === 'string' ? `"${value}"` : `{${value.value}}`;
    html += `<span class="mdx-prop">${name}=<span class="mdx-prop-value">${escapeHtml(shorten(literal))}</span></span>`;
  }
  return `${html}</span>`;
}

/** The attributes of a lower-case element: plain strings from a short list, classes namespaced. */
function htmlAttributes(node: Element): string {
  let out = '';
  for (const attribute of node.attributes) {
    if (attribute.type !== 'mdxJsxAttribute') continue;
    const value = attribute.value;
    if (value !== null && value !== undefined && typeof value !== 'string') continue;
    if (attribute.name === 'className' || attribute.name === 'class') {
      const classes = (value ?? '')
        .split(/\s+/)
        .filter((token) => CLASS_TOKEN.test(token))
        .map((token) => `doc-${token}`);
      if (classes.length > 0) out += ` class="${escapeHtml(classes.join(' '))}"`;
      continue;
    }
    const name =
      ATTRIBUTE_NAMES.get(attribute.name) ??
      (ARIA_NAME.test(attribute.name) ? attribute.name : null);
    if (name === null) continue;
    out += value === null || value === undefined ? ` ${name}` : ` ${name}="${escapeHtml(value)}"`;
  }
  return out;
}

function renderElement(node: Element, state: State): string {
  const flow = node.type === 'mdxJsxFlowElement';
  const name = node.name;
  const children = renderPhrasing(node.children, state);
  // A fragment is transparent.
  if (name === null) return children;
  if (!isComponentName(name)) {
    if (DENIED_TAGS.has(name)) return '';
    const attributes = htmlAttributes(node);
    if (VOID_TAGS.has(name)) return `<${name}${attributes}>`;
    return `<${name}${attributes}>${children}</${name}>${flow ? '\n' : ''}`;
  }
  const safeName = escapeHtml(name);
  const tag = flow ? 'div' : 'span';
  const header =
    `<${tag} class="mdx-component-header"><span class="mdx-component-name">${safeName}</span>` +
    `${renderProps(node)}</${tag}>`;
  const body = children === '' ? '' : `<${tag} class="mdx-component-children">${children}</${tag}>`;
  return `<${tag} class="mdx-component${flow ? '' : ' is-inline'}" data-name="${safeName}">${header}${body}</${tag}>${flow ? '\n' : ''}`;
}

// ---- nodes -------------------------------------------------------------------------------

function renderPhrasing(nodes: readonly Nodes[], state: State): string {
  let out = '';
  for (const node of nodes) out += renderNode(node, state);
  return out;
}

function footnoteReference(identifier: string, state: State): string {
  const number = state.footnoteNumbers.get(identifier);
  if (number === undefined || !state.footnoteDefinitions.has(identifier)) return '';
  const count = state.footnoteRefs.get(identifier) ?? 0;
  state.footnoteRefs.set(identifier, count + 1);
  const id = count === 0 ? `fnref${number}` : `fnref${number}:${count}`;
  return `<sup class="footnote-ref"><a href="#fn${number}" id="${id}">[${number}]</a></sup>`;
}

function titleAttribute(title: string | null | undefined): string {
  return title ? ` title="${escapeHtml(title)}"` : '';
}

function mathDisplay(tex: string, state: State): string {
  state.math = true;
  const safe = escapeHtml(tex);
  return `<div class="math math-display" data-tex="${safe}">${safe}</div>\n`;
}

function sourceSlice(node: Nodes, source: string): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return typeof start === 'number' && typeof end === 'number'
    ? source.slice(start, end)
    : 'value' in node
      ? String(node.value)
      : '';
}

/**
 * The Pandoc rule for single-dollar math: no space after the
 * opening `$`, no space before the closing `$`, no digit right after the closing `$`.
 * The parser accepts more, so a rejected span is drawn as the text it was written as.
 */
function pandocMathAllowed(node: Nodes, source: string): boolean {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (typeof start !== 'number' || typeof end !== 'number') return true;
  const text = source.slice(start, end);
  if (!text.startsWith('$') || text.startsWith('$$') || !text.endsWith('$')) return true;
  const inner = text.slice(1, -1);
  if (inner.length === 0 || /^\s/.test(inner) || /\s$/.test(inner)) return false;
  return !/[0-9]/.test(source.charAt(end));
}

/** `#tag` as a pill (setting): the same rule as the Obsidian pack, on a text node. */
const HASHTAG = /(^|[\s([{"'>*~=])#([\p{L}\p{N}_/-]+)/gu;

function textWithTags(value: string): string {
  let out = '';
  let last = 0;
  for (const match of value.matchAll(HASHTAG)) {
    const name = match[2] ?? '';
    if (/^\d+$/.test(name)) continue;
    const at = match.index ?? 0;
    const start = at + (match[1]?.length ?? 0);
    out += `${escapeHtml(value.slice(last, start))}<span class="tag">#${escapeHtml(name)}</span>`;
    last = at + match[0].length;
  }
  return out + escapeHtml(value.slice(last));
}

function renderNode(node: Nodes, state: State): string {
  switch (node.type) {
    case 'text':
      return previewOptions().hashtagPills ? textWithTags(node.value) : escapeHtml(node.value);
    case 'emphasis':
      return `<em>${renderPhrasing(node.children, state)}</em>`;
    case 'strong':
      return `<strong>${renderPhrasing(node.children, state)}</strong>`;
    case 'delete':
      return `<del>${renderPhrasing(node.children, state)}</del>`;
    case 'inlineCode':
      return `<code>${escapeHtml(node.value)}</code>`;
    case 'break':
      return '<br>\n';
    case 'link':
      return `<a href="${escapeHtml(node.url)}"${titleAttribute(node.title)}>${renderPhrasing(node.children, state)}</a>`;
    case 'linkReference': {
      const target = state.definitions.get(node.identifier);
      if (!target) return renderPhrasing(node.children, state);
      return `<a href="${escapeHtml(target.url)}"${titleAttribute(target.title)}>${renderPhrasing(node.children, state)}</a>`;
    }
    case 'image':
      return `<img src="${escapeHtml(node.url)}" alt="${escapeHtml(node.alt ?? '')}"${titleAttribute(node.title)}>`;
    case 'imageReference': {
      const target = state.definitions.get(node.identifier);
      if (!target) return escapeHtml(node.alt ?? '');
      return `<img src="${escapeHtml(target.url)}" alt="${escapeHtml(node.alt ?? '')}"${titleAttribute(target.title)}>`;
    }
    case 'footnoteReference':
      return footnoteReference(node.identifier, state);
    case 'inlineMath': {
      if (!previewOptions().math || !pandocMathAllowed(node, state.source))
        return escapeHtml(sourceSlice(node, state.source));
      state.math = true;
      const tex = escapeHtml(node.value);
      return `<span class="math math-inline" data-tex="${tex}">${tex}</span>`;
    }
    case 'mdxTextExpression':
      return COMMENT_ONLY.test(node.value)
        ? ''
        : `<code class="mdx-expression">{${escapeHtml(node.value)}}</code>`;
    case 'mdxFlowExpression':
      return COMMENT_ONLY.test(node.value)
        ? ''
        : `<p><code class="mdx-expression">{${escapeHtml(node.value)}}</code></p>\n`;
    case 'mdxJsxTextElement':
    case 'mdxJsxFlowElement':
      return renderElement(node, state);
    case 'mdxjsEsm':
      return renderEsm(node.value, state);
    case 'paragraph':
      return renderParagraph(node.children, state);
    case 'heading': {
      const text = plainText(node.children).replace(/\s+/g, ' ').trim();
      const id = state.slugger.slug(text);
      state.headings.push({ level: node.depth, text, id, line: lineOf(node) });
      if (id !== '') {
        state.ids ??= new Set();
        state.ids.add(id);
      }
      const attribute = id === '' ? '' : ` id="${escapeHtml(id)}"`;
      return `<h${node.depth}${attribute}>${renderPhrasing(node.children, state)}</h${node.depth}>\n`;
    }
    case 'blockquote':
      return renderBlockquote(node.children, state);
    case 'list':
      return renderList(node, state);
    case 'code': {
      const lang = (node.lang ?? '').trim();
      if (lang.toLowerCase() === 'math' && previewOptions().math) {
        return mathDisplay(node.value, state);
      }
      if (lang !== '') state.languages.add(lang.toLowerCase());
      return renderCodeCard(node.value, lang);
    }
    case 'math':
      if (!previewOptions().math) return `<p>${escapeHtml(sourceSlice(node, state.source))}</p>\n`;
      return mathDisplay(node.value, state);
    case 'thematicBreak':
      return '<hr>\n';
    case 'table':
      return renderTable(node, state);
    case 'yaml':
      return renderYaml(node.value, state);
    default:
      // Definitions and footnote definitions are handled by the document; nothing else is drawn.
      return '';
  }
}

function renderEsm(value: string, state: State): string {
  state.languages.add('js');
  const lines = value.split('\n').length;
  return (
    `<details class="mdx-esm"><summary>import and export, ${lines} ${lines === 1 ? 'line' : 'lines'}</summary>` +
    `${renderCodeCard(value, 'js')}</details>\n`
  );
}

/** A paragraph that holds only block-level HTML elements is not wrapped (`p` cannot hold them). */
function renderParagraph(children: readonly Nodes[], state: State): string {
  const inner = renderPhrasing(children, state);
  const onlyBlocks =
    children.some((child) => child.type === 'mdxJsxTextElement') &&
    children.every(
      (child) =>
        (child.type === 'mdxJsxTextElement' && child.name !== null && BLOCK_TAGS.has(child.name)) ||
        (child.type === 'text' && child.value.trim() === ''),
    );
  return onlyBlocks ? `${inner}\n` : `<p>${inner}</p>\n`;
}

function renderBlockquote(children: readonly RootContent[], state: State): string {
  const first = children[0];
  const lead = first?.type === 'paragraph' ? first.children[0] : undefined;
  const match = lead?.type === 'text' ? ALERT_MARKER.exec(lead.value) : null;
  if (first?.type !== 'paragraph' || lead?.type !== 'text' || !match?.[1]) {
    return `<blockquote>\n${renderPhrasing(children, state)}</blockquote>\n`;
  }
  const type = match[1].toLowerCase() as CalloutType;
  const callout = CALLOUTS[type];
  const rest = [{ ...lead, value: lead.value.slice(match[0].length) }, ...first.children.slice(1)];
  const empty = rest.every((node) => node.type === 'text' && node.value.trim() === '');
  const body = empty ? '' : renderParagraph(rest, state);
  return (
    `<div class="callout callout-${type}">\n` +
    `<p class="callout-title"><span class="callout-icon" data-icon="${callout.icon}"></span>${callout.title}</p>\n` +
    `${body}${renderPhrasing(children.slice(1), state)}</div>\n`
  );
}

function renderListItem(item: ListItem, loose: boolean, state: State): string {
  const checked = item.checked;
  const task = checked === true || checked === false;
  const relative = Math.max(0, lineOf(item) - state.blockStart);
  const classes = task ? ` class="task-list-item${checked ? ' is-checked' : ''}"` : '';
  let checkbox = '';
  if (task) {
    const first = item.children[0];
    const label = (first?.type === 'paragraph' ? plainText(first.children) : '')
      .replace(/\s+/g, ' ')
      .trim();
    const short =
      label.length > TASK_LABEL_LIMIT ? `${label.slice(0, TASK_LABEL_LIMIT - 1)}…` : label;
    checkbox =
      `<span class="task-checkbox" role="checkbox" aria-checked="${checked === true}" tabindex="0"` +
      `${short === '' ? '' : ` aria-label="${escapeHtml(short)}"`} data-wd-trl="${relative}"></span>`;
  }
  let body = '';
  for (const child of item.children) {
    if (!loose && child.type === 'paragraph') {
      body += renderPhrasing(child.children, state);
    } else {
      body += `${body === '' || body.endsWith('\n') ? '' : '\n'}${renderNode(child, state)}`;
    }
  }
  return `<li${classes} data-wd-rl="${relative}">${checkbox}${body}</li>\n`;
}

function renderList(list: List, state: State): string {
  const loose = list.spread === true;
  const hasTask = list.children.some((item) => item.checked === true || item.checked === false);
  const tag = list.ordered ? 'ol' : 'ul';
  const start = list.ordered && typeof list.start === 'number' && list.start !== 1;
  const attributes =
    (start ? ` start="${list.start}"` : '') + (hasTask ? ' class="contains-task-list"' : '');
  let items = '';
  for (const item of list.children) items += renderListItem(item, loose, state);
  return `<${tag}${attributes}>\n${items}</${tag}>\n`;
}

function renderTable(table: Table, state: State): string {
  const align = (index: number): string => {
    const value = table.align?.[index];
    return value ? ` class="align-${value}"` : '';
  };
  const row = (cells: Table['children'][number], tag: 'th' | 'td'): string => {
    const relative = Math.max(0, lineOf(cells) - state.blockStart);
    let html = `<tr data-wd-rl="${relative}">\n`;
    cells.children.forEach((cell, index) => {
      html += `<${tag}${align(index)}>${renderPhrasing(cell.children, state)}</${tag}>\n`;
    });
    return `${html}</tr>\n`;
  };
  const [head, ...rest] = table.children;
  if (!head) return '';
  let html = `<table>\n<thead>\n${row(head, 'th')}</thead>\n`;
  if (rest.length > 0) html += `<tbody>\n${rest.map((r) => row(r, 'td')).join('')}</tbody>\n`;
  return `${html}</table>\n`;
}

// ---- frontmatter -------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** The YAML of the frontmatter, or null if it is too large, invalid or not a mapping. */
function parseYaml(yaml: string): Record<string, unknown> | null {
  if (yaml.length > MAX_YAML_CHARS || yaml.trim() === '') return null;
  try {
    const data = load(yaml, { json: true, maxAliases: 20 });
    return isPlainObject(data) ? data : null;
  } catch {
    return null;
  }
}

function renderYaml(yaml: string, state: State): string {
  const data = parseYaml(yaml);
  if (!data) return renderCodeCard(yaml, 'yaml');
  return renderFrontmatterHeader(data, !state.hasH1);
}

// ---- footnotes ---------------------------------------------------------------------------

/** The footnotes that are referenced, as one block at the end (as the Phase 1 pack does). */
function renderFootnotes(state: State): MdxBlock | null {
  const entries: { number: number; definition: FootnoteDefinition }[] = [];
  for (const [identifier, number] of state.footnoteNumbers) {
    const definition = state.footnoteDefinitions.get(identifier);
    if (definition) entries.push({ number, definition });
  }
  if (entries.length === 0) return null;
  state.ids = null;
  let items = '';
  const runs: string[] = [];
  let first = Number.POSITIVE_INFINITY;
  let last = 0;
  for (const { number, definition } of entries) {
    first = Math.min(first, lineOf(definition));
    last = Math.max(last, (definition.position?.end.line ?? 1) - 1);
    state.blockStart = lineOf(definition);
    let body = '';
    for (const child of definition.children) {
      body += renderNode(child, state);
      collectRuns(child, state.source, runs);
    }
    const count = Math.max(state.footnoteRefs.get(definition.identifier) ?? 1, 1);
    let backrefs = '';
    for (let i = 0; i < count; i++) {
      const id = i === 0 ? `fnref${number}` : `fnref${number}:${i}`;
      backrefs += ` <a href="#${id}" class="footnote-backref">↩︎</a>`;
    }
    body = body.endsWith('</p>\n')
      ? `${body.slice(0, -5)}${backrefs}</p>\n`
      : `${body}<p>${backrefs.trim()}</p>\n`;
    items += `<li id="fn${number}" class="footnote-item">${body}</li>\n`;
  }
  return {
    raw: `<hr class="footnotes-sep">\n<section class="footnotes">\n<ol class="footnotes-list">\n${items}</ol>\n</section>\n`,
    line: first,
    endLine: Math.max(last, first),
    ids: null,
    runs,
  };
}

// ---- the document ------------------------------------------------------------------------

export function renderDocument(tree: Root, source: string): MdxDocument {
  const state: State = {
    source,
    slugger: new Slugger(),
    headings: [],
    definitions: new Map(),
    footnoteDefinitions: new Map(),
    footnoteNumbers: new Map(),
    footnoteRefs: new Map(),
    hasH1: false,
    blockStart: 0,
    ids: null,
    languages: new Set(),
    math: false,
  };
  scan(tree, state);

  const blocks: MdxBlock[] = [];
  let frontmatter: Frontmatter | null = null;
  for (const node of tree.children) {
    if (node.type === 'definition' || node.type === 'footnoteDefinition') continue;
    const line = lineOf(node);
    const endLine = Math.max((node.position?.end.line ?? 1) - 1, line);
    state.blockStart = line;
    state.ids = null;
    const raw = renderNode(node, state);
    if (raw === '') continue;
    if (node.type === 'yaml') {
      const data = parseYaml(node.value);
      if (data) frontmatter = { data, line, endLine };
    }
    const runs: string[] = [];
    collectRuns(node, source, runs);
    blocks.push({ raw, line, endLine, ids: state.ids, runs });
  }
  const footnotes = renderFootnotes(state);
  if (footnotes) blocks.push(footnotes);
  return {
    blocks,
    headings: state.headings,
    frontmatter,
    languages: [...state.languages].sort(),
    math: state.math,
  };
}
