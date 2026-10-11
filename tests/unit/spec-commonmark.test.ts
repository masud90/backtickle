// The jsdom environment gives the entity decoding of the normalizer a real DOM to use.
// @vitest-environment jsdom
/**
 * CommonMark conformance: all examples of the CommonMark specification (package `commonmark-spec`,
 * CC BY-SA 4.0, test data only, never imported by `src/`) against the output of the CommonMark
 * pack.
 *
 * What is compared is the HTML the renderer makes, before the sanitizer sees it, with the
 * additions of the preview taken away: the code card around `pre`, the ids of headings, and the
 * relative line numbers of list items. Both sides are then normalized the way the CommonMark
 * test suite does (see `normalizeHtml` in the helpers): white space between block elements is
 * ignored, attributes are sorted, and entities are decoded.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { createCommonMarkPipeline } from '@/preview/packs/commonmark';
import { normalizeHtml, plainHtml } from './preview-helpers';

interface Example {
  markdown: string;
  html: string;
  section: string;
  number: number;
}

// The package is plain CommonJS without type declarations.
const examples = (createRequire(import.meta.url)('commonmark-spec') as { tests: Example[] }).tests;

/**
 * Examples where the CommonMark pack knowingly differs from the specification's HTML, by example
 * number, each with the reason. Empty: the pack passes all 652 examples.
 */
const KNOWN_DIFFERENCES = new Map<number, string>([]);

const pipeline = createCommonMarkPipeline();

describe('CommonMark conformance (commonmark-spec 0.31.2)', () => {
  it('has all 652 examples of the specification', () => {
    expect(examples).toHaveLength(652);
  });

  // One test per example, so a failure names its example and the report can count them.
  for (const example of examples) {
    const name = `example ${example.number} (${example.section})`;
    const run = () => {
      const markdown = example.markdown.replace(/\u2192/g, '\t');
      const expected = normalizeHtml(example.html.replace(/\u2192/g, '\t'));
      const actual = normalizeHtml(plainHtml(pipeline.renderRaw(markdown)));
      expect(actual, `${name}\n--- markdown\n${markdown}`).toBe(expected);
    };
    const reason = KNOWN_DIFFERENCES.get(example.number);
    if (reason === undefined) it(name, run);
    else it.skip(`${name}: ${reason}`, run);
  }
});
