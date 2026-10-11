/**
 * The entry of the preview pipeline.
 *
 * `loadPipeline` loads the pack of a flavor on first use, as a separate chunk, so the window
 * pays for markdown-it and its plugins only when a document is shown. A flavor that cannot be
 * rendered yet (Obsidian, Pandoc, Quarto, MDX in Phase 1) is rendered by the GFM pack. The same
 * pipeline object is returned for the same renderable flavor, so its caches serve every tab.
 */
import { type FlavorId, flavorInfo } from '@/flavors';
import type { Pipeline } from './types';

export { readingMinutes } from './stats';
export type {
  Analysis,
  ContextInputs,
  ContextNeeds,
  DocContext,
  DocStats,
  Frontmatter,
  Heading,
  Label,
  Pipeline,
  RenderedBlock,
  RenderResult,
} from './types';

const loaded = new Map<FlavorId, Promise<Pipeline>>();

/**
 * The flavor that is really rendered for `flavor`: its own pack once the flavor is available
 * (`renderAs` in `src/flavors`, switched on by the WP that adds the pack), else GFM.
 */
export function renderableFlavor(flavor: FlavorId): FlavorId {
  return flavorInfo(flavor).renderAs;
}

export function loadPipeline(flavor: FlavorId): Promise<Pipeline> {
  const target = renderableFlavor(flavor);
  let pipeline = loaded.get(target);
  if (!pipeline) {
    // The registry is a lazy chunk too: a window without a document never loads it.
    pipeline = import('./packs').then(
      ({ packLoaders }) => (packLoaders[target] ?? packLoaders.gfm)?.() as Promise<Pipeline>,
    );
    // A failed load (the chunk could not be read) must not be remembered.
    pipeline.catch(() => loaded.delete(target));
    loaded.set(target, pipeline);
  }
  return pipeline;
}
