/**
 * Token colors for code cards, with the same Lezer parsers as the editor, so the colors of the
 * preview match the source. A language is loaded the first time a code block uses it (the list
 * of languages and each parser are separate chunks) and kept. The classes are the `tok-*`
 * classes of `classHighlighter`; the colors are in `preview.css`.
 *
 * The code text is read from the sanitized DOM as text and put back as text nodes and spans of
 * this module's own making: nothing from the document is ever used as markup here.
 */
import type { LanguageSupport } from '@codemirror/language';
import { classHighlighter, highlightCode } from '@lezer/highlight';

export type LezerParser = LanguageSupport['language']['parser'];

/** Larger code is shown without colors: parsing it would stall the page. */
export const MAX_HIGHLIGHT_CHARS = 100_000;

/** Parsers that are loaded, by lower-case language; null means there is no such language. */
const loaded = new Map<string, LezerParser | null>();
const loading = new Map<string, Promise<LezerParser | null>>();

/** The parser if it is loaded already, null if the language is unknown, undefined if not loaded. */
export function loadedParser(language: string): LezerParser | null | undefined {
  return loaded.get(language.toLowerCase());
}

/** Loads the parser of a language (by name, alias or file extension). */
export function loadParser(language: string): Promise<LezerParser | null> {
  const key = language.toLowerCase();
  const known = loaded.get(key);
  if (known !== undefined) return Promise.resolve(known);
  let promise = loading.get(key);
  if (!promise) {
    promise = findParser(key).then(
      (parser) => {
        loaded.set(key, parser);
        loading.delete(key);
        return parser;
      },
      () => {
        // The chunk could not be read: remember nothing, so a later block can try again.
        loading.delete(key);
        return null;
      },
    );
    loading.set(key, promise);
  }
  return promise;
}

async function findParser(key: string): Promise<LezerParser | null> {
  if (key === '') return null;
  const [{ LanguageDescription }, { languages }] = await Promise.all([
    import('@codemirror/language'),
    import('@codemirror/language-data'),
  ]);
  // Exact names and aliases first, then the extension (`py`, `rs`, `yml`). No fuzzy matching: a
  // short alias such as "c" would otherwise claim every name that contains the letter.
  const description =
    LanguageDescription.matchLanguageName(languages, key, false) ??
    LanguageDescription.matchFilename(languages, `file.${key}`);
  if (!description) return null;
  const support = await description.load();
  return support.language.parser;
}

/** Replaces the text of a `code` element with the same text in spans with token classes. */
export function highlightElement(code: Element, parser: LezerParser): void {
  const source = code.textContent ?? '';
  if (source === '' || source.length > MAX_HIGHLIGHT_CHARS) return;
  const document = code.ownerDocument;
  const fragment = document.createDocumentFragment();
  let plain = '';
  const flush = () => {
    if (plain !== '') {
      fragment.append(plain);
      plain = '';
    }
  };
  highlightCode(
    source,
    parser.parse(source),
    classHighlighter,
    (text, classes) => {
      if (classes === '') {
        plain += text;
        return;
      }
      flush();
      const span = document.createElement('span');
      span.className = classes;
      span.textContent = text;
      fragment.append(span);
    },
    () => {
      plain += '\n';
    },
  );
  flush();
  code.replaceChildren(fragment);
}
