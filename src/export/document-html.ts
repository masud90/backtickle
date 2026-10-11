/**
 * The full document as HTML: every block, also the far blocks of a
 * large document, enhanced as the preview enhances them (code colors, MathML, Mermaid SVG,
 * images), without app controls and without source line numbers, in the light theme.
 *
 * The blocks are the sanitized HTML of the pipeline, never the preview's DOM, so a block that
 * the preview has not drawn is the same as one it has. They are enhanced in a detached document
 * (never laid out, so it costs no style or render tree) in batches, so a 5 MiB document does not
 * need all its elements at once. A Mermaid diagram that the preview drew in the light theme is
 * reused from the diagram cache; otherwise it is drawn through the same path.
 *
 * WP3.6b calls `documentHtml` for Obsidian and MDX documents (Pandoc reads the HTML).
 */
import { type EnhanceContext, enhanceBlock } from '@/preview/enhance';
import { cleanForExport } from './clean';
import { restoreRemoteImages } from './images';

export interface DocumentHtmlOptions {
  /** Turns the path of a local image into an address that holds up outside the app. */
  resolveImage?: ((source: string) => Promise<string>) | null;
  /**
   * Put the remote images that the "Load remote images" setting kept out of the preview back, with
   * the address as written (HTML export, Copy as HTML). Print and Word export leave them out.
   */
  restoreRemoteImages?: boolean;
  /** Blocks enhanced per batch (default 200). */
  batch?: number;
  /** Called after each batch with the number of blocks done (for a progress display). */
  onProgress?: (done: number, total: number) => void;
}

/** The HTML of every block, in order, joined: `div.wd-block` wrappers without line numbers. */
export async function documentHtml(
  blocks: readonly { html: string }[],
  options: DocumentHtmlOptions = {},
): Promise<string> {
  const doc = document.implementation.createHTMLDocument('');
  const context: EnhanceContext = {
    resolveImage: options.resolveImage ?? null,
    images: new Map(),
  };
  const size = Math.max(1, options.batch ?? 200);
  const parts: string[] = [];
  for (let start = 0; start < blocks.length; start += size) {
    const holder = doc.createElement('div');
    holder.innerHTML = blocks
      .slice(start, start + size)
      .map((block) => block.html)
      .join('');
    if (options.restoreRemoteImages) restoreRemoteImages(holder);
    await Promise.allSettled(enhanceBlock(holder, context));
    cleanForExport(holder);
    parts.push(holder.innerHTML);
    options.onProgress?.(Math.min(start + size, blocks.length), blocks.length);
  }
  return parts.join('');
}
