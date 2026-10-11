/**
 * Diagrams in the preview. `fillDiagram` is called by the enhancements of a block that is shown
 * (`enhance.ts`); Graphviz is loaded then and not before, so a document without a diagram (and a
 * block that was never near) never loads it. The fence rule that makes the placeholder is
 * `installGraphvizFence` in `rules/code.ts`.
 *
 * The placeholder `div.graphviz-diagram > pre.graphviz-source` stays until the SVG is ready and
 * after a syntax error (with a muted `p.graphviz-error` under the source). Rendered SVGs are
 * cached by source and appearance (as sanitized markup, its element id swapped on each use).
 * When the appearance changes, every diagram in the page is drawn again.
 */
import { BoundedCache } from '../cache';
import { type Appearance, currentAppearance } from '../mermaid/theme';

type Renderer = typeof import('./render');

interface State {
  source: string;
  appearance: Appearance;
}

const states = new WeakMap<Element, State>();
const cache = new BoundedCache<{ svg: string; id: string }>({
  maxEntries: 64,
  maxSize: 4_000_000,
  sizeOf: (key, value) => key.length + value.svg.length,
});
let renderer: Promise<Renderer> | undefined;
let queue: Promise<unknown> = Promise.resolve();
let watching = false;
let uses = 0;

function loadRenderer(): Promise<Renderer> {
  renderer ??= import('./render').catch((error: unknown) => {
    renderer = undefined; // allow another try
    throw error;
  });
  return renderer;
}

const keyOf = (source: string, appearance: Appearance): string => `${appearance}\u0001${source}`;

/** Puts the SVG (cached markup, with a fresh element id) in place of the placeholder source. */
function show(element: Element, markup: { svg: string; id: string }): void {
  const fresh = `wd-gv-u${++uses}`;
  const svg = markup.svg.split(markup.id).join(fresh);
  const template = element.ownerDocument.createElement('template');
  template.innerHTML = svg;
  const holder = element.ownerDocument.createElement('div');
  holder.className = 'graphviz-svg';
  holder.append(template.content);
  element.replaceChildren(holder);
  element.classList.add('graphviz-rendered');
  element.classList.remove('graphviz-failed');
}

function showError(element: Element, message: string): void {
  element.classList.add('graphviz-failed');
  element.querySelector('.graphviz-error')?.remove();
  const line = element.ownerDocument.createElement('p');
  line.className = 'graphviz-error';
  line.textContent = `Graph error: ${message.trim().slice(0, 400)}`;
  element.append(line);
}

function draw(element: Element, source: string, appearance: Appearance): Promise<void> {
  const run = async (): Promise<void> => {
    const state = states.get(element);
    // The block was edited or drawn again for another appearance while this waited.
    if (state?.source !== source || state.appearance !== appearance) return;
    const key = keyOf(source, appearance);
    let markup = cache.get(key);
    if (!markup) {
      try {
        const { renderDiagram } = await loadRenderer();
        markup = await renderDiagram(source, appearance);
      } catch (error) {
        showError(element, error instanceof Error ? error.message : 'could not be drawn.');
        return;
      }
      cache.set(key, markup);
    }
    const now = states.get(element);
    if (now?.source === source && now.appearance === appearance) show(element, markup);
  };
  // One diagram at a time (the layout is synchronous and can take a while).
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

/** Draws the diagram of one placeholder. Cached diagrams are inserted at once. */
export function fillGraph(element: Element, work: Promise<void>[]): void {
  if (
    element.classList.contains('graphviz-rendered') ||
    element.classList.contains('graphviz-failed')
  )
    return;
  const source = element.querySelector('pre.graphviz-source')?.textContent;
  if (source === null || source === undefined) return;
  const appearance = currentAppearance(element.ownerDocument);
  states.set(element, { source, appearance });
  watchAppearance(element.ownerDocument);
  const cached = cache.get(keyOf(source, appearance));
  if (cached) {
    show(element, cached);
    return;
  }
  work.push(draw(element, source, appearance));
}

/** Draws every diagram of the page again when the appearance changes. */
function watchAppearance(doc: Document): void {
  // A detached document (export) has no window and never changes appearance.
  if (watching || !doc.defaultView) return;
  watching = true;
  const redraw = (): void => {
    const appearance = currentAppearance(doc);
    for (const element of doc.querySelectorAll('.graphviz-diagram.graphviz-rendered')) {
      const state = states.get(element);
      if (!state || state.appearance === appearance) continue;
      states.set(element, { source: state.source, appearance });
      const cached = cache.get(keyOf(state.source, appearance));
      if (cached) show(element, cached);
      else void draw(element, state.source, appearance);
    }
  };
  new MutationObserver(redraw).observe(doc.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', redraw);
}
