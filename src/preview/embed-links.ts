/**
 * Which files the embedded notes of a document were read from, so the watcher can follow them.
 * Tiny and dependency free on purpose: the shell imports it without loading the embed chunk.
 */
const byDocument = new Map<string, Set<string>>();
let listener: (() => void) | undefined;

/** The shell is told when a document starts using a file it did not use before. */
export function onEmbedLinked(fn: (() => void) | undefined): void {
  listener = fn;
}

/** An embed in `document` was read from the canonical `path`. */
export function recordEmbed(document: string, path: string): void {
  const set = byDocument.get(document) ?? new Set<string>();
  byDocument.set(document, set);
  if (set.has(path)) return;
  set.add(path);
  listener?.();
}

/** The canonical paths of the notes embedded in `document`. */
export function embedPathsOf(document: string | null): string[] {
  return document ? [...(byDocument.get(document) ?? [])] : [];
}

/** True when `document` embeds one of `paths`. */
export function embedsUse(document: string | null, paths: readonly string[]): boolean {
  const known = byDocument.get(document ?? '');
  return !!known && paths.some((path) => known.has(path));
}

/** A document closed or changed place: forget what it embedded. */
export function forgetEmbeds(document: string): void {
  byDocument.delete(document);
}
