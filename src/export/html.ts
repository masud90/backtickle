/** File > Export > HTML: one self-contained page. */
import type { Platform, Settings } from '@/lib/platform';
import { previewExportStyle } from '@/preview/settings';
import type { RenderResult } from '@/preview/types';
import { documentHtml } from './document-html';
import { dataUriResolver } from './images';
import { buildPage, pageTitle } from './page';

/** The page for a document: local images embedded, light theme CSS inline. */
export async function htmlPage(
  platform: Platform,
  result: RenderResult,
  docPath: string | null,
  fileName: string,
  preview?: Settings['preview'],
): Promise<string> {
  const body = await documentHtml(result.blocks, {
    resolveImage: docPath === null ? null : dataUriResolver(platform, docPath),
    restoreRemoteImages: true,
  });
  return buildPage(
    pageTitle(result, fileName),
    body,
    preview ? previewExportStyle(preview) : undefined,
  );
}

/** The suggested file name: the document name with `.html`. */
export function suggestedHtmlName(name: string): string {
  const base = name.replace(/\.[^./]+$/, '').trim();
  return `${base === '' ? 'Untitled' : base}.html`;
}

export function directoryOf(path: string | null): string | null {
  if (path === null) return null;
  const at = path.lastIndexOf('/');
  return at > 0 ? path.slice(0, at) : null;
}
