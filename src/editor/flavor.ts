/**
 * The Markdown flavors the editor knows about: the same string union as the flavor registry
 *, declared here so the editor does not depend on `src/flavors`.
 */
export type FlavorId = 'commonmark' | 'gfm' | 'obsidian' | 'pandoc' | 'quarto' | 'mdx';

/** The grammar the editor actually parses with. */
export type ParserBase = 'commonmark' | 'gfm';

/**
 * Phase 1 parses strict CommonMark for the CommonMark flavor and GFM for every other flavor
 * (the four later flavors open as GFM until their own syntax is built).
 */
export function parserBase(flavor: FlavorId): ParserBase {
  return flavor === 'commonmark' ? 'commonmark' : 'gfm';
}
