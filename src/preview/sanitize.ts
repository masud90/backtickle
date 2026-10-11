/**
 * Raw HTML in a Markdown document is untrusted. Everything markdown-it produces goes through
 * DOMPurify before it reaches the preview. The content security policy is the second line of
 * defense (no inline scripts, no network except images).
 */
import DOMPurify from 'dompurify';

/** Page-level and form-like elements that have no business inside a rendered document. */
const FORBIDDEN_TAGS = [
  'style',
  'form',
  'button',
  'select',
  'option',
  'optgroup',
  'textarea',
  'fieldset',
  'legend',
  'dialog',
];

let hooked = false;

function installHooks(): void {
  if (hooked) return;
  hooked = true;
  // The only inputs allowed are checkboxes, and they are never interactive: task lists render
  // them, and a hand-written `<input>` in the document must not become a working form field.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName !== 'INPUT') return;
    if (node.getAttribute('type') !== 'checkbox') {
      node.remove();
      return;
    }
    node.setAttribute('disabled', '');
  });
}

/** Returns sanitized HTML. The result is safe to assign to `innerHTML`. */
export function sanitizeHtml(html: string): string {
  installHooks();
  return DOMPurify.sanitize(html, {
    // HTML only: no SVG or MathML payloads from raw HTML in the document.
    USE_PROFILES: { html: true },
    FORBID_TAGS: FORBIDDEN_TAGS,
    // No inline styles from a document: `position: fixed` could cover the app with a fake
    // dialog. The content security policy blocks them too; this keeps the DOM identical in
    // every context and the sanitizer correct on its own.
    FORBID_ATTR: ['style'],
  });
}
