/**
 * Click to source: which source line a click in the preview means.
 * Only reads the DOM; the caller moves the editor.
 */

/** A click on these does its own thing (links, controls, folds, tabs, inputs, task boxes). */
const OWN_ACTION =
  'a, button, input, textarea, select, summary, label, [role="tab"], [role="button"], .code-copy, .task-checkbox, [contenteditable="true"]';

function selectionEndsHere(article: HTMLElement): boolean {
  const selection = article.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed) return false;
  return (
    (selection.anchorNode !== null && article.contains(selection.anchorNode)) ||
    (selection.focusNode !== null && article.contains(selection.focusNode))
  );
}

/**
 * The 0-based source line of a single click, or null when it means something else: not the main
 * button, with a modifier, part of a double or triple click, the end of a text selection, or on a
 * link, button, checkbox, `summary`, tab or input.
 */
export function sourceLineOfClick(event: MouseEvent, article: HTMLElement): number | null {
  if (event.button !== 0 || event.detail > 1 || event.defaultPrevented) return null;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  const target = event.target;
  if (!(target instanceof Element) || !article.contains(target)) return null;
  if (target.closest(OWN_ACTION)) return null;
  if (selectionEndsHere(article)) return null;
  for (let el: Element | null = target; el && el !== article; el = el.parentElement) {
    const value = el.getAttribute('data-line');
    if (value === null) continue;
    const line = Number(value);
    return Number.isInteger(line) && line >= 0 ? line : null;
  }
  return null;
}
