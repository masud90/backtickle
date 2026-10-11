// @vitest-environment jsdom
/** Graphviz: the fence rule in each pack, the feature flag, and the placeholder. */
import { describe, expect, it } from 'vitest';
import { hashString } from '@/preview/hash';
import { createCommonMarkPipeline } from '@/preview/packs/commonmark';
import { createGfmPipeline } from '@/preview/packs/gfm';
import { createObsidianPipeline } from '@/preview/packs/obsidian';
import { createPandocPipeline } from '@/preview/packs/pandoc';
import { createQuartoPipeline } from '@/preview/packs/quarto';

const source = 'digraph G { A [label="<b>x</b>"] -> B }\n';
const htmlOf = (pipeline: { render(s: string): { blocks: { html: string }[] } }, md: string) =>
  pipeline
    .render(md)
    .blocks.map((b) => b.html)
    .join('');

describe('graphviz fence rule', () => {
  for (const [name, make] of [
    ['GFM', () => createGfmPipeline()],
    ['Obsidian', () => createObsidianPipeline()],
    ['Pandoc', () => createPandocPipeline()],
    ['Quarto', () => createQuartoPipeline()],
  ] as const) {
    for (const lang of ['dot', 'graphviz']) {
      it(`${name}: a ${lang} fence is a placeholder with the escaped source and a key`, () => {
        const doc = new DOMParser().parseFromString(
          htmlOf(make(), `\`\`\`${lang}\n${source}\`\`\`\n`),
          'text/html',
        );
        const div = doc.querySelector('div.graphviz-diagram');
        expect(div?.getAttribute('data-diagram-key')).toBe(hashString(source));
        expect(div?.querySelector('pre.graphviz-source')?.textContent).toBe(source);
        expect(div?.querySelector('b')).toBeNull();
        expect(doc.querySelector('.code-card')).toBeNull();
      });
    }
  }

  it('Quarto takes the {dot} chunk, Pandoc takes {.dot}', () => {
    expect(htmlOf(createQuartoPipeline(), `\`\`\`{dot}\n${source}\`\`\`\n`)).toContain(
      'graphviz-diagram',
    );
    expect(htmlOf(createPandocPipeline(), `\`\`\`{.dot}\n${source}\`\`\`\n`)).toContain(
      'graphviz-diagram',
    );
  });

  it('sets features.graphviz only for a document with a dot or graphviz fence', () => {
    const gfm = (md: string) => createGfmPipeline().render(md).features;
    expect(gfm('```dot\ngraph {}\n```\n').graphviz).toBe(true);
    expect(gfm('```graphviz\ngraph {}\n```\n').graphviz).toBe(true);
    expect(gfm('```js\nx\n```\n').graphviz).toBeUndefined();
  });

  it('CommonMark leaves the fence a code block', () => {
    const html = htmlOf(createCommonMarkPipeline(), '```dot\ngraph {}\n```\n');
    expect(html).toContain('code-card');
    expect(html).not.toContain('graphviz-diagram');
  });
});
