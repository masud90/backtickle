/**
 * Code cards: every fenced or indented code block is rendered as
 *
 *   div.code-card[data-lang] > div.code-card-header > span.code-card-lang + span.code-card-actions
 *   then pre > code
 *
 * The Copy button (in `span.code-card-actions`) and the token colors are added by the preview
 * after sanitizing, so nothing from the document can supply them.
 */
import type { MarkdownIt } from 'markdown-it';
import { hashString } from '../hash';
import { escapeHtml } from './escape';

/** Display names for the languages people write most often, by lower-case info word. */
const LANGUAGE_LABELS = new Map<string, string>(
  Object.entries({
    bash: 'Bash',
    c: 'C',
    clojure: 'Clojure',
    cpp: 'C++',
    'c++': 'C++',
    cs: 'C#',
    csharp: 'C#',
    css: 'CSS',
    dart: 'Dart',
    diff: 'Diff',
    dockerfile: 'Dockerfile',
    elixir: 'Elixir',
    go: 'Go',
    golang: 'Go',
    graphql: 'GraphQL',
    haskell: 'Haskell',
    html: 'HTML',
    java: 'Java',
    javascript: 'JavaScript',
    js: 'JavaScript',
    json: 'JSON',
    jsx: 'JSX',
    julia: 'Julia',
    kotlin: 'Kotlin',
    latex: 'LaTeX',
    lua: 'Lua',
    make: 'Makefile',
    makefile: 'Makefile',
    markdown: 'Markdown',
    md: 'Markdown',
    perl: 'Perl',
    php: 'PHP',
    plain: 'Text',
    plaintext: 'Text',
    powershell: 'PowerShell',
    py: 'Python',
    python: 'Python',
    r: 'R',
    rb: 'Ruby',
    ruby: 'Ruby',
    rs: 'Rust',
    rust: 'Rust',
    scala: 'Scala',
    scss: 'SCSS',
    sh: 'Shell',
    shell: 'Shell',
    sql: 'SQL',
    swift: 'Swift',
    tex: 'LaTeX',
    text: 'Text',
    toml: 'TOML',
    ts: 'TypeScript',
    tsx: 'TSX',
    txt: 'Text',
    typescript: 'TypeScript',
    xml: 'XML',
    yaml: 'YAML',
    yml: 'YAML',
    zsh: 'Zsh',
  }),
);

/** The label in the header of a code card. */
export function languageLabel(lang: string): string {
  if (lang === '') return 'Text';
  const known = LANGUAGE_LABELS.get(lang.toLowerCase());
  if (known) return known;
  return lang.charAt(0).toUpperCase() + lang.slice(1);
}

/** The first word of the info string of a fence, with escapes and entities resolved. */
export function fenceLanguage(md: MarkdownIt, info: string): string {
  const resolved = info ? md.utils.unescapeAll(info).trim() : '';
  return resolved ? (resolved.split(/\s+/)[0] ?? '') : '';
}

export function renderCodeCard(code: string, lang: string): string {
  const safeLang = escapeHtml(lang);
  const languageClass = lang === '' ? '' : ` class="language-${safeLang}"`;
  return (
    `<div class="code-card" data-lang="${safeLang}">` +
    `<div class="code-card-header"><span class="code-card-lang">${escapeHtml(languageLabel(lang))}</span>` +
    '<span class="code-card-actions"></span></div>' +
    `<pre><code${languageClass}>${escapeHtml(code)}</code></pre></div>\n`
  );
}

/** Fenced and indented code as code cards. */
export function installCodeRules(md: MarkdownIt): void {
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    if (!token) return '';
    return renderCodeCard(token.content, fenceLanguage(md, token.info));
  };
  md.renderer.rules.code_block = (tokens, idx) => {
    const token = tokens[idx];
    if (!token) return '';
    return renderCodeCard(token.content, '');
  };
}

/**
 * Mermaid fences: ```` ```mermaid ```` becomes `div.mermaid-diagram[data-diagram-key] >
 * pre.mermaid-source`, the placeholder that the preview fills with an SVG after sanitizing
 * (`src/preview/mermaid/`). A function that a pack installs: GFM does now, Obsidian builds on the
 * GFM rules, Quarto passes `braced: true` to take ```` ```{mermaid} ```` chunks as well.
 * Install it after `installCodeRules`: it wraps the fence renderer that is there.
 */
export function installMermaidFence(md: MarkdownIt, options: { braced?: boolean } = {}): void {
  const previous = md.renderer.rules.fence;
  const names = options.braced ? new Set(['mermaid', '{mermaid}']) : new Set(['mermaid']);
  md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
    const token = tokens[idx];
    if (token && names.has(fenceLanguage(md, token.info).toLowerCase())) {
      return (
        `<div class="mermaid-diagram" data-diagram-key="${hashString(token.content)}">` +
        `<pre class="mermaid-source">${escapeHtml(token.content)}</pre></div>\n`
      );
    }
    return previous ? previous(tokens, idx, opts, env, self) : '';
  };
}

/**
 * Graphviz fences: ```` ```dot ```` and ```` ```graphviz ```` become `div.graphviz-diagram[data-diagram-key]
 * > pre.graphviz-source`, the placeholder that the preview fills with an SVG after sanitizing
 * (`src/preview/graphviz/`). Installed by GFM (Obsidian builds on it), Pandoc / MMD and Quarto /
 * RMD; not by CommonMark or MDX. Quarto passes `braced: true` to take ```` ```{dot} ```` chunks too.
 * Install it after `installCodeRules`: it wraps the fence renderer that is there.
 */
export function installGraphvizFence(md: MarkdownIt, options: { braced?: boolean } = {}): void {
  const previous = md.renderer.rules.fence;
  const names = options.braced
    ? new Set(['dot', 'graphviz', '{dot}', '{graphviz}'])
    : new Set(['dot', 'graphviz']);
  md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
    const token = tokens[idx];
    if (token && names.has(fenceLanguage(md, token.info).toLowerCase())) {
      return (
        `<div class="graphviz-diagram" data-diagram-key="${hashString(token.content)}">` +
        `<pre class="graphviz-source">${escapeHtml(token.content)}</pre></div>\n`
      );
    }
    return previous ? previous(tokens, idx, opts, env, self) : '';
  };
}
