import { syntaxTree } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { citationSource } from '@/editor/complete';
import { EditorController } from '@/editor/controller';
import { flavorEditor } from '@/editor/flavors/pandoc';

const mounted: EditorController[] = [];
afterEach(() => {
  for (const c of mounted.splice(0)) c.destroy();
  document.body.replaceChildren();
});

async function mount(doc: string, from = 0, to = from) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const c = new EditorController({ parent, doc, flavor: 'pandoc', onChange() {}, onCursor() {} });
  mounted.push(c);
  await new Promise((r) => setTimeout(r, 20));
  c.view.dispatch({ selection: { anchor: from, head: to } });
  return c;
}

function nodes(c: EditorController): string[] {
  const names: string[] = [];
  syntaxTree(c.getState()).iterate({ enter: (n) => void names.push(n.name) });
  return names;
}

describe('Pandoc editor syntax', () => {
  it('parses div markers, attributes, citations, footnote marks and CriticMarkup', async () => {
    const c = await mount(
      '::: {.note}\nSee [@smith2020] and ^[a note] {++add++} {>>c<<} {#id .x}\n:::\n',
    );
    const found = new Set(nodes(c));
    for (const name of [
      'DivMarker',
      'Attributes',
      'Citation',
      'FootnoteMark',
      'CriticAdd',
      'CriticComment',
    ]) {
      expect(found.has(name), name).toBe(true);
    }
  });
});

describe('Pandoc inserts', () => {
  const run = async (id: string, doc: string, from: number, to: number) => {
    const c = await mount(doc, from, to);
    const insert = flavorEditor.inserts.find((i) => i.id === id);
    expect(insert?.run(c.view)).toBe(true);
    return c.getText();
  };
  it('has the six inserts', () => {
    expect(flavorEditor.inserts.map((i) => i.label)).toEqual([
      'Citation',
      'Footnote',
      'Fenced div',
      'Definition list',
      'Superscript',
      'Subscript',
    ]);
  });
  it('citation, footnote, super and subscript wrap the selection', async () => {
    expect(await run('pandoc-citation', 'abc', 0, 3)).toBe('[@abc]');
    expect(await run('pandoc-footnote', 'abc', 0, 3)).toBe('^[abc]');
    expect(await run('pandoc-superscript', 'x2', 1, 2)).toBe('x^2^');
    expect(await run('pandoc-subscript', 'H2O', 1, 2)).toBe('H~2~O');
  });
  it('fenced div and definition list are blocks', async () => {
    expect(await run('pandoc-div', '', 0, 0)).toBe('::: {.class}\nContent\n:::');
    expect(await run('pandoc-deflist', 'Para', 4, 4)).toBe('Para\n\nTerm\n: Definition');
  });
  it('attaches the citation completion', () => {
    expect(flavorEditor.completions).toContain(citationSource);
  });
});
