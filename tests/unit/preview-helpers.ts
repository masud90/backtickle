/**
 * Helpers shared by the preview tests. They need a DOM, so the tests that use them run in jsdom
 * (`// @vitest-environment jsdom`, which DOMPurify needs as well).
 */

// ---- normalizer: a port of normalize.py of the CommonMark specification repository -------------

const BLOCK_TAGS = new Set(
  (
    'article header aside hgroup blockquote hr iframe body li map button object canvas ol caption ' +
    'output col p colgroup pre dd progress div section dl table td dt tbody embed textarea ' +
    'fieldset tfoot figcaption th figure thead footer tr form ul h1 h2 h3 h4 h5 h6 video script style'
  ).split(' '),
);

let decoder: HTMLElement | undefined;

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  decoder ??= document.createElement('div');
  const element = decoder;
  return text.replace(/&(?:#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (reference) => {
    element.innerHTML = reference;
    return element.textContent ?? reference;
  });
}

const TOKEN =
  /<!--[\s\S]*?-->|<![^>]*>|<\?[\s\S]*?>|<\/([A-Za-z][^\s>/]*)\s*>|<([A-Za-z][^\s>/]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/**
 * HTML in a form that ignores insignificant differences, the way the CommonMark test suite
 * compares output: white space around block elements, attribute order, entity spelling.
 */
export function normalizeHtml(html: string): string {
  let output = '';
  let last: 'starttag' | 'endtag' | 'data' | 'other' = 'starttag';
  let lastTag = '';
  let inPre = false;

  const data = (raw: string) => {
    let text = decodeEntities(raw);
    const afterTag = last === 'endtag' || last === 'starttag';
    const afterBlockTag = afterTag && BLOCK_TAGS.has(lastTag);
    if (afterTag && lastTag === 'br') text = text.replace(/^\n+/, '');
    if (!inPre) text = text.replace(/\s+/g, ' ');
    if (afterBlockTag && !inPre) {
      if (last === 'starttag') text = text.trimStart();
      else if (last === 'endtag') text = text.trim();
    }
    output += text;
    last = 'data';
  };

  const startTag = (name: string, attributes: string) => {
    const tag = name.toLowerCase();
    if (tag === 'pre') inPre = true;
    const pairs: Array<[string, string | null]> = [];
    for (const match of attributes.matchAll(ATTRIBUTE)) {
      const value = match[2] ?? match[3] ?? match[4];
      pairs.push([
        (match[1] ?? '').toLowerCase(),
        value === undefined ? null : decodeEntities(value),
      ]);
    }
    pairs.sort((a, b) => {
      if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
      return (a[1] ?? '') < (b[1] ?? '') ? -1 : 1;
    });
    output += `<${tag}`;
    for (const [key, value] of pairs) output += value === null ? ` ${key}` : ` ${key}="${value}"`;
    output += '>';
    lastTag = tag;
    last = 'starttag';
  };

  let position = 0;
  for (const match of html.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > position) data(html.slice(position, index));
    position = index + match[0].length;
    if (match[1] !== undefined) {
      const tag = match[1].toLowerCase();
      if (tag === 'pre') inPre = false;
      else if (BLOCK_TAGS.has(tag)) output = output.trimEnd();
      output += `</${tag}>`;
      lastTag = tag;
      last = 'endtag';
    } else if (match[2] !== undefined) {
      startTag(match[2], match[3] ?? '');
      if (match[4] === '/') last = 'endtag';
    } else {
      output += match[0];
      last = 'other';
    }
  }
  if (position < html.length) data(html.slice(position));
  return output.trim();
}

// ---- what the preview adds to the plain HTML ----------------------------------------------------

const CODE_CARD =
  /<div class="code-card" data-lang="[^"]*"><div class="code-card-header"><span class="code-card-lang">[^<]*<\/span><span class="code-card-actions"><\/span><\/div>(<pre>[\s\S]*?<\/pre>)<\/div>\n?/g;

/**
 * The raw HTML of the pipeline without the additions of the preview: the code card around `pre`,
 * the ids of headings and the relative line numbers of list items and table rows.
 */
export function plainHtml(html: string): string {
  return html
    .replace(CODE_CARD, '$1\n')
    .replace(/ data-wd-rl="\d+"/g, '')
    .replace(/<h([1-6]) id="[^"]*">/g, '<h$1>');
}

/** Parses HTML into a detached element, so the structure can be inspected. */
export function parseHtml(html: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}
