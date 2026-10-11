/**
 * One-click PDF: the same print root as Print, then the backend writes
 * the page as a PDF to the path the save dialog returned, without the print panel. The root is
 * removed when the write ends, on success and on failure.
 */
import type { Platform } from '@/lib/platform';
import type { RenderResult } from '@/preview/types';
import { mountPrintRoot, removePrintRoot } from './print';

export function suggestedPdfName(name: string): string {
  const base = name.replace(/\.[^./]+$/, '').trim();
  return `${base === '' ? 'Untitled' : base}.pdf`;
}

/** Puts the document in the print root, has the backend write the PDF to `path`, removes the root. */
export async function writePdf(
  platform: Platform,
  result: RenderResult,
  docPath: string | null,
  path: string,
): Promise<void> {
  try {
    await mountPrintRoot(platform, result, docPath);
    await platform.exportPdf(path);
  } finally {
    removePrintRoot();
  }
}
