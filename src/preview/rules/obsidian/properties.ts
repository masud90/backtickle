/**
 * Properties: the YAML frontmatter of an Obsidian note is shown as
 * `table.properties` with one row per key. Lists, and every value of `tags`, are pills
 * (`span.tag`); dates stay as written; a mapping is shown as compact JSON. The table has no
 * `inline` tokens, so it is not prose and not in the outline.
 */
import type { Env, MarkdownIt, Renderer, Token } from 'markdown-it';
import { escapeHtml } from '../escape';

const MAX_ROWS = 40;
const MAX_TEXT = 300;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function shorten(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT - 1)}…` : clean;
}

function textOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return shorten(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return shorten(JSON.stringify(value) ?? '');
  } catch {
    return '';
  }
}

function pill(text: string, hash: boolean): string {
  return `<span class="tag">${hash ? '#' : ''}${escapeHtml(text)}</span>`;
}

function renderValue(key: string, value: unknown): string {
  const isTags = key === 'tags' || key === 'tag';
  const items = Array.isArray(value) ? value : isTags && typeof value === 'string' ? [value] : null;
  if (items) {
    const pills = items
      .map((item) => textOf(item))
      .filter((text) => text !== '')
      .map((text) => pill(isTags ? text.replace(/^#/, '') : text, isTags));
    return pills.join(' ');
  }
  return escapeHtml(textOf(value));
}

/** The HTML of the properties table for parsed YAML. */
export function renderProperties(data: Record<string, unknown>): string {
  const rows = Object.keys(data).slice(0, MAX_ROWS);
  let html = '<table class="properties"><tbody>';
  for (const key of rows) {
    html += `<tr><th scope="row">${escapeHtml(shorten(key))}</th><td>${renderValue(key, data[key])}</td></tr>`;
  }
  return `${html}</tbody></table>\n`;
}

function renderFrontmatter(
  tokens: Token[],
  idx: number,
  _options: unknown,
  _env: Env | undefined,
  _renderer: Renderer,
): string {
  const data = tokens[idx]?.meta?.data;
  return isPlainObject(data) ? renderProperties(data) : '';
}

/** Replaces the GFM frontmatter header (the frontmatter rule itself stays). */
export function installProperties(md: MarkdownIt): void {
  md.renderer.rules.frontmatter = renderFrontmatter;
}
