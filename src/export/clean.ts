/**
 * Turns enhanced preview HTML into HTML for somewhere else (export, print, the pasteboard): no app controls, no source line numbers. It works on any element,
 * so the whole document and a selection of the preview go through the same code. It only removes
 * and replaces; nothing from the document is evaluated or added as markup.
 */

const ATTRIBUTES = [
  'data-line',
  'data-end-line',
  'data-key',
  'data-task-line',
  'data-wd-src',
  'loading',
  'decoding',
];

/** A checked task box is `☑`, an unchecked one `☐`. */
export const CHECKED_MARK = '☑';
export const UNCHECKED_MARK = '☐';

/** A Quarto tabset has no script in a saved page: every panel is shown, under its title. */
function openTabset(tabset: Element): void {
  const document = tabset.ownerDocument;
  for (const list of tabset.querySelectorAll(':scope > .tabset-tabs')) list.remove();
  for (const panel of tabset.querySelectorAll(':scope > .tabset-panel')) {
    panel.removeAttribute('hidden');
    for (const name of ['role', 'aria-labelledby', 'id']) panel.removeAttribute(name);
    const title = panel.getAttribute('data-tab-title');
    if (title === null || title === '') continue;
    const heading = document.createElement('p');
    heading.className = 'tabset-title';
    const strong = document.createElement('strong');
    strong.textContent = title;
    heading.append(strong);
    panel.prepend(heading);
  }
}

/** Removes the app's controls and bookkeeping below `root` (and on it). */
export function cleanForExport(root: Element | DocumentFragment): void {
  for (const element of root.querySelectorAll('.task-checkbox')) {
    const mark = element.ownerDocument.createElement('span');
    mark.className = 'task-mark';
    mark.textContent =
      element.getAttribute('aria-checked') === 'true' ? CHECKED_MARK : UNCHECKED_MARK;
    element.replaceWith(mark);
  }
  for (const element of root.querySelectorAll('.code-card-actions, .code-copy, button, input')) {
    element.remove();
  }
  for (const tabset of root.querySelectorAll('.tabset')) openTabset(tabset);
  for (const element of root.querySelectorAll('pre[tabindex]')) element.removeAttribute('tabindex');
  for (const element of root.querySelectorAll('.is-cursor-block')) {
    element.classList.remove('is-cursor-block');
  }
  const selector = ATTRIBUTES.map((name) => `[${name}]`).join(',');
  const own = root instanceof Element && root.matches(selector) ? [root] : [];
  for (const element of [...own, ...root.querySelectorAll(selector)]) {
    for (const name of ATTRIBUTES) element.removeAttribute(name);
  }
  // The saved page has no script, so no `data-*` attribute is of use, and one that came from the
  // document (a wikilink target) must not carry a `javascript:` value out.
  const all =
    root instanceof Element
      ? [root, ...root.querySelectorAll('*')]
      : [...root.querySelectorAll('*')];
  for (const element of all) {
    for (const name of element.getAttributeNames()) {
      if (name.startsWith('data-')) element.removeAttribute(name);
    }
  }
}
