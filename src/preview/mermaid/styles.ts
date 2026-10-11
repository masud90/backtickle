/**
 * Styles of a rendered diagram. The content security policy forbids `style` attributes
 * (`style-src-attr 'none'`), and Mermaid writes them (sizes, colors set by `style` statements).
 * After sanitizing, our code moves every one of them into rules of the SVG's own `<style>`
 * element, selected by a marker attribute of ours: `#<svg id> [data-wd-s="n"] { ... !important }`.
 * `!important` keeps the precedence an inline style had over Mermaid's id-scoped rules.
 *
 * Values are filtered: nothing that loads a resource (`url(` to anything but a `#fragment`),
 * imports or runs something.
 */

const FORBIDDEN_VALUE =
  /@import|expression\s*\(|javascript:|vbscript:|behavior|-moz-binding|\/\*|\*\/|[<>{}\\]/i;
const PROPERTY = /^-?[a-z][a-z-]*$/;

/** True for a declaration value that is safe to keep (no external `url()`, no scripts). */
export function safeValue(value: string): boolean {
  if (FORBIDDEN_VALUE.test(value)) return false;
  for (const match of value.matchAll(/url\s*\(\s*(['"]?)([^)'"]*)\1\s*\)/gi)) {
    if (!(match[2] ?? '').trim().startsWith('#')) return false;
  }
  return !/url\s*\((?!\s*(['"]?)\s*#)/i.test(value);
}

/** Splits `a: b; c: url(x;y)` on the semicolons outside parentheses and quotes. */
export function parseDeclarations(text: string, keepImportant = false): [string, string][] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    } else if (char === ';' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  // A value with an unbalanced quote is dropped.
  if (quote === '') parts.push(current);
  const out: [string, string][] = [];
  for (const part of parts) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const name = part.slice(0, colon).trim().toLowerCase();
    const raw = part.slice(colon + 1).trim();
    const value = keepImportant ? raw : raw.replace(/!important\s*$/i, '').trim();
    if (PROPERTY.test(name) && value !== '' && safeValue(value)) out.push([name, value]);
  }
  return out;
}

/** Splits `text` at top-level `sep` characters (outside quotes, parentheses and brackets). */
function splitTop(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    else if (char === sep && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/**
 * The text of a `<style>` element inside the diagram, parsed and rebuilt. An SVG `<style>` is a
 * global stylesheet, and its text holds values from the document (`classDef`, `style`), so a
 * value with `}` could close Mermaid's rule and add an unscoped one. Only plain style rules stay,
 * and only when every selector of the list starts with `#<id>` (the diagram's own id); every
 * at-rule is dropped except `@keyframes` (animated edges keep moving), whose names are prefixed
 * with the diagram id so two diagrams never share one, and so are the names in `animation` and
 * `animation-name`; each declaration goes
 * through `parseDeclarations` (names, `safeValue`) and the rule is written again from the parts.
 */
export function safeCss(css: string, id: string): string {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const scope = `#${cssId(id)}`;
  const out: string[] = [];
  const names = new Map<string, string>();
  const idPart = id.replace(/[^a-zA-Z0-9_-]/g, '_');
  for (const match of text.matchAll(/@(?:-webkit-)?keyframes\s+([A-Za-z_][\w-]*)\s*\{/g)) {
    const name = match[1] as string;
    names.set(name, `wd-${idPart}-${name}`);
  }
  const rename = (name: string, value: string): string =>
    name === 'animation' || name === 'animation-name'
      ? value.replace(/[A-Za-z_][\w-]*/g, (word) => names.get(word) ?? word)
      : value;
  let i = 0;
  const n = text.length;
  while (i < n) {
    // The prelude: up to `{` or `;` outside quotes and brackets.
    let quote = '';
    let depth = 0;
    let j = i;
    for (; j < n; j++) {
      const char = text[j] as string;
      if (quote) {
        if (char === quote) quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '(' || char === '[') depth++;
      else if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
      else if ((char === '{' || char === ';' || char === '}') && depth === 0) break;
    }
    const prelude = text.slice(i, j).trim();
    if (j >= n) break;
    if (text[j] !== '{') {
      i = j + 1; // a statement or a stray `}`
      continue;
    }
    // The block: up to the matching `}`; any nested `{` makes the rule invalid.
    let level = 1;
    let nested = false;
    let k = j + 1;
    quote = '';
    for (; k < n && level > 0; k++) {
      const char = text[k] as string;
      if (quote) {
        if (char === quote) quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '{') {
        level++;
        nested = true;
      } else if (char === '}') level--;
    }
    const body = text.slice(j + 1, level === 0 ? k - 1 : k);
    i = k;
    const keyframes = /^@(?:-webkit-)?keyframes\s+([A-Za-z_][\w-]*)$/.exec(prelude);
    if (keyframes) {
      const frames: string[] = [];
      for (const frame of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = (frame[1] as string).trim();
        if (!/^(?:from|to|\d+(?:\.\d+)?%)(?:\s*,\s*(?:from|to|\d+(?:\.\d+)?%))*$/i.test(selector)) {
          continue;
        }
        const declarations = parseDeclarations(frame[2] as string, true);
        if (declarations.length > 0) {
          frames.push(`${selector}{${declarations.map(([a, b]) => `${a}:${b}`).join(';')}}`);
        }
      }
      if (frames.length > 0) {
        out.push(`@keyframes ${names.get(keyframes[1] as string)}{${frames.join('')}}`);
      }
      continue;
    }
    if (nested || prelude === '' || prelude.startsWith('@')) continue;
    const selectors = splitTop(prelude, ',').map((selector) => selector.trim());
    const scoped = selectors.every(
      (selector) =>
        selector.startsWith(scope) && !/^[a-zA-Z0-9_-]/.test(selector.slice(scope.length)),
    );
    if (!scoped || selectors.some((selector) => /[{}<\\]/.test(selector))) continue;
    const declarations = parseDeclarations(body, true);
    if (declarations.length === 0) continue;
    out.push(
      `${selectors.join(',')}{${declarations.map(([name, value]) => `${name}:${rename(name, value)}`).join(';')}}`,
    );
  }
  return out.join('\n');
}

/**
 * Removes every `style` attribute below `svg` (and on it) and puts the declarations into one
 * `<style>` rule set at the end of the SVG. Returns the number of elements moved.
 */
export function moveStylesToSheet(svg: Element): number {
  const doc = svg.ownerDocument;
  const id = svg.getAttribute('id') ?? '';
  const scope = id === '' ? '' : `#${cssId(id)}`;
  const rules: string[] = [];
  let count = 0;
  const styled = [svg, ...Array.from(svg.querySelectorAll('[style]'))].filter((el) =>
    el.hasAttribute('style'),
  );
  for (const element of styled) {
    const declarations = parseDeclarations(element.getAttribute('style') ?? '');
    element.removeAttribute('style');
    if (declarations.length === 0) continue;
    const marker = String(count++);
    element.setAttribute('data-wd-s', marker);
    const selector =
      element === svg ? `${scope}[data-wd-s="${marker}"]` : `${scope} [data-wd-s="${marker}"]`;
    rules.push(
      `${selector}{${declarations.map(([name, value]) => `${name}:${value} !important`).join(';')}}`,
    );
  }
  if (rules.length > 0) {
    const style = doc.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = rules.join('\n');
    svg.append(style);
  }
  return count;
}

/** An id as a CSS identifier: Mermaid ids are letters, digits, hyphens and underscores. */
function cssId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}
