/**
 * The MDX parser: micromark with the MDX, GFM, frontmatter and math extensions, to an mdast tree
 *. It only parses. The `estree` of ESM blocks and expressions
 * is produced by acorn and is never run: nothing in this pack evaluates, constructs functions
 * from, or imports document text.
 */
import type { Root } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { mathFromMarkdown } from 'mdast-util-math';
import { mdxFromMarkdown } from 'mdast-util-mdx';
import { frontmatter } from 'micromark-extension-frontmatter';
import { gfm } from 'micromark-extension-gfm';
import { math } from 'micromark-extension-math';
import { mdxjs } from 'micromark-extension-mdxjs';

export interface MdxError {
  /** 1-based, as the parser's message shows it. */
  line: number;
  message: string;
}

export type ParseOutcome =
  | { tree: Root; error?: undefined }
  | { tree?: undefined; error: MdxError };

/** The position the messages of mdast-util-mdx carry: " (15:1-15:10)", sometimes before more text. */
const POSITION_SUFFIX = /\s*\((\d+):(\d+)(?:-\d+:\d+)?\)/;

interface ParserFailure {
  message?: unknown;
  reason?: unknown;
  line?: unknown;
  place?: { line?: unknown; start?: { line?: unknown } } | null;
}

function lineOf(failure: ParserFailure, message: string, lineCount: number): number {
  let line: number | undefined;
  if (typeof failure.line === 'number') line = failure.line;
  else if (typeof failure.place?.start?.line === 'number') line = failure.place.start.line;
  else if (typeof failure.place?.line === 'number') line = failure.place.line;
  else {
    const match = POSITION_SUFFIX.exec(message);
    if (match?.[1]) line = Number(match[1]);
  }
  if (line === undefined || !Number.isFinite(line)) line = 1;
  return Math.min(Math.max(Math.trunc(line), 1), Math.max(lineCount, 1));
}

/** Parses an MDX document. A parse error is returned, not thrown. */
export function parseMdx(source: string): ParseOutcome {
  try {
    const tree = fromMarkdown(source, {
      extensions: [frontmatter(['yaml']), mdxjs(), gfm(), math()],
      mdastExtensions: [
        frontmatterFromMarkdown(['yaml']),
        mdxFromMarkdown(),
        gfmFromMarkdown(),
        mathFromMarkdown(),
      ],
    });
    return { tree };
  } catch (thrown) {
    const failure = (typeof thrown === 'object' && thrown !== null ? thrown : {}) as ParserFailure;
    const raw =
      typeof failure.reason === 'string'
        ? failure.reason
        : typeof failure.message === 'string'
          ? failure.message
          : 'The document could not be parsed.';
    const message = raw.replace(POSITION_SUFFIX, '').trim() || 'The document could not be parsed.';
    let lineCount = 1;
    for (let i = source.indexOf('\n'); i !== -1; i = source.indexOf('\n', i + 1)) lineCount++;
    return { error: { line: lineOf(failure, raw, lineCount), message } };
  }
}
