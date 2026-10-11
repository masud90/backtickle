/// <reference path="../vendor.d.ts" />
/**
 * The Obsidian pack: the GFM rules plus wikilinks and
 * embeds, Obsidian callouts (all types, titles, folding), highlights, comments, tags, block ids,
 * properties instead of the frontmatter header, and Mermaid (the GFM fence rule). Inline footnotes
 * come from the GFM footnote plugin. The vault index (fetched by the shell, shared between tabs)
 * resolves the links; embedded notes are read and rendered after sanitizing
 * (`rules/obsidian/embed-enhance.ts`).
 */
import type { MarkdownIt } from 'markdown-it';
import { BlockPipeline, type EnginePipeline, type PipelineOptions } from '../engine';
import { installBlockIds } from '../rules/obsidian/blockids';
import { installObsidianCallouts } from '../rules/obsidian/callouts';
import {
  completionsObsidian,
  needsObsidian,
  obsidianUnsafeSplit,
  prepareObsidian,
} from '../rules/obsidian/context';
import { installObsidianMarks } from '../rules/obsidian/marks';
import { installProperties } from '../rules/obsidian/properties';
import { installWikilinks } from '../rules/obsidian/wikilinks';
import { createGfmMarkdownIt } from './gfm';

export function createObsidianMarkdownIt(): MarkdownIt {
  const md = createGfmMarkdownIt();
  installProperties(md);
  installObsidianCallouts(md);
  installBlockIds(md);
  installObsidianMarks(md);
  installWikilinks(md);
  return md;
}

export function createObsidianPipeline(options?: PipelineOptions): EnginePipeline {
  return new BlockPipeline('obsidian', createObsidianMarkdownIt(), {
    needs: needsObsidian,
    prepare: prepareObsidian,
    completions: completionsObsidian,
    unsafeSplit: obsidianUnsafeSplit,
    ...options,
  });
}

let embedPipeline: EnginePipeline | undefined;

/**
 * The pipeline that renders embedded notes: its own instance with small caches, so an embed never
 * evicts what the open document needs.
 */
export function sharedEmbedPipeline(): EnginePipeline {
  embedPipeline ??= createObsidianPipeline({
    cacheChars: 400_000,
    cacheEntries: 2_000,
    windowing: false,
  });
  return embedPipeline;
}
