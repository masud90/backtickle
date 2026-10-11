/**
 * Graphviz itself: this module and `@viz-js/viz` load the first time a `dot` diagram is shown.
 *
 * `@viz-js/viz` is MIT licensed; the Graphviz it carries (compiled to WebAssembly and bundled
 * inside the package, so nothing is fetched from the network) is licensed under the Eclipse Public
 * License 1.0, which the user accepted on 10 October 2026 (the only exception besides `notify`).
 *
 * The result of Graphviz is only a string. It is sanitized with DOMPurify's SVG profile (no
 * scripts, no foreign objects, no links, no images, no `use`), every `style` attribute and element
 * is dropped (the content security policy forbids inline styles and Graphviz's output does not
 * need them), ids are prefixed with the diagram's own id so two diagrams never share one, and only
 * then is the SVG inserted. Colors the graph does not set come from the theme, as Graphviz
 * default attributes (`-G`, `-N`, `-E`), which the graph's own statements override.
 */

import { instance, type Viz } from '@viz-js/viz';
import createDOMPurify from 'dompurify';
import { type Appearance, themeVariables } from '../mermaid/theme';

/** Source longer than this is refused (layout time and memory grow quickly with size). */
export const MAX_SOURCE = 100_000;

let purify: ReturnType<typeof createDOMPurify> | undefined;
let viz: Promise<Viz> | undefined;
let counter = 0;

function sanitizer(): ReturnType<typeof createDOMPurify> {
  purify ??= createDOMPurify(window);
  return purify;
}

function engine(): Promise<Viz> {
  viz ??= instance().catch((error: unknown) => {
    viz = undefined;
    throw error;
  });
  return viz;
}

export interface Rendered {
  /** The sanitized SVG. */
  svg: string;
  /** The id of the svg element, to be replaced when the same markup is used again. */
  id: string;
}

const FONT = 'Helvetica,Arial,sans-serif';

function defaults(appearance: Appearance): {
  graphAttributes: Record<string, string>;
  nodeAttributes: Record<string, string>;
  edgeAttributes: Record<string, string>;
} {
  const theme = themeVariables(document, appearance);
  const text = String(theme.textColor);
  const border = String(theme.nodeBorder);
  const line = String(theme.lineColor);
  return {
    graphAttributes: {
      bgcolor: 'transparent',
      fontcolor: text,
      color: String(theme.clusterBorder),
      fontname: FONT,
    },
    nodeAttributes: { color: border, fontcolor: text, fontname: FONT },
    edgeAttributes: { color: line, fontcolor: text, fontname: FONT },
  };
}

/** Prefixes every id below `svg` and the references to them, so diagrams do not share ids. */
function scopeIds(svg: Element, id: string): void {
  const names = new Map<string, string>();
  for (const element of svg.querySelectorAll('[id]')) {
    const old = element.getAttribute('id') ?? '';
    const fresh = `${id}-${old}`;
    names.set(old, fresh);
    element.setAttribute('id', fresh);
  }
  const rewrite = (value: string): string =>
    value.replace(/url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/g, (whole, quote: string, name: string) => {
      const fresh = names.get(name);
      return fresh ? `url(${quote}#${fresh}${quote})` : whole;
    });
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.value.includes('url('))
        element.setAttribute(attribute.name, rewrite(attribute.value));
    }
  }
}

/** Renders one graph. Throws an Error with Graphviz's message for a syntax error. */
export async function renderDiagram(source: string, appearance: Appearance): Promise<Rendered> {
  if (source.length > MAX_SOURCE) throw new Error('The graph is too large to draw.');
  const instanceOfViz = await engine();
  const result = instanceOfViz.render(source, { format: 'svg', ...defaults(appearance) });
  if (result.status !== 'success') {
    const message = result.errors.find((e) => e.level !== 'warning') ?? result.errors[0];
    throw new Error(message?.message ?? 'The graph could not be drawn.');
  }
  const fragment = sanitizer().sanitize(result.output, {
    USE_PROFILES: { svg: true },
    FORBID_TAGS: ['foreignObject', 'a', 'script', 'image', 'use', 'style', 'animate', 'set'],
    FORBID_ATTR: ['style', 'href', 'xlink:href'],
    RETURN_DOM_FRAGMENT: true,
  }) as DocumentFragment;
  const svg = fragment.querySelector('svg');
  if (!svg) throw new Error('The graph produced no drawing.');
  const id = `wd-gv-${++counter}`;
  scopeIds(svg, id);
  svg.setAttribute('id', id);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Diagram: Graphviz graph');
  return { svg: svg.outerHTML, id };
}
