/**
 * The registry of the renderable flavors: one lazy loader per flavor that has a pack. A flavor
 * whose pack does not exist yet has `renderAs: 'gfm'` in `src/flavors` and renders as GFM. A
 * flavor WP adds its pack with one line here, for example
 * `pandoc: () => import('./pandoc').then((pack) => pack.createPandocPipeline()),`
 * and sets `available: true` and `renderAs` for the flavor.
 */
import type { FlavorId } from '@/flavors';
import type { Pipeline } from '../types';

export type PackLoader = () => Promise<Pipeline>;

export const packLoaders: Partial<Record<FlavorId, PackLoader>> = {
  commonmark: () => import('./commonmark').then((pack) => pack.createCommonMarkPipeline()),
  gfm: () => import('./gfm').then((pack) => pack.createGfmPipeline()),
  pandoc: () => import('./pandoc').then((pack) => pack.createPandocPipeline()),
  obsidian: () => import('./obsidian').then((pack) => pack.createObsidianPipeline()),
  quarto: () => import('./quarto').then((pack) => pack.createQuartoPipeline()),
  mdx: () => import('./mdx').then((pack) => pack.createMdxPipeline()),
};
