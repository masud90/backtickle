/**
 * The MDX editor module: ESM, JSX blocks and expressions are parsed as JavaScript
 * (JSX) inside the Markdown tree, and the Insert commands change the document in one step.
 */
import { ensureSyntaxTree } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorController } from '@/editor/controller';
import { loadFlavorEditor } from '@/editor/flavors';

const mounted: EditorController[] = [];
afterEach(() => {
  for (const controller of mounted.splice(0)) controller.destroy();
  document.body.replaceChildren();
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function mount(doc: string, flavor: 'mdx' | 'gfm' = 'mdx') {
  const parent = document.createElement('div');
  document.body.append(parent);
  const controller = new EditorController({ parent, doc, flavor, onChange() {}, onCursor() {} });
  mounted.push(controller);
  await loadFlavorEditor(flavor);
  controller.setFlavor(flavor);
  await tick();
  return controller;
}

/** The names of the nodes of the syntax tree, in order, with the text of the ones named in `keep`. */
function nodes(controller: EditorController, keep: string[]): string[] {
  const state = controller.getState();
  const tree = ensureSyntaxTree(state, state.doc.length, 5000);
  const found: string[] = [];
  tree?.iterate({
    enter(node) {
      if (keep.includes(node.name))
        found.push(`${node.name}:${state.sliceDoc(node.from, node.to)}`);
    },
  });
  return found;
}

const DOC = [
  "import { Chart } from './chart'",
  "export const meta = { title: 'T' }",
  '',
  '# Heading',
  '',
  '<Callout type="info" count={3}>',
  '',
  'Text with **bold** and {1 + 1} inline.',
  '',
  '</Callout>',
  '',
  '<Tab label="A">Text A</Tab>',
  '',
].join('\n');

describe('MDX editor syntax', () => {
  it('has the three Insert commands and no completion sources', async () => {
    const editor = await loadFlavorEditor('mdx');
    expect(editor.inserts.map((insert) => insert.id)).toEqual([
      'mdx-import',
      'mdx-component',
      'mdx-expression',
    ]);
    expect(editor.completions ?? []).toEqual([]);
  });

  it('parses ESM lines to the next blank line as JavaScript', async () => {
    const controller = await mount(DOC);
    const esm = nodes(controller, ['MdxEsm']);
    expect(esm).toEqual([
      "MdxEsm:import { Chart } from './chart'\nexport const meta = { title: 'T' }",
    ]);
    const keywords = nodes(controller, ['import', 'export', 'const']);
    expect(keywords.length).toBeGreaterThanOrEqual(2);
    expect(nodes(controller, ['VariableDefinition'])).toContain('VariableDefinition:meta');
  });

  it('parses a JSX tag line as JSX and keeps the Markdown between the tags', async () => {
    const controller = await mount(DOC);
    expect(nodes(controller, ['MdxJsx'])).toEqual([
      'MdxJsx:<Callout type="info" count={3}>',
      'MdxJsx:</Callout>',
      'MdxJsx:<Tab label="A">Text A</Tab>',
    ]);
    expect(nodes(controller, ['JSXIdentifier'])).toContain('JSXIdentifier:Callout');
    expect(nodes(controller, ['StrongEmphasis'])).toEqual(['StrongEmphasis:**bold**']);
    expect(nodes(controller, ['ATXHeading1'])).toEqual(['ATXHeading1:# Heading']);
  });

  it('parses an expression inside a line as JavaScript', async () => {
    const controller = await mount(DOC);
    expect(nodes(controller, ['MdxExpression'])).toEqual(['MdxExpression:{1 + 1}']);
  });

  it('does not take import or export in the middle of a paragraph or a list for ESM', async () => {
    const controller = await mount('text\nimport nothing\n\n- import x\n');
    expect(nodes(controller, ['MdxEsm'])).toEqual([]);
  });

  it('leaves other flavors alone', async () => {
    const controller = await mount(DOC, 'gfm');
    expect(nodes(controller, ['MdxEsm', 'MdxJsx', 'MdxExpression'])).toEqual([]);
  });
});

describe('MDX inserts', () => {
  async function run(id: string, doc: string, select?: [number, number]) {
    const controller = await mount(doc);
    if (select) controller.view.dispatch({ selection: { anchor: select[0], head: select[1] } });
    else controller.view.dispatch({ selection: { anchor: doc.length } });
    expect(controller.runInsert(id)).toBe(true);
    return controller;
  }

  it('inserts an import line on its own, with the name selected', async () => {
    const controller = await run('mdx-import', 'text');
    expect(controller.getText()).toBe("text\n\nimport Name from './name.js'");
    const main = controller.view.state.selection.main;
    expect(controller.view.state.sliceDoc(main.from, main.to)).toBe('Name');
  });

  it('inserts a component with its name selected, or wraps the selection', async () => {
    const empty = await run('mdx-component', 'a ');
    expect(empty.getText()).toBe('a <Name></Name>');
    const main = empty.view.state.selection.main;
    expect(empty.view.state.sliceDoc(main.from, main.to)).toBe('Name');
    const wrapped = await run('mdx-component', 'a word b', [2, 6]);
    expect(wrapped.getText()).toBe('a <Name>word</Name> b');
  });

  it('inserts an expression with the caret inside, or wraps the selection', async () => {
    const empty = await run('mdx-expression', 'x ');
    expect(empty.getText()).toBe('x {}');
    expect(empty.view.state.selection.main.head).toBe(3);
    const wrapped = await run('mdx-expression', 'a b c', [2, 3]);
    expect(wrapped.getText()).toBe('a {b} c');
  });

  it('is one undo step', async () => {
    const controller = await run('mdx-component', 'a ');
    expect(controller.undo()).toBe(true);
    expect(controller.getText()).toBe('a ');
  });
});
