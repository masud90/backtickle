/**
 * Bibliographies: BibTeX / BibLaTeX, CSL JSON, CSL YAML and the inline `references` of a document,
 * read into one list of items and merged. This module is
 * a lazy chunk of its own: a document that cites nothing never loads it, and with it the BibTeX
 * parser.
 */
import { parseCslJson, parseCslYaml, referencesFromMetadata } from './csl';
import type {
  Bibliography,
  BibliographyFormat,
  BibliographySource,
  DuplicateKey,
  ParsedBibliography,
} from './types';

export type {
  Bibliography,
  BibliographyFormat,
  BibliographySource,
  CslDate,
  CslItem,
  CslName,
  DuplicateKey,
  ParsedBibliography,
} from './types';

/** The format a file name suggests, or null for an extension that is not a bibliography. */
export function guessFormat(path: string): BibliographyFormat | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(path.split(/[\\/]/).pop() ?? '');
  switch (match?.[1]?.toLowerCase()) {
    case 'bib':
    case 'bibtex':
    case 'biblatex':
      return 'bibtex';
    case 'json':
    case 'csljson':
      return 'csl-json';
    case 'yaml':
    case 'yml':
    case 'cslyaml':
      return 'csl-yaml';
    default:
      return null;
  }
}

type BibtexParser = (text: string) => ParsedBibliography;
let bibtexParser: BibtexParser | null = null;
let bibtexLoading: Promise<void> | null = null;

/**
 * The BibTeX parser is a chunk of its own (`@retorquere/bibtex-parser` is large): it is loaded
 * only when a document names a `.bib` file. Until then `parseBibliography` of BibTeX gives no
 * items and an error, and `isBibtexLoaded` is false.
 */
export function loadBibtex(): Promise<void> {
  bibtexLoading ??= import('./bibtex').then(
    (module) => {
      bibtexParser = module.parseBibtex;
    },
    // A failed load is not retried (the citations stay pending): no loop of renders.
    () => undefined,
  );
  return bibtexLoading;
}

export function isBibtexLoaded(): boolean {
  return bibtexParser !== null;
}

/** Reads one bibliography file. Problems come back as generic messages, never as the file text. */
export function parseBibliography(text: string, format: BibliographyFormat): ParsedBibliography {
  switch (format) {
    case 'bibtex':
      return bibtexParser
        ? bibtexParser(text)
        : { items: [], errors: ['The BibTeX reader is not loaded yet.'] };
    case 'csl-json':
      return parseCslJson(text);
    case 'csl-yaml':
      return parseCslYaml(text);
  }
}

/** The inline `references` of a document's metadata, as a source. */
export function inlineSource(metadata: Record<string, unknown>): BibliographySource {
  return { name: 'references', items: referencesFromMetadata(metadata).items };
}

/**
 * Merges sources in the order given: the first item with a key wins, later ones with the same key
 * are reported in `duplicates` and dropped.
 */
export function mergeBibliographies(sources: readonly BibliographySource[]): Bibliography {
  const items = new Map<string, BibliographySource['items'][number]>();
  const duplicates: DuplicateKey[] = [];
  for (const source of sources) {
    for (const item of source.items) {
      if (items.has(item.id)) duplicates.push({ key: item.id, source: source.name });
      else items.set(item.id, item);
    }
  }
  return { items, duplicates };
}
