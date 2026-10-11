/**
 * Types for the two packages that ship without them: `markdown-it-footnote` and the shortcode
 * table of `markdown-it-emoji`. They are loaded only by the GFM pack (`packs/gfm.ts`, which
 * references this file).
 */
declare module 'markdown-it-footnote' {
  import type { MarkdownIt } from 'markdown-it';

  const footnote: (md: MarkdownIt) => void;
  export default footnote;
}

declare module 'markdown-it-emoji/lib/data/full.mjs' {
  /** Shortcode (without the colons) to the character it stands for. */
  const definitions: Record<string, string>;
  export default definitions;
}
