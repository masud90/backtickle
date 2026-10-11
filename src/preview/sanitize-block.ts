/**
 * The sanitizer of the block pipeline. Everything markdown-it produces for a block goes through
 * it before it reaches the DOM; the content security policy is the second line of defense.
 *
 * It is a separate DOMPurify instance with its configuration set once, because one call per
 * block would otherwise rebuild the allow lists every time. The sanitizer of the first preview
 * (`sanitize.ts`) is left as it is.
 *
 * Two hooks adapt it to the preview:
 * - Image addresses that are not plain `https:` or image `data:` URLs move to `data-wd-src` (see
 *   `images.ts`). This runs for images from Markdown and from raw HTML alike, so no image of a
 *   document ever asks the network or the app origin for a file by itself.
 * - Heading ids that the preview itself generated stay. DOMPurify removes ids that are names of
 *   `document` properties ("links", "images", "title", "location", "body" ...) to prevent DOM
 *   clobbering, and those are exactly the ids GitHub-style anchors produce for headings such as
 *   "Links" or "Images". An id of a raw HTML element is still subject to the check.
 */
import createDOMPurify, { type DOMPurify } from 'dompurify';
import { classifyImageSource } from './images';
import { previewOptions } from './options';

/** Elements that have no place in a rendered document, or that the app cannot run anyway. */
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

/** Attributes that load or style something the document must not control. */
const FORBIDDEN_ATTRIBUTES = ['style', 'srcset', 'sizes', 'ping', 'poster', 'background'];

const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

let purify: DOMPurify | undefined;
/** The heading ids of the block that is being sanitized right now. */
let trustedIds: ReadonlySet<string> | null = null;

export function moveImageSource(image: Element): void {
  // These are ours: whatever the document says about them is ignored.
  image.removeAttribute('data-wd-src');
  image.removeAttribute('data-wd-remote');
  image.removeAttribute('srcset');
  image.removeAttribute('sizes');
  const source = image.getAttribute('src');
  if (source === null) return;
  const kind = classifyImageSource(source);
  if (kind === 'keep') {
    // Remote images off (setting): the address never reaches the DOM, where the web view would
    // fetch it. The preview shows a placeholder, and an export puts the address back.
    if (previewOptions().remoteImages || !/^https:/i.test(source.trim())) return;
    image.setAttribute('data-wd-remote', '');
  }
  image.removeAttribute('src');
  image.setAttribute('data-wd-src', source);
}

function instance(): DOMPurify {
  if (purify) return purify;
  const created = createDOMPurify(window);
  created.setConfig({
    // HTML only: no SVG or MathML payloads from raw HTML in the document.
    USE_PROFILES: { html: true },
    FORBID_TAGS: FORBIDDEN_TAGS,
    FORBID_ATTR: FORBIDDEN_ATTRIBUTES,
  });
  created.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName === 'IMG') moveImageSource(node);
  });
  created.addHook('uponSanitizeAttribute', (node, event) => {
    if (
      event.attrName === 'id' &&
      trustedIds !== null &&
      HEADING_TAGS.has(node.nodeName) &&
      trustedIds.has(event.attrValue)
    ) {
      event.forceKeepAttr = true;
    }
  });
  purify = created;
  return created;
}

/**
 * Returns sanitized HTML for one block. `headingIds` are the ids the pipeline gave to the headings
 * of this block: they survive the clobbering check.
 */
export function sanitizeBlockHtml(html: string, headingIds: ReadonlySet<string> | null): string {
  const sanitizer = instance();
  trustedIds = headingIds;
  try {
    return sanitizer.sanitize(html);
  } finally {
    trustedIds = null;
  }
}
