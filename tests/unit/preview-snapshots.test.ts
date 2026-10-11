// @vitest-environment jsdom
/**
 * Rendering snapshots: the preview of the GFM guide, the CommonMark guide and the wireframe sample,
 * after sanitizing AND after the trusted enhancements (icons, Copy buttons, token colors, MathML).
 * They are plain files in tests/unit/__snapshots__/preview/, meant to be read in a diff:
 * one block per wrapper, indented, with the path data of icons shortened to an ellipsis.
 * Update them with `npx vitest run -u tests/unit/preview-snapshots.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { PreviewController } from '@/preview/controller';
import { createCommonMarkPipeline } from '@/preview/packs/commonmark';
import { createGfmPipeline } from '@/preview/packs/gfm';
import type { Pipeline } from '@/preview/types';
import commonmarkGuide from '../../src/content/guides/commonmark.md?raw';
import gfmGuide from '../../src/content/guides/gfm.md?raw';
import phase0Sample from '../fixtures/perf/wireframe-sample-phase0.md?raw';
import sample from '../fixtures/wireframe-sample.md?raw';

const BLOCK_TAGS = new Set([
  'div',
  'p',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'section',
  'header',
  'dl',
  'table',
  'thead',
  'tbody',
  'tr',
  'details',
  'figure',
]);

function isInlineOnly(element: Element): boolean {
  return Array.from(element.children).every(
    (child) => !BLOCK_TAGS.has(child.tagName.toLowerCase()) && child.tagName !== 'PRE',
  );
}

function shorten(html: string): string {
  return html.replace(/<svg([^>]*)>[\s\S]*?<\/svg>/g, '<svg$1>...</svg>');
}

function format(element: Element, depth: number, out: string[]): void {
  const indent = '  '.repeat(depth);
  const tag = element.tagName.toLowerCase();
  if (!BLOCK_TAGS.has(tag) || isInlineOnly(element)) {
    out.push(`${indent}${shorten(element.outerHTML)}`);
    return;
  }
  const open = element.outerHTML.slice(0, element.outerHTML.indexOf('>') + 1);
  out.push(`${indent}${open}`);
  for (const child of element.childNodes) {
    if (child.nodeType === 1) format(child as Element, depth + 1, out);
    else if ((child.textContent ?? '').trim() !== '')
      out.push(`${indent}  ${(child.textContent ?? '').trim()}`);
  }
  out.push(`${indent}</${tag}>`);
}

async function snapshot(pipeline: Pipeline, source: string): Promise<string> {
  const container = document.createElement('article');
  document.body.append(container);
  const controller = new PreviewController({ container, getSource: () => source, pipeline });
  controller.renderNow();
  await controller.whenSettled();
  const lines: string[] = [];
  for (const block of container.children) format(block, 0, lines);
  controller.dispose();
  container.remove();
  return `${lines.join('\n')}\n`;
}

describe('rendering snapshots', () => {
  it('the GFM guide', async () => {
    await expect(await snapshot(createGfmPipeline(), gfmGuide)).toMatchFileSnapshot(
      './__snapshots__/preview/gfm-guide.html.snap',
    );
  });

  it('the CommonMark guide, with the CommonMark pack', async () => {
    await expect(await snapshot(createCommonMarkPipeline(), commonmarkGuide)).toMatchFileSnapshot(
      './__snapshots__/preview/commonmark-guide.html.snap',
    );
  });

  it('the wireframe sample', async () => {
    await expect(await snapshot(createGfmPipeline(), sample)).toMatchFileSnapshot(
      './__snapshots__/preview/wireframe-sample.html.snap',
    );
  });

  it('the Phase 0 wireframe sample (tag line as plain text)', async () => {
    await expect(await snapshot(createGfmPipeline(), phase0Sample)).toMatchFileSnapshot(
      './__snapshots__/preview/wireframe-sample-phase0.html.snap',
    );
  });
});
