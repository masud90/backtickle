/**
 * Code chunks: ```` ```{r label, echo=FALSE} ```` and
 * ```` ```{python} ```` with `#|` option lines become
 *
 *   div.code-card.code-chunk[data-lang][data-label]
 *     > div.code-card-header > span.code-card-lang + span.chunk-label + span.chunk-options
 *         > span.chunk-option (one pill per option, `key: value`) + span.code-card-actions
 *     then pre > code (without the `#|` lines)
 *
 * A figure chunk (a caption, or a `fig-` label) is followed by `figure.chunk-figure#fig-x >
 * div.chunk-output-placeholder + figcaption`, so cross-references reach it. Nothing is ever run:
 * the chunk's output is never shown. Inline chunks `r x` and `{r} x` become `code.inline-chunk`,
 * which is not prose.
 */
import type { MarkdownIt, StateCore, Token } from 'markdown-it';
import type { Label } from '../../types';
import { languageLabel } from '../code';
import { wdEnv } from '../env';
import { escapeHtml } from '../escape';
import {
  type Chunk,
  chunkFigureKey,
  chunkListingKey,
  isFigureChunk,
  parseChunk,
  plainListing,
} from './chunk-parse';
import { captionLabel, idOfKey, optionsOf } from './labels';

/** The chunk a fence token was read as (the token's own `meta` is the Pandoc pack's). */
const chunkOf = new WeakMap<Token, Chunk>();
/** The listing a plain fence stands for (`{#lst-x .python lst-cap="..."}`). */
const listingOf = new WeakMap<Token, { key: string; cap: string }>();

/** The key of the figure a chunk token or a figure token stands for (set on `meta.xref`). */
export interface XrefMeta {
  xref: string;
}

function chunksRule(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const fence = tokens[i] as Token;
    if (fence.type !== 'fence') continue;
    const chunk = parseChunk(fence.info, fence.content);
    if (!chunk) {
      const plain = plainListing(fence.info);
      if (plain) listingOf.set(fence, plain);
      continue;
    }
    chunkOf.set(fence, chunk);
    fence.info = chunk.lang;
    fence.content = chunk.code;
    if (!isFigureChunk(chunk)) continue;

    const key = chunkFigureKey(chunk);
    const open = new state.Token('chunk_open', 'div', 1);
    open.block = true;
    open.map = fence.map;
    open.level = fence.level;
    open.attrSet('class', 'chunk');
    fence.level += 1;
    const figure = new state.Token('figure_open', 'figure', 1);
    figure.block = true;
    figure.level = fence.level;
    figure.attrSet('class', 'chunk-figure');
    if (key) {
      figure.attrSet('id', idOfKey(key));
      figure.meta = { xref: key } satisfies XrefMeta;
    }
    const placeholder = new state.Token('chunk_placeholder', '', 0);
    placeholder.block = true;
    placeholder.level = fence.level + 1;
    const captionOpen = new state.Token('figcaption_open', 'figcaption', 1);
    captionOpen.block = true;
    captionOpen.level = fence.level + 1;
    const inline = new state.Token('inline', '', 0);
    inline.content = chunk.figCap ?? '';
    inline.level = fence.level + 2;
    inline.map = fence.map;
    inline.children = [];
    const captionClose = new state.Token('figcaption_close', 'figcaption', -1);
    captionClose.block = true;
    captionClose.level = fence.level + 1;
    const figureClose = new state.Token('figure_close', 'figure', -1);
    figureClose.block = true;
    figureClose.level = fence.level;
    const close = new state.Token('chunk_close', 'div', -1);
    close.block = true;
    close.level = open.level;
    tokens.splice(
      i,
      1,
      open,
      fence,
      figure,
      placeholder,
      captionOpen,
      inline,
      captionClose,
      figureClose,
      close,
    );
    i += 8;
  }
}

function listingCaption(
  label: Label,
  cap: string,
  context: ReturnType<typeof wdEnv>['context'],
): string {
  const head = captionLabel(label, optionsOf(context), cap === '');
  return `<div class="listing-caption"><span class="caption-label">${escapeHtml(head)}</span> ${escapeHtml(cap)}</div>`;
}

function renderChunk(chunk: Chunk, context: ReturnType<typeof wdEnv>['context']): string {
  const language = escapeHtml(chunk.lang);
  let header = `<span class="code-card-lang">${escapeHtml(languageLabel(chunk.lang))}</span>`;
  if (chunk.label !== '') header += `<span class="chunk-label">${escapeHtml(chunk.label)}</span>`;
  if (chunk.options.length > 0) {
    header += '<span class="chunk-options">';
    for (const [key, value] of chunk.options) {
      header += `<span class="chunk-option">${escapeHtml(value === '' ? key : `${key}: ${value}`)}</span>`;
    }
    header += '</span>';
  }
  header += '<span class="code-card-actions"></span>';

  let id = '';
  let caption = '';
  const listing = chunkListingKey(chunk);
  if (listing) {
    id = ` id="${escapeHtml(idOfKey(listing))}"`;
    const label = context?.labels.get(listing);
    if (label) {
      caption = listingCaption(label, chunk.lstCap, context);
    }
  }
  const attrs = chunk.label === '' ? '' : ` data-label="${escapeHtml(chunk.label)}"`;
  return (
    `<div class="code-card code-chunk" data-lang="${language}"${attrs}${id}>` +
    `<div class="code-card-header">${header}</div>${caption}` +
    `<pre><code class="language-${language}">${escapeHtml(chunk.code)}</code></pre></div>\n`
  );
}

const INLINE_CHUNK = /^(?:\{(r|python|julia)\}|(r|python|julia))[ \t]+(\S[\s\S]*)$/;

function inlineChunksRule(state: StateCore): void {
  for (const block of state.tokens) {
    if (block.type !== 'inline' || !block.children) continue;
    for (const token of block.children) {
      if (token.type !== 'code_inline') continue;
      const match = INLINE_CHUNK.exec(token.content);
      if (!match) continue;
      token.type = 'inline_chunk';
      token.meta = { lang: match[1] ?? match[2] ?? '' };
      token.content = match[3] ?? '';
    }
  }
}

export function installChunks(md: MarkdownIt): void {
  md.core.ruler.before('wd_pandoc_fence', 'wd_quarto_chunks', chunksRule);
  md.core.ruler.after('wd_pandoc_figures', 'wd_quarto_inline_chunks', inlineChunksRule);
  const previous = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const chunk = token ? chunkOf.get(token) : undefined;
    if (!chunk) {
      const html = previous ? previous(tokens, idx, options, env, self) : '';
      const plain = token ? listingOf.get(token) : undefined;
      const context = wdEnv(env).context;
      const label = plain ? context?.labels.get(plain.key) : undefined;
      if (!plain || !label) return html;
      const caption = listingCaption(label, plain.cap, context);
      const at = html.indexOf('<pre>');
      return at < 0 ? html : `${html.slice(0, at)}${caption}${html.slice(at)}`;
    }
    return renderChunk(chunk, wdEnv(env).context);
  };
  md.renderer.rules.chunk_placeholder = () =>
    '<div class="chunk-output-placeholder">Figure output is not shown: code is never run</div>\n';
  md.renderer.rules.inline_chunk = (tokens, idx) => {
    const token = tokens[idx];
    const lang = escapeHtml(String(token?.meta?.lang ?? ''));
    return `<code class="inline-chunk" data-lang="${lang}">${escapeHtml(token?.content ?? '')}</code>`;
  };
}
