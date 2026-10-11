/**
 * GitHub-style heading anchors: the text is lower-cased, characters other than Unicode letters,
 * marks, digits, hyphens, underscores and spaces are dropped, and every space becomes a hyphen.
 * A repeated heading gets `-1`, `-2` and so on (the algorithm of github-slugger).
 */

/** Emoji joiners and variation selectors would survive the mark rule and leave stray characters. */
const INVISIBLE = /[‍︎️]/g;
const DROPPED = /[^\p{L}\p{M}\p{N}_ -]/gu;

export function slugify(text: string): string {
  return text.toLowerCase().replace(INVISIBLE, '').replace(DROPPED, '').replace(/ /g, '-');
}

export class Slugger {
  protected readonly occurrences = new Map<string, number>();

  /** The unique id for a heading with this text. Call once per heading, in document order. */
  slug(text: string): string {
    return this.unique(slugify(text));
  }

  /**
   * Makes the state of the slugger what it was after a heading that was already seen (a window
   * taken from the cache). `id` is the id the heading was given. The default ignores it.
   */
  replay(text: string, _id: string): void {
    this.slug(text);
  }

  /** `base` if it is free, else `base-1`, `base-2` and so on; the result is taken. */
  protected unique(base: string): string {
    let slug = base;
    while (this.occurrences.has(slug)) {
      const next = (this.occurrences.get(base) ?? 0) + 1;
      this.occurrences.set(base, next);
      slug = `${base}-${next}`;
    }
    this.occurrences.set(slug, 0);
    return slug;
  }
}
