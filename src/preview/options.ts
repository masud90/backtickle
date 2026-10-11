/**
 * The preview settings that change what the render pipelines produce:
 * hashtag pills outside Obsidian, dimmed Obsidian comments, smart punctuation in the Pandoc and
 * Quarto packs, math, and remote images. They are module state because the pipelines are shared
 * by every tab. A change clears the caches of the loaded pipelines (their block keys and window
 * keys come from the rendered text, and a rule that reads an option must not be served from the
 * cache of the other setting) and tells the preview controllers to render once.
 */

export interface PreviewOptions {
  hashtagPills: boolean;
  obsidianCommentsDimmed: boolean;
  smartPunctuation: boolean;
  math: boolean;
  remoteImages: boolean;
}

export const DEFAULT_PREVIEW_OPTIONS: Readonly<PreviewOptions> = {
  hashtagPills: false,
  obsidianCommentsDimmed: false,
  smartPunctuation: true,
  math: true,
  remoteImages: true,
};

let current: PreviewOptions = { ...DEFAULT_PREVIEW_OPTIONS };
const listeners = new Set<() => void>();
const cacheClearers = new Set<WeakRef<{ clearCaches(): void }>>();

export function previewOptions(): Readonly<PreviewOptions> {
  return current;
}

/** A short text that differs when any option differs. */
export function previewOptionsSignature(): string {
  const o = current;
  return [o.hashtagPills, o.obsidianCommentsDimmed, o.smartPunctuation, o.math, o.remoteImages]
    .map((flag) => (flag ? '1' : '0'))
    .join('');
}

/** Sets the options. Returns true (and notifies once) when something changed. */
export function setPreviewOptions(next: Partial<PreviewOptions>): boolean {
  const merged = { ...current, ...next };
  const changed = (Object.keys(merged) as (keyof PreviewOptions)[]).some(
    (key) => merged[key] !== current[key],
  );
  if (!changed) return false;
  current = merged;
  for (const ref of [...cacheClearers]) {
    const target = ref.deref();
    if (target) target.clearCaches();
    else cacheClearers.delete(ref);
  }
  for (const listener of [...listeners]) listener();
  return true;
}

/** Called after every change; returns the unsubscribe function. */
export function onPreviewOptionsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A pipeline registers itself, so its caches are cleared before the listeners render again. */
export function registerCacheOwner(owner: { clearCaches(): void }): void {
  cacheClearers.add(new WeakRef(owner));
}

/**
 * Added to the key of a block. Only the options that act after the raw HTML is made (the
 * sanitizer) need it: the raw HTML itself already differs for the others.
 */
export function blockKeySuffix(): string {
  return current.remoteImages ? '' : '\u0000no-remote-images';
}
