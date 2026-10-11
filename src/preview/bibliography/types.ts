/**
 * The bibliography item model: the subset of CSL JSON (https://citeproc-js.readthedocs.io) that
 * the author-date citation text and the reference list need. Every bibliography format is
 * parsed into this shape.
 */

export interface CslName {
  family?: string;
  given?: string;
  /** A name that is not split into parts (an institution). */
  literal?: string;
  'non-dropping-particle'?: string;
  'dropping-particle'?: string;
  suffix?: string;
}

export interface CslDate {
  /** `[[year, month, day]]`, month and day optional. */
  'date-parts'?: number[][];
  literal?: string;
}

export interface CslItem {
  id: string;
  type: string;
  author?: CslName[];
  editor?: CslName[];
  translator?: CslName[];
  title?: string;
  'title-short'?: string;
  'container-title'?: string;
  'collection-title'?: string;
  publisher?: string;
  'publisher-place'?: string;
  issued?: CslDate;
  accessed?: CslDate;
  volume?: string;
  issue?: string;
  number?: string;
  page?: string;
  edition?: string;
  genre?: string;
  /** CSL language tag; titles are title-cased only when it is empty or English. */
  language?: string;
  note?: string;
  abstract?: string;
  DOI?: string;
  URL?: string;
  ISBN?: string;
  ISSN?: string;
}

export type BibliographyFormat = 'bibtex' | 'csl-json' | 'csl-yaml';

/** One source of items before merging. */
export interface BibliographySource {
  /** The file name or `references` (inline), for messages. */
  name: string;
  items: CslItem[];
}

/** A key that appeared in more than one source (or twice in one): the later one was dropped. */
export interface DuplicateKey {
  key: string;
  /** The source of the dropped item. */
  source: string;
}

/** The merged items of a document, by key, in the order they were read. */
export interface Bibliography {
  items: Map<string, CslItem>;
  duplicates: DuplicateKey[];
}

export interface ParsedBibliography {
  items: CslItem[];
  /** Problems found while reading (a generic text each, never a copy of the input). */
  errors: string[];
}
