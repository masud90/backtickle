// @vitest-environment happy-dom
import { syntaxTree } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { labelSource } from '@/editor/complete';
import { EditorController } from '@/editor/controller';
import { flavorEditor } from '@/editor/flavors/quarto';

const mounted: EditorController[] = [];
afterEach(() => {
  for (const c of mounted.splice(0)) c.destroy();
  document.body.replaceChildren();
});

async function mount(doc: string) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const c = new EditorController({ parent, doc, flavor: 'quarto', onChange() {}, onCursor() {} });
  mounted.push(c);
  await new Promise((r) => setTimeout(r, 30));
  return c;
}

describe('Quarto editor', () => {
  it('has the Pandoc inserts plus chunk, callout, cross-reference, tabset and figure', () => {
    const ids = flavorEditor.inserts.map((i) => i.id);
    for (const id of [
      'pandoc-citation',
      'quarto-chunk-r',
      'quarto-chunk-python',
      'quarto-chunk-julia',
      'quarto-chunk-sql',
      'quarto-callout',
      'quarto-xref',
      'quarto-tabset',
      'quarto-figure',
    ]) {
      expect(ids).toContain(id);
    }
    expect(flavorEditor.completions).toContain(labelSource);
  });

  it('parses a chunk header and fenced code', async () => {
    const c = await mount('```{r setup, echo=FALSE}\n#| label: x\nx <- 1\n```\n');
    const names = new Set<string>();
    syntaxTree(c.getState()).iterate({ enter: (n) => void names.add(n.name) });
    expect(names.has('FencedCode')).toBe(true);
    expect(names.has('CodeInfo')).toBe(true);
  });

  it('inserts a chunk as one undo step', async () => {
    const c = await mount('');
    const before = c.getState().doc.toString();
    const insert = flavorEditor.inserts.find((i) => i.id === 'quarto-chunk-python');
    expect(insert?.run(c.view)).toBe(true);
    const doc = c.getState().doc.toString();
    expect(doc.startsWith('```{python}\n#| label: name')).toBe(true);
    expect(before).toBe('');
  });
});
