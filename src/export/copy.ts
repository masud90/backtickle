/**
 * Edit > Copy as HTML: the HTML of the preview selection, or of the
 * whole document when nothing is selected, as text and as HTML on the pasteboard. Local images
 * become `data:` URIs so the paste does not depend on this app.
 */
import type { Platform } from '@/lib/platform';
import type { RenderResult } from '@/preview/types';
import { cleanForExport } from './clean';
import { documentHtml } from './document-html';
import { dataUriResolver, embedImages, restoreRemoteImages } from './images';

/** The selected range inside `preview`, or null (no selection, or one outside the preview). */
export function previewSelection(preview: HTMLElement): Range | null {
  const selection = preview.ownerDocument.defaultView?.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  return preview.contains(range.commonAncestorContainer) ? range : null;
}

/** The HTML to copy: the selection, else the whole document. */
export async function htmlToCopy(
  platform: Platform,
  preview: HTMLElement,
  result: RenderResult,
  docPath: string | null,
): Promise<string> {
  const resolve = docPath === null ? null : dataUriResolver(platform, docPath);
  const range = previewSelection(preview);
  if (range) {
    const holder = preview.ownerDocument.createElement('div');
    holder.append(range.cloneContents());
    restoreRemoteImages(holder);
    if (resolve) await embedImages(holder, resolve);
    cleanForExport(holder);
    return holder.innerHTML;
  }
  return documentHtml(result.blocks, { resolveImage: resolve, restoreRemoteImages: true });
}

export async function copyAsHtml(
  platform: Platform,
  preview: HTMLElement,
  result: RenderResult,
  docPath: string | null,
): Promise<void> {
  const html = await htmlToCopy(platform, preview, result, docPath);
  await platform.writeClipboard({ text: html, html });
}
