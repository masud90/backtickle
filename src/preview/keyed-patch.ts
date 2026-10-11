/**
 * Keyed patching of the block elements in the preview. A document is a list of blocks, each with a
 * key (a hash of its HTML). Comparing the keys of the blocks on screen with the keys of the new
 * blocks gives a common prefix and a common suffix; everything between them is replaced, and the
 * blocks of the prefix and the suffix keep their elements. Editing one block therefore replaces
 * one element, however long the document is, and the cost of finding it is a comparison of strings.
 */

export interface PatchPlan {
  /** Blocks at the start with the same key on both sides. */
  prefix: number;
  /** Blocks at the end with the same key on both sides (not overlapping the prefix). */
  suffix: number;
}

/** Common prefix and suffix of two lists of keys. */
export function planPatch(
  current: readonly { key: string }[],
  next: readonly { key: string }[],
): PatchPlan {
  const shortest = Math.min(current.length, next.length);
  let prefix = 0;
  while (prefix < shortest && current[prefix]?.key === next[prefix]?.key) prefix++;
  let suffix = 0;
  while (
    suffix < shortest - prefix &&
    current[current.length - 1 - suffix]?.key === next[next.length - 1 - suffix]?.key
  ) {
    suffix++;
  }
  return { prefix, suffix };
}
