/**
 * Code in the Pandoc packs: the attributes of a fenced block and raw blocks.
 *
 *   ```python              the language
 *   ```{.python #id}       the language, and an id
 *   ```{=html}             raw HTML: part of the page (sanitized like any other raw HTML)
 *   ```{=latex}            raw LaTeX and other formats: a code card labelled "Raw LaTeX"
 *
 * A core rule reads the info string of every fence once, so the rest of the pipeline (the list of
 * languages, the renderer) sees the plain language in `token.info` and the rest in `token.meta`.
 */
import type { MarkdownIt, StateCore } from 'markdown-it';
import { languageLabel } from '../code';
import { escapeHtml } from '../escape';
import { BRACED, docClasses, parseAttributes } from './attributes';

type FenceMeta = {
  /** The format of a raw block, or ''. */
  raw: string;
  id: string;
  classes: string[];
};

const HTML_FORMATS = new Set(['html', 'html4', 'html5']);
const RAW_LABELS: Record<string, string> = {
  latex: 'Raw LaTeX',
  tex: 'Raw LaTeX',
  context: 'Raw ConTeXt',
  openxml: 'Raw OpenXML',
  opendocument: 'Raw OpenDocument',
  docx: 'Raw DOCX',
  rtf: 'Raw RTF',
  markdown: 'Raw Markdown',
  rst: 'Raw reStructuredText',
  typst: 'Raw Typst',
};

/** The info string of a fence: a language, braces with attributes, or both. */
function readInfo(info: string): { language: string; meta: FenceMeta } {
  const meta: FenceMeta = { raw: '', id: '', classes: [] };
  const text = info.trim();
  let language = '';
  let braces = '';
  if (text.startsWith('{')) {
    braces = text;
  } else {
    const space = text.search(/\s/);
    language = space < 0 ? text : text.slice(0, space);
    braces = space < 0 ? '' : text.slice(space).trim();
  }
  if (braces !== '') {
    const braced = BRACED.exec(braces);
    const attrs =
      braced && braced[0].length === braces.length ? parseAttributes(braced[1] ?? '') : null;
    if (attrs) {
      meta.raw = attrs.raw;
      meta.id = attrs.id;
      meta.classes = attrs.classes;
      if (language === '' && attrs.raw === '') language = attrs.classes[0] ?? '';
    }
  }
  return { language, meta };
}

function fenceRule(state: StateCore): void {
  for (const token of state.tokens) {
    if (token.type !== 'fence') continue;
    const { language, meta } = readInfo(token.info);
    token.info = language;
    token.meta = meta;
    if (meta.raw !== '' && HTML_FORMATS.has(meta.raw)) {
      // Raw HTML is part of the page, like an HTML block (and counted like one).
      token.type = 'html_block';
      token.tag = '';
      token.content = token.content.endsWith('\n') ? token.content : `${token.content}\n`;
    }
  }
}

function rawLabel(format: string): string {
  return RAW_LABELS[format] ?? `Raw ${format.toUpperCase()}`;
}

function card(
  label: string,
  language: string,
  code: string,
  id: string,
  classes: string[],
): string {
  const safe = escapeHtml(language);
  const extra = docClasses(classes);
  const attrs =
    (extra.length > 0
      ? ` class="code-card ${escapeHtml(extra.join(' '))}"`
      : ' class="code-card"') + (id === '' ? '' : ` id="${escapeHtml(id)}"`);
  return (
    `<div${attrs} data-lang="${safe}">` +
    `<div class="code-card-header"><span class="code-card-lang">${escapeHtml(label)}</span>` +
    '<span class="code-card-actions"></span></div>' +
    `<pre><code${language === '' ? '' : ` class="language-${safe}"`}>${escapeHtml(code)}</code></pre></div>\n`
  );
}

export function installPandocCode(md: MarkdownIt): void {
  md.core.ruler.after('block', 'wd_pandoc_fence', fenceRule);
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    if (!token) return '';
    const meta = (token.meta ?? { raw: '', id: '', classes: [] }) as unknown as FenceMeta;
    if (meta.raw !== '') {
      return card(rawLabel(meta.raw), meta.raw, token.content, meta.id, meta.classes);
    }
    const language = md.utils.unescapeAll(token.info).trim();
    return card(languageLabel(language), language, token.content, meta.id, meta.classes);
  };
}
