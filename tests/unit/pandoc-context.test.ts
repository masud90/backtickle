// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createPandocPipeline } from '@/preview/packs/pandoc';
import { pandocUnsafeSplit } from '@/preview/rules/pandoc/windows';
import { NO_INPUTS, pipeline } from './pandoc-helpers';

describe('needs and prepare', () => {
  it('needs lists the bibliography hrefs, string or list', () => {
    const p = pipeline();
    expect(p.needs?.('---\nbibliography: refs.bib\n---\ntext').bibliographies).toEqual([
      'refs.bib',
    ]);
    expect(p.needs?.('---\nbibliography:\n  - a.bib\n  - b.json\n---\n').bibliographies).toEqual([
      'a.bib',
      'b.json',
    ]);
    expect(p.needs?.('no yaml').bibliographies).toEqual([]);
  });

  it('prepare numbers example items and collects abbreviations and the title block', () => {
    const src = '% T\n\n(@a) one\n\n(@b) two\n\n*[HTML]: Hyper\n';
    const context = pipeline().prepare?.(src, NO_INPUTS);
    expect(context?.labels.get('ex:b')?.number).toBe('2');
    expect(context?.metadata.title).toBe('T');
    expect(context?.metadata['wd:abbreviations']).toEqual({ HTML: 'Hyper' });
  });

  it('the signature changes when the numbering changes', () => {
    const p = pipeline();
    const a = p.prepare?.('(@) x\n', NO_INPUTS)?.signature;
    const b = p.prepare?.('(@) x\n\n(@) y\n', NO_INPUTS)?.signature;
    expect(a).not.toBe(b);
  });
});

describe('unsafeSplit', () => {
  const lines = (text: string) => text.split('\n');
  it('never cuts inside a fenced div', () => {
    const l = lines('a\n\n::: {.x}\np\n\nq\n:::\n\nafter');
    expect(pandocUnsafeSplit(l, 5)).toBe(true);
    expect(pandocUnsafeSplit(l, 8)).toBe(false);
  });
  it('never cuts before a definition term or marker', () => {
    const l = lines('Term\n: d\n\nTerm2\n: e\n\nplain');
    expect(pandocUnsafeSplit(l, 3)).toBe(true);
    expect(pandocUnsafeSplit(l, 6)).toBe(false);
  });
  it('never cuts inside a CriticMarkup span', () => {
    const l = lines('x {++a\n\nb++} y\n\nz');
    expect(pandocUnsafeSplit(l, 2)).toBe(true);
    expect(pandocUnsafeSplit(l, 4)).toBe(false);
  });

  it('a windowed render equals a whole render', () => {
    let doc = '';
    for (let i = 0; i < 60; i++) {
      doc += `## Heading ${i % 5}\n\n::: {.box}\npara ${i}\n\nmore\n:::\n\nTerm ${i}\n: def ${i}\n\n(@) ex ${i}\n\n`;
    }
    const whole = createPandocPipeline({ windowMinChars: 1e9 });
    const windowed = createPandocPipeline({ windowMinChars: 200, windowChars: 100 });
    const ctx = whole.prepare?.(doc, NO_INPUTS);
    const a = whole.render(doc, ctx);
    const b = windowed.render(doc, ctx);
    expect(b.blocks.map((x) => x.html)).toEqual(a.blocks.map((x) => x.html));
    expect(b.headings.map((h) => h.id)).toEqual(a.headings.map((h) => h.id));
  });
});
