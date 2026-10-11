/**
 * What the preview adds to a block after the sanitizer is done with it, all of it by our own
 * code and from our own sources, never derived from the HTML of the document:
 *
 * - the icon of an alert (inline SVG from the icon set of the app);
 * - the Copy button of a code card, and the token colors of its code (Lezer parsers, loaded the
 *   first time a language is used);
 * - MathML for the math placeholders (KaTeX, loaded the first time a document has math);
 * - the tab buttons of a Quarto tabset;
 * - the SVG of a Mermaid diagram (Mermaid, loaded the first time a diagram is shown);
 * - the SVG of a Graphviz graph (`dot` fence; Graphviz, loaded the first time one is shown);
 * - the source of images that are local files (the platform turns the path into an address that
 *   the web view may load), the placeholder for an image that is missing, and lazy loading.
 *
 * Everything that is already available (icons, loaded languages, loaded KaTeX, known image
 * addresses) is done at once, so a block that is replaced while typing does not flicker. The
 * rest finishes when its chunk or its answer arrives.
 */

import { fillGraph } from './graphviz';
import { highlightElement, type LezerParser, loadedParser, loadParser } from './highlight';
import { iconSvg } from './icons';
import { classifyImageSource } from './images';
import { loadedKatex, loadKatex, renderMathElement } from './math-render';
import { fillDiagram } from './mermaid';
import { enhanceTabset } from './rules/quarto/tabset-enhance';

export interface EnhanceContext {
  /** Turns the path of a local image into an address the web view can load. */
  resolveImage: ((source: string) => Promise<string>) | null;
  /** Addresses that were resolved already, by source. */
  images: Map<string, string>;
}

/** Cheap test on the HTML of a block: does it have anything to enhance? */
export function needsEnhancement(html: string): boolean {
  return (
    html.includes('callout-icon') ||
    html.includes('code-card') ||
    html.includes('class="math ') ||
    html.includes('mermaid-diagram') ||
    html.includes('graphviz-diagram') ||
    html.includes('class="embed"') ||
    html.includes('tabset') ||
    html.includes('<img') ||
    html.includes('data-wd-width') ||
    html.includes('data-wd-height') ||
    html.includes('data-wd-src')
  );
}

const TARGETS =
  '.callout-icon, .code-card, .math, .mermaid-diagram, .graphviz-diagram, .embed, .tabset, img';

/** The label of the Copy button, and of the state after it was used. */
export const COPY_LABEL = 'Copy';
export const COPIED_LABEL = 'Copied';

function addCopyButton(card: Element): void {
  // A code block that scrolls sideways must be reachable by keyboard.
  card.querySelector('pre')?.setAttribute('tabindex', '0');
  const actions = card.querySelector('.code-card-actions');
  if (!actions || actions.firstChild) return;
  const button = card.ownerDocument.createElement('button');
  button.type = 'button';
  button.className = 'code-copy';
  button.innerHTML = `<span class="code-copy-icon">${iconSvg('content-copy', 13) ?? ''}</span>`;
  const label = card.ownerDocument.createElement('span');
  label.className = 'code-copy-label';
  label.textContent = COPY_LABEL;
  button.append(label);
  actions.append(button);
}

function highlightCard(card: Element, work: Promise<void>[]): void {
  const language = card.getAttribute('data-lang') ?? '';
  const code = card.querySelector('pre > code');
  if (language === '' || !code) return;
  const parser = loadedParser(language);
  if (parser) {
    highlightElement(code, parser);
  } else if (parser === undefined) {
    const source = code.textContent;
    work.push(
      loadParser(language).then((loadedParserNow: LezerParser | null) => {
        // The block may have been replaced or edited while the language loaded.
        if (loadedParserNow && code.textContent === source) highlightElement(code, loadedParserNow);
      }),
    );
  }
}

function fillMath(element: Element, work: Promise<void>[]): void {
  if (element.classList.contains('math-rendered')) return;
  const engine = loadedKatex();
  if (engine) {
    renderMathElement(element, engine);
  } else {
    work.push(
      loadKatex().then(
        (loadedEngine) => renderMathElement(element, loadedEngine),
        () => element.classList.add('math-error'),
      ),
    );
  }
}

/** Replaces an image that cannot be shown by a placeholder with its description. */
export function showMissingImage(image: Element): void {
  const document = image.ownerDocument;
  const alt = image.getAttribute('alt')?.trim() ?? '';
  const source = image.getAttribute('data-wd-src') ?? image.getAttribute('src') ?? '';
  let name = alt;
  if (name === '') {
    const last = source.split(/[\\/]/).pop() ?? '';
    try {
      name = decodeURIComponent(last.split(/[?#]/)[0] ?? '');
    } catch {
      name = last;
    }
  }
  const placeholder = document.createElement('span');
  placeholder.className = 'wd-image-missing';
  placeholder.setAttribute('role', 'img');
  placeholder.setAttribute(
    'aria-label',
    name === '' ? 'Image not found' : `Image not found: ${name}`,
  );
  placeholder.innerHTML = `<span class="wd-image-missing-icon">${iconSvg('image', 18) ?? ''}</span>`;
  const text = document.createElement('span');
  text.className = 'wd-image-missing-text';
  text.textContent = name === '' ? 'Image not found' : name;
  placeholder.append(text);
  image.replaceWith(placeholder);
}

/** The host name of an `https:` address, or '' when it cannot be read. */
function hostOf(source: string): string {
  try {
    return new URL(source.trim()).hostname;
  } catch {
    return '';
  }
}

/**
 * Remote images off (setting): a placeholder with the description and the host the image would
 * come from. The address was moved out of `src` by the sanitizer, so nothing was requested.
 */
export function showBlockedRemoteImage(image: Element): void {
  const document = image.ownerDocument;
  const alt = image.getAttribute('alt')?.trim() ?? '';
  const host = hostOf(image.getAttribute('data-wd-src') ?? '');
  const placeholder = document.createElement('span');
  placeholder.className = 'wd-image-missing wd-image-remote-off';
  // Export and Copy as HTML put the image back (`restoreRemoteImages` in src/export/images.ts).
  placeholder.setAttribute('data-wd-remote-src', image.getAttribute('data-wd-src') ?? '');
  placeholder.setAttribute('data-wd-remote-alt', alt);
  placeholder.setAttribute('role', 'img');
  placeholder.setAttribute(
    'aria-label',
    `Remote image not loaded: ${alt === '' ? 'no description' : alt}${host === '' ? '' : `, from ${host}`}`,
  );
  placeholder.innerHTML = `<span class="wd-image-missing-icon">${iconSvg('image', 18) ?? ''}</span>`;
  const text = document.createElement('span');
  text.className = 'wd-image-missing-text';
  text.textContent = alt === '' ? 'Remote image' : alt;
  placeholder.append(text);
  if (host !== '') {
    const where = document.createElement('span');
    where.className = 'wd-image-remote-host';
    where.textContent = host;
    placeholder.append(where);
  }
  image.replaceWith(placeholder);
}

function enhanceImage(
  image: HTMLImageElement,
  context: EnhanceContext,
  work: Promise<void>[],
): void {
  if (image.hasAttribute('data-wd-remote')) {
    showBlockedRemoteImage(image);
    return;
  }
  image.setAttribute('loading', 'lazy');
  image.setAttribute('decoding', 'async');
  // An address that fails to load (offline, not found, blocked by the policy) shows the placeholder.
  image.addEventListener('error', () => showMissingImage(image), { once: true });

  const source = image.getAttribute('data-wd-src');
  if (source === null) return;
  if (classifyImageSource(source) !== 'local' || !context.resolveImage) {
    showMissingImage(image);
    return;
  }
  const known = context.images.get(source);
  if (known !== undefined) {
    image.src = known;
    return;
  }
  work.push(
    context.resolveImage(source).then(
      (address) => {
        context.images.set(source, address);
        image.src = address;
      },
      () => showMissingImage(image),
    ),
  );
}

const SIZE = /^\d+(?:\.\d+)?(?:px|%|em)$/;

/** `width` and `height` from a document (`{width=50%}`), applied through the CSSOM. */
export function applySizes(root: Element): void {
  for (const element of root.querySelectorAll('[data-wd-width], [data-wd-height]')) {
    if (!(element instanceof HTMLElement)) continue;
    const width = element.getAttribute('data-wd-width');
    const height = element.getAttribute('data-wd-height');
    if (width !== null && SIZE.test(width)) element.style.width = width;
    if (height !== null && SIZE.test(height)) element.style.height = height;
  }
}

/** Adds the trusted parts to a block element. Returns what is still loading. */
export function enhanceBlock(root: Element, context: EnhanceContext): Promise<void>[] {
  const work: Promise<void>[] = [];
  applySizes(root);
  for (const element of root.querySelectorAll(TARGETS)) {
    if (element.classList.contains('callout-icon')) {
      const name = element.getAttribute('data-icon');
      const svg = name === null ? null : iconSvg(name, 20);
      if (svg && !element.firstChild) element.innerHTML = svg;
    } else if (element.classList.contains('code-card')) {
      addCopyButton(element);
      highlightCard(element, work);
    } else if (element.classList.contains('math')) {
      fillMath(element, work);
    } else if (element.classList.contains('mermaid-diagram')) {
      fillDiagram(element, work);
    } else if (element.classList.contains('graphviz-diagram')) {
      fillGraph(element, work);
    } else if (element.classList.contains('embed')) {
      // An embedded note (Obsidian): read and rendered by its own chunk, loaded only when needed.
      if (element.hasAttribute('data-href') && !element.classList.contains('is-unresolved')) {
        work.push(
          import('./rules/obsidian/embed-enhance').then((module) =>
            module.fillEmbed(element, context),
          ),
        );
      }
    } else if (element.classList.contains('tabset')) {
      enhanceTabset(element);
    } else if (element instanceof HTMLImageElement) {
      enhanceImage(element, context, work);
    }
  }
  return work;
}
