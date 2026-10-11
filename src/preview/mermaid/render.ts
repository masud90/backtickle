/**
 * Mermaid itself: this module and the `mermaid` package load the first time a diagram is shown.
 *
 * Mermaid settings: `startOnLoad: false`, `securityLevel: 'strict'` (a directive cannot change it:
 * it is on Mermaid's `secure` list, and directives are removed anyway, see `source.ts`),
 * `htmlLabels: false` for the diagram types that have the option, no `click` handlers
 * (`click` statements are removed). Its result is only a string: it is sanitized with DOMPurify's
 * SVG profile, its `style` attributes become rules (`styles.ts`), and only then is it inserted.
 */
import createDOMPurify from 'dompurify';
import mermaid, { type MermaidConfig } from 'mermaid';
import { cleanDiagramSource } from './source';
import { moveStylesToSheet, safeCss } from './styles';
import { type Appearance, themeVariables } from './theme';

let purify: ReturnType<typeof createDOMPurify> | undefined;
let configured: Appearance | undefined;
let counter = 0;

function sanitizer(): ReturnType<typeof createDOMPurify> {
  purify ??= createDOMPurify(window);
  return purify;
}

function configure(appearance: Appearance): void {
  if (configured === appearance) return;
  const config = {
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    theme: 'base',
    themeVariables: themeVariables(document, appearance),
    logLevel: 'fatal',
    suppressErrorRendering: true,
    maxTextSize: 50_000,
    maxEdges: 500,
    flowchart: { htmlLabels: false, useMaxWidth: true },
    class: { htmlLabels: false, useMaxWidth: true },
    state: { useMaxWidth: true },
    er: { useMaxWidth: true },
    sequence: { useMaxWidth: true },
    gantt: { useMaxWidth: true },
  };
  mermaid.initialize(config as unknown as MermaidConfig);
  configured = appearance;
}

const KINDS: Record<string, string> = {
  graph: 'flowchart',
  flowchart: 'flowchart',
  'flowchart-v2': 'flowchart',
  sequencediagram: 'sequence diagram',
  classdiagram: 'class diagram',
  'classdiagram-v2': 'class diagram',
  statediagram: 'state diagram',
  'statediagram-v2': 'state diagram',
  erdiagram: 'entity relationship diagram',
  gantt: 'Gantt chart',
  pie: 'pie chart',
  journey: 'user journey',
  gitgraph: 'git graph',
  mindmap: 'mind map',
  timeline: 'timeline',
  quadrantchart: 'quadrant chart',
  requirementdiagram: 'requirement diagram',
  xychart: 'XY chart',
  'xychart-beta': 'XY chart',
  sankey: 'Sankey diagram',
  'sankey-beta': 'Sankey diagram',
  block: 'block diagram',
  'block-beta': 'block diagram',
  packet: 'packet diagram',
  'packet-beta': 'packet diagram',
  kanban: 'kanban board',
  architecture: 'architecture diagram',
  'architecture-beta': 'architecture diagram',
};

/** Gives the SVG an accessible name: Mermaid's own title (accTitle) if it has one, else the kind. */
function nameDiagram(svg: SVGElement, source: string): void {
  if (svg.getAttribute('aria-labelledby') || svg.querySelector(':scope > title')) return;
  let body = source.trim();
  if (body.startsWith('---')) body = body.replace(/^---[\s\S]*?\n---\s*/, '');
  const first =
    body
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '' && !line.startsWith('%%')) ?? '';
  const word = (first.split(/[\s;{]/)[0] ?? '').toLowerCase();
  svg.setAttribute('aria-label', `Diagram: ${KINDS[word] ?? (word || 'diagram')}`);
}

export interface Rendered {
  /** The sanitized SVG, with its styles moved into its own style element. */
  svg: string;
  /** The id of the svg element, to be replaced when the same markup is used again. */
  id: string;
}

/** Renders one diagram. Throws an Error with Mermaid's message for a syntax error. */
export async function renderDiagram(source: string, appearance: Appearance): Promise<Rendered> {
  configure(appearance);
  const cleaned = cleanDiagramSource(source);
  const id = `wd-mmd-${++counter}`;
  let raw: string;
  try {
    raw = (await mermaid.render(id, cleaned)).svg;
  } finally {
    // Mermaid leaves its measuring element in the page after an error.
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
  }
  const fragment = sanitizer().sanitize(raw, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['style'],
    FORBID_TAGS: ['foreignObject', 'a', 'script', 'image', 'use'],
    RETURN_DOM_FRAGMENT: true,
  }) as DocumentFragment;
  const svg = fragment.querySelector('svg');
  if (!svg) throw new Error('The diagram produced no drawing.');
  for (const style of svg.querySelectorAll('style'))
    style.textContent = safeCss(style.textContent ?? '', id);
  svg.setAttribute('id', id);
  moveStylesToSheet(svg);
  svg.setAttribute('role', 'img');
  nameDiagram(svg, cleaned);
  return { svg: svg.outerHTML, id };
}
