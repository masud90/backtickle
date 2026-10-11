import type { FindSource } from '@/preview/controller';

/** What the find bar needs from the workspace. */
export interface PreviewFindHost {
  /** The element that scrolls the preview; the bar goes in front of it. */
  scroller: HTMLElement;
  /** Every block of the document, also the ones a large document does not draw. */
  sources(): FindSource[];
  /** Draws block `index` if needed and returns its element. */
  reveal(index: number): HTMLElement | undefined;
  /** Blocks were added, replaced or drawn. */
  onBlocksChanged(listener: () => void): () => void;
  /** Where the focus goes when the bar closes. */
  restoreFocus(): void;
}
