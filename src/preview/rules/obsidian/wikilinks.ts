/**
 * Wikilinks and embeds:
 *
 *   [[Note]]  [[Note|alias]]  [[Note#Heading]]  [[Note#^block]]  [[#Heading]]
 *   ![[image.png]]  ![[image.png|300]]  ![[image.png|300x200]]  ![[Note]]  ![[Note#Heading]]
 *   ![[Note#^block]]  ![[report.pdf]]
 *
 * A wikilink is an `a.wikilink[data-target][data-heading][data-block]`. A resolved one has a real
 * `href` (the note's path seen from the note in the tab, then `#heading-slug` or `#^block`), so the
 * shell's ordinary link handling opens it and scrolls to the heading or block; an unresolved one
 * has `.is-unresolved` and no `href`. Link text is link text (it counts as prose).
 *
 * An embed of a note, a section or a block is a block: `div.embed > div.embed-title +
 * div.embed-content`. The content is empty here; the preview fills it after sanitizing (see
 * `embed-enhance.ts`), so it is never part of the words or the outline. Images are `img` with the
 * size as `data-wd-width` / `data-wd-height`, and other files a link card.
 */
import type { MarkdownIt, Renderer, StateCore, StateInline, Token } from 'markdown-it';
import { slugify } from '../../slug';
import { wdEnv } from '../env';
import { escapeHtml } from '../escape';
import { scopeOf } from './context';
import {
  extensionOf,
  IMAGE_EXTENSIONS,
  NOTE_EXTENSIONS,
  noteName,
  relativeHref,
  resolveFile,
  resolveNote,
} from './resolve';

const OPEN_BRACKET = 0x5b;
const BANG = 0x21;

export interface WikiParts {
  target: string;
  heading: string | null;
  block: string | null;
  /** The text after `|`. */
  alias: string | null;
}

/** Splits what is inside `[[` and `]]`. */
export function parseWikiParts(inner: string): WikiParts | null {
  let head = inner;
  let alias: string | null = null;
  const bar = inner.indexOf('|');
  if (bar >= 0) {
    // In a table cell the bar is written `\|`.
    head = inner.slice(0, bar).replace(/\\$/, '');
    alias = inner.slice(bar + 1).trim();
  }
  const hash = head.indexOf('#');
  const target = (hash >= 0 ? head.slice(0, hash) : head).trim();
  let heading: string | null = null;
  let block: string | null = null;
  if (hash >= 0) {
    const fragment = head.slice(hash + 1).trim();
    if (fragment.startsWith('^')) block = fragment.slice(1).trim();
    else heading = (fragment.split('#').pop() ?? '').trim();
    if (heading === '') heading = null;
    if (block === '') block = null;
  }
  if (target === '' && heading === null && block === null) return null;
  return { target, heading, block, alias };
}

/** The text between `[[` at `start` and its `]]`, or null. No brackets or line ends inside. */
function readInner(src: string, start: number, max: number): { inner: string; end: number } | null {
  for (let i = start; i < max; i++) {
    const code = src.charCodeAt(i);
    if (code === 0x0a || code === OPEN_BRACKET) return null;
    if (code === 0x5d) {
      if (src.charCodeAt(i + 1) !== 0x5d || i === start) return null;
      return { inner: src.slice(start, i), end: i + 2 };
    }
  }
  return null;
}

const FILE_EXTENSIONS = new Set([
  'pdf',
  'mp3',
  'm4a',
  'wav',
  'ogg',
  'flac',
  'mp4',
  'webm',
  'mov',
  'mkv',
  'ogv',
  'docx',
  'doc',
  'xlsx',
  'xls',
  'pptx',
  'ppt',
  'csv',
  'zip',
  'json',
  'canvas',
]);

const SIZE = /^(\d{1,5})(?:x(\d{1,5}))?$/;

interface Embed {
  kind: 'image' | 'note' | 'file';
  parts: WikiParts;
  /** Path in the vault, or null. */
  path: string | null;
  /** Path seen from the note in the tab (percent-encoded), or null. */
  href: string | null;
  width: string | null;
  height: string | null;
  alt: string;
}

function resolveEmbed(state: StateInline, parts: WikiParts): Embed {
  const scope = scopeOf(wdEnv(state.env).context);
  const extension = extensionOf(parts.target);
  let kind: Embed['kind'] = 'note';
  if (IMAGE_EXTENSIONS.has(extension)) kind = 'image';
  else if (extension !== '' && !NOTE_EXTENSIONS.has(extension)) {
    // A dot in a note name ("Meeting 2024.05") does not make it a file.
    kind =
      FILE_EXTENSIONS.has(extension) || resolveFile(scope.vault, scope.note, parts.target) !== null
        ? 'file'
        : 'note';
  }
  const path =
    kind === 'note'
      ? resolveNote(scope.vault, scope.note, parts.target)
      : resolveFile(scope.vault, scope.note, parts.target);
  const href = path === null ? null : relativeHref(scope.hrefNote, path);
  let width: string | null = null;
  let height: string | null = null;
  let alt = parts.target;
  const size = parts.alias === null ? null : SIZE.exec(parts.alias);
  if (size) {
    width = `${size[1]}px`;
    if (size[2]) height = `${size[2]}px`;
  } else if (parts.alias !== null && parts.alias !== '') {
    alt = parts.alias;
  }
  return { kind, parts, path, href, width, height, alt };
}

function wikilinkRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== OPEN_BRACKET || src.charCodeAt(start + 1) !== OPEN_BRACKET) {
    return false;
  }
  const found = readInner(src, start + 2, state.posMax);
  if (!found) return false;
  const parts = parseWikiParts(found.inner);
  if (!parts) return false;
  if (!silent) pushWikilink(state, parts);
  state.pos = found.end;
  return true;
}

function displayOf(parts: WikiParts): string {
  if (parts.alias !== null && parts.alias !== '') return parts.alias;
  const name = parts.target === '' ? '' : parts.target;
  if (parts.heading !== null) return name === '' ? parts.heading : `${name} > ${parts.heading}`;
  if (parts.block !== null) return name === '' ? `^${parts.block}` : `${name} > ^${parts.block}`;
  return name;
}

/** The `href` of a link to `path` (or to the heading or block of the current note). */
function hrefOf(parts: WikiParts, noteHref: string | null): string {
  let fragment = '';
  if (parts.block !== null) fragment = `#${encodeURIComponent(`^${parts.block}`)}`;
  else if (parts.heading !== null) fragment = `#${encodeURIComponent(slugify(parts.heading))}`;
  return `${noteHref ?? ''}${fragment}`;
}

function pushWikilink(state: StateInline, parts: WikiParts, display = displayOf(parts)): void {
  const scope = scopeOf(wdEnv(state.env).context);
  const open = state.push('link_open', 'a', 1);
  open.info = 'wikilink';
  let resolved: boolean;
  let href: string | null = null;
  if (parts.target === '') {
    // A heading or block of this note: an anchor, no vault needed.
    resolved = true;
    href = hrefOf(parts, null);
  } else {
    const path = resolveNote(scope.vault, scope.note, parts.target);
    resolved = path !== null;
    if (path !== null) href = hrefOf(parts, relativeHref(scope.hrefNote, path));
  }
  open.attrSet('class', resolved ? 'wikilink' : 'wikilink is-unresolved');
  if (href !== null) open.attrSet('href', href);
  open.attrSet('data-target', parts.target);
  if (parts.heading !== null) open.attrSet('data-heading', parts.heading);
  if (parts.block !== null) open.attrSet('data-block', parts.block);
  const text = state.push('text', '', 0);
  text.content = display;
  state.push('link_close', 'a', -1);
}

function wikiEmbedRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (
    src.charCodeAt(start) !== BANG ||
    src.charCodeAt(start + 1) !== OPEN_BRACKET ||
    src.charCodeAt(start + 2) !== OPEN_BRACKET
  ) {
    return false;
  }
  const found = readInner(src, start + 3, state.posMax);
  if (!found) return false;
  const parts = parseWikiParts(found.inner);
  if (!parts || parts.target === '') return false;
  if (!silent) {
    const embed = resolveEmbed(state, parts);
    const token = state.push('wiki_embed', '', 0);
    token.meta = { embed };
    token.content = embed.alt;
  }
  state.pos = found.end;
  return true;
}

// ---- rendering --------------------------------------------------------------------------------

const attr = (name: string, value: string | null): string =>
  value === null ? '' : ` ${name}="${escapeHtml(value)}"`;

function embedTitle(parts: WikiParts): string {
  const name = noteName(parts.target);
  if (parts.heading !== null) return `${name} > ${parts.heading}`;
  if (parts.block !== null) return `${name} > ^${parts.block}`;
  return name;
}

function renderFileCard(embed: Embed): string {
  const resolved = embed.path !== null && embed.href !== null;
  const link = resolved
    ? `<a class="embed-link"${attr('href', embed.href)}>${escapeHtml(embed.parts.target)}</a>`
    : `<span class="embed-link">${escapeHtml(embed.parts.target)}</span>`;
  return `<div class="embed embed-file${resolved ? '' : ' is-unresolved'}"${attr('data-target', embed.parts.target)}><div class="embed-title">${link}</div></div>\n`;
}

function renderNoteCard(embed: Embed, abs: string): string {
  const { parts } = embed;
  const resolved = embed.path !== null && embed.href !== null;
  const content = resolved
    ? ''
    : `<p class="embed-note">Note not found: ${escapeHtml(parts.target)}</p>`;
  return (
    `<div class="${resolved ? 'embed' : 'embed is-unresolved'}"${attr('data-target', parts.target)}` +
    `${attr('data-heading', parts.heading)}${attr('data-block', parts.block)}` +
    `${resolved ? attr('data-href', embed.href) + attr('data-from', abs) : ''}>` +
    `<div class="embed-title">${escapeHtml(embedTitle(parts))}</div>` +
    `<div class="embed-content">${content}</div></div>\n`
  );
}

function renderImage(embed: Embed): string {
  // An image that is not in the index still gets its name as the source: the preview then shows
  // the "image not found" placeholder.
  const source = embed.href ?? encodeURIComponent(embed.parts.target);
  return (
    `<img src="${escapeHtml(source)}" alt="${escapeHtml(embed.alt)}"` +
    `${attr('data-wd-width', embed.width)}${attr('data-wd-height', embed.height)}>`
  );
}

function renderWikiEmbed(
  tokens: Token[],
  idx: number,
  _options: unknown,
  _env: unknown,
  _renderer: Renderer,
): string {
  const embed = tokens[idx]?.meta?.embed as Embed;
  if (embed.kind === 'image') return renderImage(embed);
  // A note or file embed in the middle of text is a link to it.
  const text = escapeHtml(embedTitle(embed.parts));
  if (embed.href === null) {
    return `<a class="wikilink is-unresolved"${attr('data-target', embed.parts.target)}>${text}</a>`;
  }
  return `<a class="wikilink"${attr('href', embed.href)}${attr('data-target', embed.parts.target)}>${text}</a>`;
}

function renderEmbedBlock(
  tokens: Token[],
  idx: number,
  _options: unknown,
  env: unknown,
  _renderer: Renderer,
): string {
  const embed = tokens[idx]?.meta?.embed as Embed;
  if (embed.kind === 'file') return renderFileCard(embed);
  const abs = scopeOf(wdEnv(env as never).context).abs;
  return renderNoteCard(embed, abs);
}

/**
 * Runs after the inline rules: a paragraph that holds only note or file embeds becomes one block
 * per embed (a `div` cannot sit inside a paragraph).
 */
function liftEmbedsRule(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 0; i + 2 < tokens.length; i++) {
    const open = tokens[i];
    const inline = tokens[i + 1];
    const close = tokens[i + 2];
    if (open?.type !== 'paragraph_open' || inline?.type !== 'inline') continue;
    if (close?.type !== 'paragraph_close') continue;
    const children = inline.children ?? [];
    const embeds = children.filter((child) => child.type === 'wiki_embed');
    if (embeds.length === 0) continue;
    const onlyEmbeds = children.every(
      (child) =>
        child.type === 'wiki_embed' ||
        child.type === 'softbreak' ||
        (child.type === 'text' && child.content.trim() === ''),
    );
    if (
      !onlyEmbeds ||
      embeds.some((child) => (child.meta as { embed: Embed }).embed.kind === 'image')
    )
      continue;
    const blocks = embeds.map((child) => {
      const block = new state.Token('wiki_embed_block', '', 0);
      block.block = true;
      block.level = open.level;
      block.map = open.map;
      block.meta = child.meta;
      return block;
    });
    tokens.splice(i, 3, ...blocks);
    i += blocks.length - 1;
  }
}

export function installWikilinks(md: MarkdownIt): void {
  md.inline.ruler.before('link', 'wd_wikilink', wikilinkRule);
  md.inline.ruler.before('image', 'wd_wiki_embed', wikiEmbedRule);
  md.core.ruler.after('inline', 'wd_wiki_embeds', liftEmbedsRule);
  md.renderer.rules.wiki_embed = renderWikiEmbed;
  md.renderer.rules.wiki_embed_block = renderEmbedBlock;
}
