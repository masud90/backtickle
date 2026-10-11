/**
 * Print and Save as PDF: the document HTML goes into a print root that
 * only print media shows, the print panel opens (`printPage`), and the root is removed when the
 * panel closes. The panel is a sheet that opens at once and renders the page after it, so the
 * root must stay until WebKit says printing is over (`afterprint`); if that event does not come,
 * the root goes 15 s after the window gets its focus back, and at the latest when the next print
 * starts.
 */
import type { Platform } from '@/lib/platform';
import { applySizes } from '@/preview/enhance';
import type { RenderResult } from '@/preview/types';
import printCss from '@/styles/print.css?raw';
import { scopedLightCss } from './css';
import { documentHtml } from './document-html';

export const PRINT_ROOT_ID = 'wd-print-root';
const PRINT_STYLE_ID = 'wd-print-style';
/** How long after the focus returns the root stays, if `afterprint` never arrives. */
export const FOCUS_FALLBACK_MS = 15_000;

let cleanup: (() => void) | undefined;

/** Removes the print root now (also the one a previous print left). */
export function removePrintRoot(): void {
  cleanup?.();
  cleanup = undefined;
  document.getElementById(PRINT_ROOT_ID)?.remove();
  document.getElementById(PRINT_STYLE_ID)?.remove();
}

function waitForImages(root: HTMLElement): Promise<unknown> {
  return Promise.all(
    [...root.querySelectorAll('img')].map((image) => image.decode().catch(() => undefined)),
  );
}

/**
 * Builds the print root (the document in the light theme, shown by print media only) and waits for
 * its images. The caller removes it with `removePrintRoot`. Also used by the PDF export.
 */
export async function mountPrintRoot(
  platform: Platform,
  result: RenderResult,
  docPath: string | null,
): Promise<HTMLElement> {
  removePrintRoot();
  const html = await documentHtml(result.blocks, {
    resolveImage: docPath === null ? null : (source) => platform.resolveImage(docPath, source),
  });
  const style = document.createElement('style');
  style.id = PRINT_STYLE_ID;
  style.textContent = `${scopedLightCss(`#${PRINT_ROOT_ID}`)}\n${printCss}`;
  const root = document.createElement('div');
  root.id = PRINT_ROOT_ID;
  root.setAttribute('aria-hidden', 'true');
  const article = document.createElement('article');
  article.className = 'wd-preview';
  article.innerHTML = html;
  // Image sizes are set through the CSSOM: the page's policy forbids `style` attributes.
  applySizes(article);
  root.append(article);
  document.head.append(style);
  document.body.append(root);
  await waitForImages(root);
  return root;
}

/** Builds the print root, opens the print panel and arranges the removal of the root. */
export async function printDocument(
  platform: Platform,
  result: RenderResult,
  docPath: string | null,
): Promise<void> {
  await mountPrintRoot(platform, result, docPath);

  let blurred = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = (): void => {
    if (cleanup === stop) removePrintRoot();
  };
  const onBlur = (): void => {
    blurred = true;
  };
  const onFocus = (): void => {
    if (blurred) timer = setTimeout(done, FOCUS_FALLBACK_MS);
  };
  const stop = (): void => {
    window.removeEventListener('afterprint', done);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onFocus);
    clearTimeout(timer);
  };
  cleanup = stop;
  window.addEventListener('afterprint', done);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  try {
    await platform.printPage();
  } catch (error) {
    removePrintRoot();
    throw error;
  }
}
