/**
 * YAML frontmatter (GFM only). A block that starts on the first line with `---` and ends with a
 * line `---` or `...` is frontmatter if it parses (js-yaml, core schema: no code tags) to a
 * mapping. Anything else, including an empty block or a list, stays ordinary Markdown.
 *
 * It renders as `header.wd-frontmatter`: tags (`tags`, `tag`, `keywords`, as a list or a comma
 * separated string) as pills; `version`, `date` and `author` as muted text on the right ("Version
 * 2.4.0"); the `title` as the heading of the page when the document has no heading of level 1
 * of its own; the other scalar keys as a compact muted list.
 */
import { load } from 'js-yaml';
import type { Env, MarkdownIt, Renderer, StateBlock, Token } from 'markdown-it';
import { wdEnv } from './env';
import { escapeHtml } from './escape';

/** Larger frontmatter is not read: it is far more likely a mistake than metadata. */
const MAX_YAML_CHARS = 64 * 1024;
const OPENING = /^---[ \t]*$/;
const CLOSING = /^(?:---|\.\.\.)[ \t]*$/;

const TAG_KEYS = ['tags', 'tag', 'keywords'] as const;
const TITLE_KEY = 'title';
const INFO_KEYS = ['version', 'date', 'author'] as const;
const SPECIAL_KEYS = new Set<string>([TITLE_KEY, ...TAG_KEYS, ...INFO_KEYS]);

const MAX_TAGS = 20;
const MAX_FIELDS = 10;
const MAX_VALUE_CHARS = 120;

type Scalar = string | number | boolean;

function isScalar(value: unknown): value is Scalar {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownValue(data: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(data, key) ? data[key] : undefined;
}

function shorten(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > MAX_VALUE_CHARS ? `${clean.slice(0, MAX_VALUE_CHARS - 1)}…` : clean;
}

function line(state: StateBlock, index: number): string {
  const from = (state.bMarks[index] ?? 0) + (state.tShift[index] ?? 0);
  return state.src.slice(from, state.eMarks[index] ?? from);
}

function frontmatterRule(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  // Only at the very top of the document, not indented, not inside anything.
  if (startLine !== 0 || state.level !== 0 || state.parentType !== 'root') return false;
  // A window that starts further down the document is not its top.
  if (wdEnv(state.env).lineOffset !== 0) return false;
  if ((state.tShift[0] ?? 0) !== 0 || !OPENING.test(line(state, 0))) return false;

  let closing = -1;
  for (let i = 1; i < endLine; i++) {
    if ((state.tShift[i] ?? 0) === 0 && CLOSING.test(line(state, i))) {
      closing = i;
      break;
    }
  }
  if (closing < 2) return false; // not closed, or nothing between the delimiters

  const yaml = state.src.slice(state.bMarks[1] ?? 0, state.bMarks[closing] ?? 0);
  if (yaml.length > MAX_YAML_CHARS) return false;
  let data: unknown;
  try {
    data = load(yaml, { json: true, maxAliases: 20 });
  } catch {
    return false;
  }
  if (!isPlainObject(data)) return false;
  if (silent) return true;

  state.line = closing + 1;
  const token = state.push('frontmatter', 'header', 0);
  token.block = true;
  token.map = [0, closing + 1];
  token.content = yaml;
  token.meta = { data };
  wdEnv(state.env).frontmatter = { data, line: 0, endLine: closing };
  return true;
}

// ---- the header ---------------------------------------------------------------------------

interface Tag {
  text: string;
  hash: boolean;
}

function splitTags(text: string): string[] {
  if (text.includes(',')) return text.split(',');
  // "#tech-spec #distributed-sys": hash tags separated by spaces.
  if (/^\s*#\S/.test(text)) return text.split(/\s+/);
  return [text];
}

function collectTags(data: Record<string, unknown>): Tag[] {
  const found: Tag[] = [];
  const seen = new Set<string>();
  for (const key of TAG_KEYS) {
    const value = ownValue(data, key);
    let items: string[] = [];
    if (typeof value === 'string') items = splitTags(value);
    else if (Array.isArray(value)) items = value.filter(isScalar).map(String);
    for (const item of items) {
      const text = shorten(item.trim().replace(/^#+/, ''));
      const id = text.toLowerCase();
      if (text === '' || seen.has(id)) continue;
      seen.add(id);
      found.push({ text, hash: key !== 'keywords' });
      if (found.length >= MAX_TAGS) return found;
    }
  }
  return found;
}

function collectInfo(data: Record<string, unknown>): string[] {
  const info: string[] = [];
  const version = ownValue(data, 'version');
  if (isScalar(version) && String(version).trim() !== '') {
    info.push(`Version ${shorten(String(version))}`);
  }
  const date = ownValue(data, 'date');
  if (isScalar(date) && String(date).trim() !== '') info.push(shorten(String(date)));
  const author = ownValue(data, 'author');
  const authors = Array.isArray(author) ? author.filter(isScalar).map(String) : [author];
  const names = authors
    .filter(isScalar)
    .map((name) => String(name).trim())
    .filter(Boolean);
  if (names.length > 0) info.push(shorten(names.join(', ')));
  return info;
}

function collectFields(data: Record<string, unknown>): Array<[string, string]> {
  const fields: Array<[string, string]> = [];
  for (const key of Object.keys(data)) {
    if (SPECIAL_KEYS.has(key)) continue;
    const value = data[key];
    if (!isScalar(value) || String(value).trim() === '') continue;
    fields.push([shorten(key), shorten(String(value))]);
    if (fields.length >= MAX_FIELDS) break;
  }
  return fields;
}

/** The HTML of the header for the parsed YAML. `showTitle`: the document has no H1 of its own. */
export function renderFrontmatterHeader(data: Record<string, unknown>, showTitle: boolean): string {
  const tags = collectTags(data);
  const info = collectInfo(data);
  const fields = collectFields(data);
  const titleValue = ownValue(data, TITLE_KEY);
  const title = showTitle && isScalar(titleValue) ? shorten(String(titleValue)) : '';

  let html = '<header class="wd-frontmatter">';
  if (tags.length > 0 || info.length > 0) {
    html += '<div class="wd-frontmatter-meta">';
    if (tags.length > 0) {
      html += '<ul class="wd-tags">';
      for (const tag of tags) {
        html += `<li class="wd-tag">${tag.hash ? '#' : ''}${escapeHtml(tag.text)}</li>`;
      }
      html += '</ul>';
    }
    for (const text of info) {
      html += `<span class="wd-frontmatter-info">${escapeHtml(text)}</span>`;
    }
    html += '</div>';
  }
  if (title !== '') html += `<h1 class="wd-frontmatter-title">${escapeHtml(title)}</h1>`;
  if (fields.length > 0) {
    html += '<dl class="wd-frontmatter-fields">';
    for (const [name, value] of fields) {
      html += `<div><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd></div>`;
    }
    html += '</dl>';
  }
  return `${html}</header>\n`;
}

function renderFrontmatter(
  tokens: Token[],
  idx: number,
  _options: unknown,
  env: Env | undefined,
  _renderer: Renderer,
): string {
  const data = tokens[idx]?.meta?.data;
  if (!isPlainObject(data)) return '';
  return renderFrontmatterHeader(data, !wdEnv(env).hasH1);
}

export function installFrontmatter(md: MarkdownIt): void {
  md.block.ruler.before('table', 'wd_frontmatter', frontmatterRule);
  md.renderer.rules.frontmatter = renderFrontmatter;
}
