/**
 * The title block of the Pandoc family. It comes from the start of the
 * document, in one of three forms:
 *   - a YAML block (`---` ... `---` or `...`);
 *   - Pandoc's `%` lines: `% title`, `% authors separated by semicolons`, `% date`;
 *   - a MultiMarkdown header (`Key: value` lines up to a blank line), only in `.mmd` documents
 *     (the context says so: `metadata['wd:title-block'] === 'mmd'`).
 * and renders as
 *   header.wd-title-block > h1.title, p.subtitle, p.author (span.affiliation), p.date, div.abstract
 * It replaces the frontmatter header of the GFM pack. It is not part of the outline and not
 * counted as prose (it has no `inline` tokens).
 */
import { load } from 'js-yaml';
import type { MarkdownIt, StateBlock, Token } from 'markdown-it';
import { wdEnv } from '../env';
import { escapeHtml } from '../escape';

export const TITLE_BLOCK_KEY = 'wd:title-block';

const MAX_YAML_CHARS = 64 * 1024;
const MMD_KEY = /^([A-Za-z0-9][A-Za-z0-9 _-]*):[ \t]*(.*)$/;

export interface TitleBlock {
  kind: 'yaml' | 'percent' | 'mmd';
  data: Record<string, unknown>;
  /** Number of lines it takes, from the first line of the document. */
  lines: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseYaml(lines: readonly string[]): TitleBlock | null {
  if (!/^---[ \t]*$/.test(lines[0] ?? '')) return null;
  // Pandoc: the line after the opening one is not blank (else the line is a rule).
  if ((lines[1] ?? '').trim() === '') return null;
  for (let i = 1; i < lines.length; i++) {
    if (!/^(?:---|\.\.\.)[ \t]*$/.test(lines[i] as string)) continue;
    const yaml = lines.slice(1, i).join('\n');
    if (yaml.length > MAX_YAML_CHARS) return null;
    try {
      const data = load(yaml, { json: true, maxAliases: 20 });
      return isPlainObject(data) ? { kind: 'yaml', data, lines: i + 1 } : null;
    } catch {
      return null;
    }
  }
  return null;
}

function parsePercent(lines: readonly string[]): TitleBlock | null {
  if (!(lines[0] ?? '').startsWith('%')) return null;
  const fields: string[] = [];
  let index = 0;
  for (let field = 0; field < 3; field++) {
    const line = lines[index];
    if (line === undefined || !line.startsWith('%')) break;
    let text = line.slice(1).trim();
    index++;
    for (
      let next = lines[index];
      next !== undefined && /^[ \t]+\S/.test(next);
      next = lines[index]
    ) {
      text = `${text} ${next.trim()}`.trim();
      index++;
    }
    fields.push(text);
  }
  const data: Record<string, unknown> = {};
  if (fields[0]) data.title = fields[0];
  if (fields[1])
    data.author = fields[1]
      .split(';')
      .map((name) => name.trim())
      .filter(Boolean);
  if (fields[2]) data.date = fields[2];
  return { kind: 'percent', data, lines: index };
}

function parseMmd(lines: readonly string[]): TitleBlock | null {
  const data: Record<string, unknown> = {};
  let last = '';
  let index = 0;
  for (; index < lines.length; index++) {
    const line = lines[index] as string;
    if (line.trim() === '') break;
    const match = MMD_KEY.exec(line);
    if (match?.[1] !== undefined && !/^[ \t]/.test(line)) {
      last = match[1].trim().toLowerCase();
      data[last] = (match[2] ?? '').trim();
    } else if (/^[ \t]/.test(line) && last !== '') {
      data[last] = `${String(data[last])} ${line.trim()}`.trim();
    } else {
      return null;
    }
  }
  return index === 0 ? null : { kind: 'mmd', data, lines: index };
}

/** The title block at the start of the lines of a document, or null. */
export function parseTitleBlock(lines: readonly string[], mmd: boolean): TitleBlock | null {
  const first = lines[0] ?? '';
  if (first.startsWith('---')) return parseYaml(lines);
  if (first.startsWith('%')) return parsePercent(lines);
  if (mmd) return parseMmd(lines);
  return null;
}

// ---- the header ---------------------------------------------------------------------------

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

interface Author {
  name: string;
  affiliations: string[];
}

function affiliationList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : [value];
  return items
    .map((item) => (isPlainObject(item) ? text(item.name) : text(item)))
    .filter((item) => item !== '');
}

function authorsOf(value: unknown): Author[] {
  const items = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const authors: Author[] = [];
  for (const item of items) {
    if (isPlainObject(item)) {
      const name = text(item.name) || text(item.literal);
      if (name === '') continue;
      authors.push({
        name,
        affiliations: [
          ...affiliationList(item.affiliations),
          ...affiliationList(item.affiliation),
        ].filter((entry) => entry !== 'undefined'),
      });
    } else if (text(item) !== '') {
      authors.push({ name: text(item), affiliations: [] });
    }
  }
  return authors;
}

export function renderTitleBlock(md: MarkdownIt, data: Record<string, unknown>): string {
  const inline = (value: string): string => md.renderInline(value, {});
  let html = '<header class="wd-title-block">';
  const title = text(data.title);
  if (title !== '') html += `<h1 class="title">${inline(title)}</h1>`;
  const subtitle = text(data.subtitle);
  if (subtitle !== '') html += `<p class="subtitle">${inline(subtitle)}</p>`;
  for (const author of authorsOf(data.author ?? data.authors)) {
    html += `<p class="author">${escapeHtml(author.name)}`;
    for (const affiliation of author.affiliations) {
      html += ` <span class="affiliation">${escapeHtml(affiliation)}</span>`;
    }
    html += '</p>';
  }
  const date = text(data.date);
  if (date !== '') html += `<p class="date">${escapeHtml(date)}</p>`;
  const abstract = text(data.abstract);
  if (abstract !== '') html += `<div class="abstract"><p>${inline(abstract)}</p></div>`;
  return `${html}</header>\n`;
}

// ---- the rule -----------------------------------------------------------------------------

function titleBlockRule(): (
  state: StateBlock,
  start: number,
  end: number,
  silent: boolean,
) => boolean {
  return (state, startLine, endLine, silent) => {
    if (startLine !== 0 || state.level !== 0 || state.parentType !== 'root') return false;
    const wd = wdEnv(state.env);
    if (wd.lineOffset !== 0 || (state.tShift[0] ?? 0) !== 0) return false;
    const first = state.src.charCodeAt(state.bMarks[0] ?? 0);
    if (first !== 0x2d && first !== 0x25 && wd.context?.metadata[TITLE_BLOCK_KEY] !== 'mmd') {
      return false;
    }
    // The head of the document is enough: up to the end of the YAML block, or a few lines.
    const lines: string[] = [];
    let size = 0;
    for (let line = 0; line < endLine; line++) {
      const text = state.src.slice(state.bMarks[line], state.eMarks[line]);
      lines.push(text);
      size += text.length;
      if (first === 0x2d ? line > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(text) : line >= 200) break;
      if (size > MAX_YAML_CHARS) break;
    }
    const block = parseTitleBlock(lines, wd.context?.metadata[TITLE_BLOCK_KEY] === 'mmd');
    if (!block) return false;
    if (silent) return true;
    state.line = block.lines;
    const token: Token = state.push('title_block', 'header', 0);
    token.block = true;
    token.map = [0, block.lines];
    token.meta = { data: block.data, kind: block.kind };
    if (block.kind === 'yaml') {
      wd.frontmatter = { data: block.data, line: 0, endLine: block.lines - 1 };
    }
    return true;
  };
}

export function installTitleBlock(md: MarkdownIt): void {
  md.block.ruler.before('code', 'wd_title_block', titleBlockRule());
  md.renderer.rules.title_block = (tokens, idx) => {
    const data = tokens[idx]?.meta?.data;
    return isPlainObject(data) ? renderTitleBlock(md, data) : '';
  };
}
