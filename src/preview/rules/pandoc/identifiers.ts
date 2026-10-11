/**
 * Heading identifiers the way Pandoc makes them (`auto_identifiers`, the Pandoc manual, "Heading
 * identifiers"): the text without formatting, every character that is not a letter, a digit, an
 * underscore, a hyphen, a period or a space is dropped, runs of spaces become one hyphen, letters
 * are lower-cased, everything up to the first letter is removed, and `section` stands for an empty
 * result. A repeated identifier gets `-1`, `-2` and so on.
 */
import { Slugger } from '../../slug';

const DROPPED = /[^\p{L}\p{N}_.\s-]/gu;
const BEFORE_FIRST_LETTER = /^[^\p{L}]+/u;

/** The identifier Pandoc derives from the text of a heading (before repeats are told apart). */
export function pandocIdentifier(text: string): string {
  const words = text.replace(DROPPED, '').split(/\s+/u).filter(Boolean);
  const id = words.join('-').toLowerCase().replace(BEFORE_FIRST_LETTER, '');
  return id === '' ? 'section' : id;
}

const REPEAT = /^(.*)-\d+$/su;

export class PandocSlugger extends Slugger {
  override slug(text: string): string {
    return this.unique(pandocIdentifier(text));
  }

  /** An identifier the document wrote itself: taken, so a derived one never collides with it. */
  reserve(id: string): void {
    if (!this.occurrences.has(id)) this.occurrences.set(id, 0);
  }

  /** A heading seen before: derived ids are made again, written ones are only reserved. */
  override replay(text: string, id: string): void {
    const base = pandocIdentifier(text);
    if (id === base || REPEAT.exec(id)?.[1] === base) this.unique(base);
    else this.reserve(id);
  }
}

export function createPandocSlugger(): Slugger {
  return new PandocSlugger();
}
