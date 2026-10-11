/**
 * Cutting a large source into windows that can be parsed one after the other.
 *
 * markdown-it makes tokens for the whole document before anything is rendered, and for a 5 MiB
 * document those tokens are several hundred megabytes of short-lived objects that the web view
 * does not hand back for a long time. Parsing a window at a time keeps only the tokens of one
 * window alive: each window is parsed, rendered to blocks, counted, and dropped.
 *
 * A window may only start where the parser, given the whole document, also starts a top-level
 * block that nothing before it can reach into. This module finds such places from the text alone,
 * and it errs on the side of fewer cuts. A cut is made in front of a line when
 * - the line before it is blank, and the line itself is not blank and starts in column 0 (so it
 *   cannot continue a list item, an indented code block, a footnote or a quote), is not a list
 *   marker (a list goes on across blank lines), and is not inside a fenced code block, an HTML
 *   block that only a closing marker ends (`<!--`, `<script`, `<pre`, `<style`, `<textarea`, `<?`,
 *   `<!X`, `<![CDATA[`), or the frontmatter;
 * and the document as a whole must not contain a line that looks like a link reference
 *   definition or a footnote definition, or a `$$` line that opens a formula over several lines:
 *   those reach across the document (a `$$` is math only if a closing `$$` follows somewhere,
 *   blank lines and code included), so such a document is parsed as one.
 * Where the cuts would depend on how the parser reads something inside a list or a quote (a
 * fence or an HTML block that is indented, a fence in the middle of HTML), the scan gives up too.
 * A document that is not cut is simply parsed as before.
 */

/** Documents shorter than this are parsed in one piece. */
export const WINDOW_MIN_CHARS = 524_288;
/** A window is cut at the first safe place after this many characters. */
export const WINDOW_CHARS = 131_072;

export interface SourceWindow {
  /** The text of the window. Windows follow each other without gaps. */
  text: string;
  /** The 0-based line of the document where the window starts. */
  line: number;
}

/** A line that defines a link reference or a footnote, in any container: cut nothing. */
const DEFINITION = /^[ \t>*+\-\d.)]*\[[^\]\n]*\]:/m;
/** A line that starts with `$$` (in any container): see `hasOpeningFormula`. */
const DOLLARS = /^[ \t>*+\-\d.)]*\$\$[^\n]*/gm;
const LIST_MARKER = /^(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FRONTMATTER_OPEN = /^---[ \t]*$/;
const FRONTMATTER_CLOSE = /^(?:---|\.\.\.)[ \t]*$/;
/** A line that may start an HTML block that a blank line ends (types 6 and 7). */
const HTML_LIKE = /^ {0,3}<[A-Za-z/!?]/;
const HTML_START_1 = /^ {0,3}<(?:script|pre|style|textarea)(?:[ \t>]|$)/i;

interface Fence {
  char: string;
  length: number;
  /** Spaces before the opening marker. */
  indent: number;
}

/** What the line opens, if it is the start of a block that can contain blank lines. */
function openingOf(line: string): { fence: Fence } | { html: string } | undefined {
  const fence = FENCE_OPEN.exec(line);
  if (fence) {
    const marks = fence[1] as string;
    // The info string of a backtick fence cannot contain a backtick: that is inline code.
    if (!(marks.startsWith('`') && (fence[2] as string).includes('`'))) {
      const indent = line.length - line.trimStart().length;
      return { fence: { char: marks.charAt(0), length: marks.length, indent } };
    }
  }
  const trimmed = line.trimStart();
  if (line.length - trimmed.length > 3) return undefined;
  if (HTML_START_1.test(line)) {
    const name = /^<(script|pre|style|textarea)/i.exec(trimmed)?.[1]?.toLowerCase() ?? '';
    const end = `</${name}>`;
    return line.toLowerCase().includes(end, 1) ? undefined : { html: end };
  }
  if (trimmed.startsWith('<!--'))
    return line.includes('-->', line.indexOf('<!--') + 4) ? undefined : { html: '-->' };
  if (trimmed.startsWith('<?'))
    return line.includes('?>', line.indexOf('<?') + 2) ? undefined : { html: '?>' };
  if (trimmed.startsWith('<![CDATA[')) {
    return line.includes(']]>', line.indexOf('<![CDATA[') + 9) ? undefined : { html: ']]>' };
  }
  if (/^<![A-Za-z]/.test(trimmed)) {
    return line.includes('>', line.indexOf('<!') + 2) ? undefined : { html: '>' };
  }
  return undefined;
}

/** True if the text has a `$$` that opens a formula over several lines (or may). */
function hasOpeningFormula(text: string): boolean {
  DOLLARS.lastIndex = 0;
  for (let match = DOLLARS.exec(text); match; match = DOLLARS.exec(text)) {
    const line = match[0];
    const rest = line.slice(line.indexOf('$$') + 2).trim();
    // The rule of the preview takes `$$ ... $$` on one line as a formula of its own.
    if (!(rest.length > 2 && rest.endsWith('$$'))) return true;
  }
  return false;
}

function closesFence(line: string, fence: Fence): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  const marks = match?.[1];
  return marks?.startsWith(fence.char) === true && marks.length >= fence.length;
}

/**
 * The windows of `text` (already normalized to `\n` line endings), or null when it should be
 * parsed as one piece: it is short, it has definitions that reach across the document, or it has
 * no place to cut.
 */
export function splitSource(
  text: string,
  options: {
    minChars?: number;
    windowChars?: number;
    /**
     * A pack's extra rule: true when a window must not start at the line with this index (inside
     * a fenced div, a grid table). `lines` are the lines of `text`.
     */
    unsafeSplit?: (lines: readonly string[], index: number) => boolean;
  } = {},
): SourceWindow[] | null {
  const minChars = options.minChars ?? WINDOW_MIN_CHARS;
  const windowChars = options.windowChars ?? WINDOW_CHARS;
  if (text.length < minChars || DEFINITION.test(text) || hasOpeningFormula(text)) return null;
  const unsafeSplit = options.unsafeSplit;
  const lines = unsafeSplit ? text.split('\n') : null;

  const windows: SourceWindow[] = [];
  let windowStart = 0;
  let windowLine = 0;

  let fence: Fence | null = null;
  let htmlEnd: string | null = null;
  let previousBlank = false;
  // The current run of lines without a blank line has one that may start an HTML block.
  let htmlRun = false;
  // The lines up to the end of the frontmatter, if the document has one, are never cut.
  let noCutBefore = 0;

  let offset = 0;
  let index = 0;
  const first = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  if (FRONTMATTER_OPEN.test(first)) {
    // Find the closing line: the lines until then belong to the frontmatter (if it is one).
    let scan = first.length + 1;
    for (let n = 1; scan <= text.length; n++) {
      const stop = text.indexOf('\n', scan);
      const lineText = text.slice(scan, stop === -1 ? text.length : stop);
      if (FRONTMATTER_CLOSE.test(lineText)) {
        noCutBefore = n + 1;
        break;
      }
      if (stop === -1) break;
      scan = stop + 1;
    }
  }

  while (offset < text.length) {
    const stop = text.indexOf('\n', offset);
    const end = stop === -1 ? text.length : stop;
    const line = text.slice(offset, end);

    if (fence) {
      if (closesFence(line, fence)) {
        // A closing marker that sits left of the opening one may belong to an enclosing list
        // item that has ended (and then it opens a fence of its own): too uncertain to cut.
        if (line.length - line.trimStart().length < fence.indent) return null;
        fence = null;
      } else if (fence.indent > 0 && !/^[ \t]*$/.test(line)) {
        // Likewise a line that is less indented than the opening marker: it may end the
        // list item that holds the fence.
        const indent = line.length - line.trimStart().length;
        if (indent < fence.indent) return null;
      }
    } else if (htmlEnd !== null) {
      if (line.toLowerCase().includes(htmlEnd)) htmlEnd = null;
    } else if (/^[ \t]*$/.test(line)) {
      previousBlank = true;
      htmlRun = false;
    } else {
      const column0 = line.charCodeAt(0) !== 0x20 && line.charCodeAt(0) !== 0x09;
      if (
        previousBlank &&
        column0 &&
        index >= noCutBefore &&
        !LIST_MARKER.test(line) &&
        offset - windowStart >= windowChars &&
        !(unsafeSplit && lines && unsafeSplit(lines, index))
      ) {
        windows.push({ text: text.slice(windowStart, offset), line: windowLine });
        windowStart = offset;
        windowLine = index;
      }
      previousBlank = false;
      // After a line that may start an HTML block, the lines up to the next blank line are HTML
      // if it did, and Markdown if it did not (a block of type 7 cannot interrupt a paragraph).
      // A line that opens a fence is read differently in the two cases: give up.
      if (htmlRun && FENCE_OPEN.test(line)) return null;
      const opening = openingOf(line);
      if (!opening && HTML_LIKE.test(line)) htmlRun = true;
      if (opening) {
        if ('fence' in opening) {
          fence = opening.fence;
        } else {
          // An HTML block that only a closing marker ends, in a place where a list item or a
          // quote may hold it: where the container ends is not known from here.
          if (line.charCodeAt(0) === 0x20 || line.charCodeAt(0) === 0x09) return null;
          htmlEnd = opening.html;
        }
      }
    }

    offset = end + 1;
    index++;
  }

  if (windows.length === 0) return null;
  windows.push({ text: text.slice(windowStart), line: windowLine });
  return windows;
}
