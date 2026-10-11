/**
 * Helpers for the shell: what a click or a key press in the preview means. They only read the DOM
 * of the preview; what to do about it (toggle a task, open a link) is up to the caller. Nothing
 * here navigates the window.
 */

export type LinkKind = 'external' | 'anchor' | 'document' | 'file';

export interface PreviewLink {
  /** The `href` as written in the document. */
  href: string;
  kind: LinkKind;
}

function targetElement(event: Event): Element | null {
  const target = event.target;
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

/**
 * The 0-based source line of the task checkbox an event happened on, for a click or a press of
 * the space key, or null. A key press is only a task toggle when the box itself has the focus.
 */
export function taskLineFromEvent(event: Event): number | null {
  if (event instanceof KeyboardEvent && event.key !== ' ' && event.key !== 'Spacebar') return null;
  const box = targetElement(event)?.closest('.task-checkbox[data-task-line]');
  if (!box) return null;
  const line = Number(box.getAttribute('data-task-line'));
  return Number.isInteger(line) && line >= 0 ? line : null;
}

/** Extensions of files that Writedown opens as documents (the Markdown family and text). */
const DOCUMENT_EXTENSIONS = new Set([
  'md',
  'markdown',
  'mdown',
  'mkd',
  'mkdn',
  'mdx',
  'qmd',
  'rmd',
  'mmd',
  'txt',
]);

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/** What kind of target an `href` has. */
export function classifyHref(href: string): LinkKind {
  if (href.startsWith('#')) return 'anchor';
  const scheme = SCHEME.exec(href)?.[1]?.toLowerCase();
  if (scheme !== undefined && scheme !== 'file') return 'external';
  // A relative path, or a file: address: look at the extension of the path.
  const path = href.replace(/^file:\/\//i, '').split(/[?#]/)[0] ?? '';
  const name = path.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  let extension = dot > 0 ? name.slice(dot + 1) : '';
  try {
    extension = decodeURIComponent(extension);
  } catch {
    // keep the raw text
  }
  return DOCUMENT_EXTENSIONS.has(extension.toLowerCase()) ? 'document' : 'file';
}

/**
 * The link an event happened on, or null if it did not happen on a link: its `href` as written
 * in the document and where it points. `external` is a web or mail address (`http:`, `https:`,
 * `mailto:`, and any other scheme the platform decides about), `anchor` a `#heading` in the same
 * document, `document` a Markdown or text file next to it, `file` any other local file.
 */
export function linkFromEvent(event: Event): PreviewLink | null {
  const anchor = targetElement(event)?.closest('a[href]');
  if (!anchor) return null;
  const href = anchor.getAttribute('href');
  if (href === null || href === '') return null;
  return { href, kind: classifyHref(href) };
}
