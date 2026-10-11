import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type CompletionData,
  citationSource,
  completionDataField,
  getCompletionData,
  labelSource,
  noteSource,
  setCompletionDataEffect,
} from '@/editor/complete';
import { EditorController } from '@/editor/controller';
import { type FlavorEditor, loadFlavorEditor, overrideFlavorEditor } from '@/editor/flavors';
import { insertBlock, insertInline, wrapSelection } from '@/editor/inserts';
import { parseMarked, renderMarked } from './editor-helpers';

const mounted: EditorController[] = [];
afterEach(() => {
  for (const controller of mounted.splice(0)) controller.destroy();
  document.body.replaceChildren();
  for (const flavor of ['gfm', 'commonmark'] as const) overrideFlavorEditor(flavor, null);
});

function mount(doc = '', flavor: 'gfm' | 'commonmark' | 'pandoc' = 'gfm') {
  const parent = document.createElement('div');
  document.body.append(parent);
  const controller = new EditorController({ parent, doc, flavor, onChange() {}, onCursor() {} });
  mounted.push(controller);
  return controller;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('flavor editor modules', () => {
  it('loads one module per flavor, empty for now', async () => {
    // Every other flavor has its own module now (pandoc-editor, quarto-editor, editor-mdx and
    // obsidian-editor tests).
    for (const flavor of ['commonmark', 'gfm'] as const) {
      const editor = await loadFlavorEditor(flavor);
      expect(editor.inserts).toEqual([]);
      expect(editor.completions ?? []).toEqual([]);
    }
  });

  it('puts the flavor syntax into the state and keeps the undo history on a switch', async () => {
    const marker = EditorState.languageData.of(() => [{ wdTest: true }]);
    overrideFlavorEditor('commonmark', { syntax: marker, inserts: [] });
    const controller = mount('text', 'gfm');
    controller.view.dispatch({ changes: { from: 4, insert: ' more' } });
    controller.setFlavor('commonmark');
    await tick();
    expect(controller.getState().languageDataAt('wdTest', 0)).toEqual([true]);
    expect(controller.getText()).toBe('text more');
    expect(controller.undo()).toBe(true);
    expect(controller.getText()).toBe('text');
    controller.setFlavor('gfm');
    await tick();
    expect(controller.getState().languageDataAt('wdTest', 0)).toEqual([]);
  });

  it('reports the Insert commands of the flavor on show and runs them', async () => {
    const editor: FlavorEditor = {
      syntax: [],
      inserts: [
        { id: 'x', label: 'X', icon: 'add-box', run: (view) => wrapSelection(view, '<', '>', 'x') },
      ],
    };
    overrideFlavorEditor('commonmark', editor);
    const controller = mount('', 'gfm');
    const seen: string[][] = [];
    controller.onInserts((inserts) => seen.push(inserts.map((entry) => entry.id)));
    expect(controller.inserts).toEqual([]);
    controller.setFlavor('commonmark');
    await tick();
    expect(controller.inserts.map((entry) => entry.id)).toEqual(['x']);
    expect(seen.at(-1)).toEqual(['x']);
    expect(controller.runInsert('x')).toBe(true);
    expect(controller.getText()).toBe('<x>');
    controller.setReadOnly(true);
    expect(controller.runInsert('x')).toBe(false);
    controller.setFlavor('gfm');
    expect(controller.inserts).toEqual([]);
  });

  it('keeps completion data with the document state', () => {
    const controller = mount('a');
    controller.setCompletionData({ citations: [{ key: 'k', label: 'L' }] });
    const state = controller.getState();
    expect(getCompletionData(state).citations?.[0]?.key).toBe('k');
    const other = EditorController.createState('b');
    expect(getCompletionData(other)).toEqual({});
  });
});

function complete(
  marked: string,
  data: CompletionData,
  source: typeof citationSource,
  explicit = false,
): CompletionResult | null {
  const { text, head } = parseMarked(marked);
  let state = EditorState.create({ doc: text, extensions: [completionDataField] });
  state = state.update({ effects: setCompletionDataEffect(data) }).state;
  const result = source(new CompletionContext(state, head, explicit));
  return result as CompletionResult | null;
}

describe('citationSource', () => {
  const data: CompletionData = {
    citations: [
      { key: 'smith2020', label: 'Smith 2020', detail: 'A title' },
      { key: 'doe19', label: 'Doe 2019' },
    ],
  };

  it('offers keys after @ in text and after [', () => {
    for (const text of ['See @‸', 'See [@‸', 'See [-@sm‸', 'See [@doe19; @‸']) {
      const result = complete(text, data, citationSource);
      expect(result?.options.map((option) => option.label)).toEqual(['smith2020', 'doe19']);
    }
    const result = complete('See [@sm‸', data, citationSource);
    expect(result?.from).toBe('See [@'.length);
    expect(result?.options[0]?.detail).toBe('Smith 2020');
    expect(result?.options[0]?.info).toBe('A title');
  });

  it('stays quiet for e-mail addresses, plain text and an empty bibliography', () => {
    expect(complete('mail me@‸', data, citationSource)).toBeNull();
    expect(complete('See ‸', data, citationSource)).toBeNull();
    expect(complete('See @‸', {}, citationSource)).toBeNull();
  });
});

describe('labelSource', () => {
  const data: CompletionData = {
    labels: [{ key: 'fig-plot' }, { key: 'tbl-main', label: 'Main' }],
  };

  it('offers labels after @fig-, @tbl-, @sec- and @eq-', () => {
    const result = complete('see @fig-‸', data, labelSource);
    expect(result?.options.map((option) => option.label)).toEqual(['fig-plot', 'tbl-main']);
    expect(result?.from).toBe('see @'.length);
    expect(complete('see @sec-a‸', data, labelSource)).not.toBeNull();
    expect(complete('see @eq-‸', data, labelSource)).not.toBeNull();
  });

  it('ignores other keys and e-mail addresses', () => {
    expect(complete('see @smith‸', data, labelSource)).toBeNull();
    expect(complete('me@fig-‸', data, labelSource)).toBeNull();
  });
});

describe('noteSource', () => {
  const data: CompletionData = {
    notes: [
      { name: 'Alpha', path: 'Alpha.md' },
      { name: 'Beta', path: 'a/Beta.md' },
      { name: 'Beta', path: 'b/Beta.md' },
    ],
  };

  it('offers note names after [[ and ![[, with the path for repeated names', () => {
    for (const text of ['[[‸', '![[‸', 'x [[Al‸']) {
      const result = complete(text, data, noteSource);
      expect(result?.options.map((option) => option.label)).toEqual(['Alpha', 'Beta', 'Beta']);
      expect(result?.options.map((option) => option.detail)).toEqual([
        undefined,
        'a/Beta.md',
        'b/Beta.md',
      ]);
    }
    expect(complete('x [[Al‸', data, noteSource)?.from).toBe('x [['.length);
    expect(complete('![[‸', data, noteSource)?.from).toBe(3);
  });

  it('stays quiet outside a link, after a pipe and for an empty vault', () => {
    expect(complete('[Al‸', data, noteSource)).toBeNull();
    expect(complete('[[Alpha|‸', data, noteSource)).toBeNull();
    expect(complete('[[‸', {}, noteSource)).toBeNull();
  });

  it('applies the name and closes the link once', () => {
    const controller = mount('[[Al');
    controller.setCompletionData(data);
    controller.view.dispatch({ selection: { anchor: 4 } });
    const option = noteSource(
      new CompletionContext(controller.getState(), 4, false),
    ) as CompletionResult;
    const apply = option.options[0]?.apply;
    expect(typeof apply).toBe('function');
    (apply as (...args: unknown[]) => void)(controller.view, option.options[0], 2, 4);
    expect(controller.getText()).toBe('[[Alpha]]');
    expect(controller.getState().selection.main.head).toBe(9);

    const closed = mount('[[Al]]');
    closed.setCompletionData(data);
    (apply as (...args: unknown[]) => void)(closed.view, option.options[0], 2, 4);
    expect(closed.getText()).toBe('[[Alpha]]');
    expect(closed.getState().selection.main.head).toBe(9);
  });
});

describe('insert helpers', () => {
  function run(marked: string, fn: (view: EditorController['view']) => boolean) {
    const { text, anchor, head } = parseMarked(marked);
    const controller = mount(text);
    controller.view.dispatch({ selection: { anchor, head } });
    const ok = fn(controller.view);
    return { ok, out: renderMarked(controller.getState()), controller };
  }

  it('wraps a selection and keeps it selected', () => {
    expect(run('a «b» c', (v) => wrapSelection(v, '^[', ']')).out).toBe('a ^[«b»] c');
  });

  it('puts the placeholder between the marks at a caret', () => {
    expect(run('a ‸', (v) => wrapSelection(v, '[[', ']]', 'note')).out).toBe('a [[«note»]]');
    expect(run('a ‸', (v) => wrapSelection(v, '[@', ']')).out).toBe('a [@‸]');
  });

  it('is one undo step and does nothing when read-only', () => {
    const { controller } = run('a «b» c', (v) => wrapSelection(v, '<', '>'));
    expect(controller.getText()).toBe('a <b> c');
    controller.undo();
    expect(controller.getText()).toBe('a b c');
    controller.setReadOnly(true);
    expect(wrapSelection(controller.view, '<', '>')).toBe(false);
    expect(insertBlock(controller.view, 'x')).toBe(false);
    expect(insertInline(controller.view, 'x')).toBe(false);
  });

  it('inserts a block after a line with text, set off by blank lines', () => {
    expect(
      run('para‸\nnext', (v) => insertBlock(v, '::: {.note}\n:::', { from: 5, to: 10 })).out,
    ).toBe('para\n\n::: {«.note»}\n:::\n\nnext');
  });

  it('replaces a blank line and avoids extra blank lines', () => {
    expect(run('a\n\n‸\n\nb', (v) => insertBlock(v, '---')).out).toBe('a\n\n---‸\n\nb');
    expect(run('a\n‸', (v) => insertBlock(v, '---')).out).toBe('a\n\n---‸');
  });

  it('inserts inline text and selects a part of it', () => {
    expect(run('a ‸ b', (v) => insertInline(v, '{x}', { from: 1, to: 2 })).out).toBe('a {«x»} b');
  });
});
