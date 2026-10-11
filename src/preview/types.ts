/** The data shapes of the preview pipeline. */

import type { CompletionData } from '@/editor/complete';
import type { FlavorId } from '@/flavors';
import type { VaultIndex } from '@/lib/platform';

/**
 * One top-level block of the document. `html` is sanitized and is the whole wrapper element:
 * `<div class="wd-block" data-line data-end-line data-key>` around the block's content. `line`
 * and `endLine` are 0-based and inclusive. The key is a hash of the block's HTML without any
 * line numbers, so a block that only moved keeps its key.
 *
 * The `html` of a block is produced the first time it is read and then remembered. Blocks that
 * the preview already shows are never read again, which is what makes updates cheap.
 */
export interface RenderedBlock {
  key: string;
  html: string;
  line: number;
  endLine: number;
}

export interface Heading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  /** Plain text of the heading. */
  text: string;
  /** GitHub-style anchor id. */
  id: string;
  /** 0-based source line. */
  line: number;
}

export interface DocStats {
  words: number;
  characters: number;
  charactersNoSpaces: number;
}

export interface Frontmatter {
  data: Record<string, unknown>;
  /** 0-based line of the opening `---`. */
  line: number;
  /** 0-based line of the closing delimiter. */
  endLine: number;
}

export interface Analysis {
  headings: Heading[];
  stats: DocStats;
  frontmatter: Frontmatter | null;
}

export interface RenderResult extends Analysis {
  blocks: RenderedBlock[];
  /** `mermaid` and `graphviz` are set (true) only when the document has such a diagram. */
  features: { math: boolean; languages: string[]; mermaid?: boolean; graphviz?: boolean };
  /**
   * A parse error (MDX). `line` is 1-based, as the message shows it. The preview keeps the last
   * good blocks and shows a banner; `blocks` of a result with an error are not used.
   */
  error?: { line: number; message: string };
}

/** A cross-reference target of a document (Quarto, bookdown). */
export interface Label {
  kind: 'fig' | 'tbl' | 'sec' | 'eq' | 'lst' | 'thm' | 'example';
  number: string;
  text: string;
  line: number;
}

/**
 * Whole-document facts every block may need. `bibliography` is typed
 * by the pack that parses it; the shell never looks into it.
 */
export interface DocContext<B = unknown> {
  metadata: Record<string, unknown>;
  labels: Map<string, Label>;
  citationKeys: string[];
  bibliography: B | null;
  vault: VaultIndex | null;
  includes: Map<string, string>;
  /** A hash of everything above: equal signatures mean equal output for the same block text. */
  signature: string;
}

/** What a pack wants fetched for a document (hrefs as written in the document or its metadata). */
export interface ContextNeeds {
  bibliographies: string[];
  includes: string[];
  vault: boolean;
  project: boolean;
}

/** What the shell fetched. A null include is a file that was not found. */
export interface ContextInputs {
  /** The path of the document, or null when it is not saved. */
  path: string | null;
  bibliographies: { href: string; path: string; text: string }[];
  includes: Map<string, { path: string; text: string } | null>;
  vault: VaultIndex | null;
  project: { path: string; text: string } | null;
}

export interface Pipeline {
  /** The flavor that is really rendered: 'commonmark' or 'gfm' in Phase 1. */
  readonly flavor: FlavorId;
  /** Parses once, renders every block, and sanitizes the blocks that were not seen before. */
  render(source: string, context?: DocContext): RenderResult;
  /** Parses only (a hidden preview, the text of a selection). */
  analyze(source: string, context?: DocContext): Analysis;
  /** What the shell must fetch for this source. Absent: nothing (CommonMark, GFM). */
  needs?(source: string): ContextNeeds;
  /** A cheap scan of the whole source, with what the shell fetched. */
  prepare?(source: string, inputs: ContextInputs): DocContext;
  /**
   * Starts loading code that `prepare` needs but cannot load itself, because it is synchronous
   * (the BibTeX parser). Returns undefined when there is nothing to wait for; otherwise a promise
   * that settles when `prepare` can use it. The shell awaits it and renders again.
   */
  preload?(inputs: ContextInputs): Promise<void> | undefined;
  /** The data the editor's completion sources read (citation keys, labels, notes). */
  completions?(context: DocContext): CompletionData;
}
