/**
 * The sanitizer of the exact preview. It is the block pipeline's sanitizer with MathML allowed:
 * Pandoc writes math as MathML (`--mathml`), which the preview's own sanitizer strips. Images are
 * handled by the same hook, so a local image never asks the network or the app origin by itself.
 */
import createDOMPurify, { type DOMPurify } from 'dompurify';
import { moveImageSource } from '../sanitize-block';

const FORBIDDEN_TAGS = [
  'style',
  'form',
  'input',
  'button',
  'select',
  'option',
  'optgroup',
  'textarea',
  'fieldset',
  'legend',
  'dialog',
  'video',
  'audio',
  'source',
  'track',
  'picture',
];
const FORBIDDEN_ATTRIBUTES = ['style', 'srcset', 'sizes', 'ping', 'poster', 'background'];
const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

let purify: DOMPurify | undefined;

function instance(): DOMPurify {
  if (purify) return purify;
  const created = createDOMPurify(window);
  created.setConfig({
    USE_PROFILES: { html: true, mathMl: true },
    FORBID_TAGS: FORBIDDEN_TAGS,
    FORBID_ATTR: FORBIDDEN_ATTRIBUTES,
  });
  created.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName === 'IMG') moveImageSource(node);
  });
  created.addHook('uponSanitizeAttribute', (node, event) => {
    // Pandoc's heading ids ("links", "images") are anchors; a heading cannot clobber `document`.
    if (event.attrName === 'id' && HEADING_TAGS.has(node.nodeName) && event.attrValue !== '') {
      event.forceKeepAttr = true;
    }
  });
  purify = created;
  return created;
}

/** Pandoc's HTML, safe to put in the preview pane. */
export function sanitizePandocHtml(html: string): string {
  return instance().sanitize(html);
}
