import { indentUnit, syntaxTree } from '@codemirror/language';
import { searchPanelOpen } from '@codemirror/search';
import { EditorSelection, type EditorState } from '@codemirror/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type CursorPosition,
  EditorController,
  type EditorSelectionInfo,
  type FlavorId,
} from '@/editor/controller';
import { REPLACE_MODE_CLASS } from '@/editor/find';
import { loadFlavorEditor } from '@/editor/flavors';

const mounted: EditorController[] = [];

afterEach(() => {
  for (const controller of mounted.splice(0)) controller.destroy();
  document.body.replaceChildren();
});

function mount(doc = '', flavor?: FlavorId) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const changes = vi.fn();
  const cursors: CursorPosition[] = [];
  const controller = new EditorController({
    parent,
    doc,
    flavor,
    onChange: changes,
    onCursor: (position) => cursors.push(position),
  });
  mounted.push(controller);
  return { controller, parent, changes, cursors };
}

/** Types at the end of the document the way the input handler does. */
function typeAtEnd(controller: EditorController, text: string) {
  const end = controller.getState().doc.length;
  controller.view.dispatch({
    changes: { from: end, insert: text },
    selection: { anchor: end + text.length },
    userEvent: 'input.type',
  });
}

function hasNode(state: EditorState, name: string): boolean {
  let found = false;
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === name) found = true;
    },
  });
  return found;
}

describe('the controller keeps its Phase 0 behavior', () => {
  it('shows the document and reports edits and cursor moves', () => {
    const { controller, changes, cursors } = mount('hello');
    expect(controller.getText()).toBe('hello');

    typeAtEnd(controller, ' world');

    expect(controller.getText()).toBe('hello world');
    expect(changes).toHaveBeenCalledTimes(1);
    expect(cursors.at(-1)).toEqual({ line: 1, column: 12 });
  });

  it('undo and redo work', () => {
    const { controller } = mount('a');
    typeAtEnd(controller, 'b');
    expect(controller.undo()).toBe(true);
    expect(controller.getText()).toBe('a');
    expect(controller.redo()).toBe(true);
    expect(controller.getText()).toBe('ab');
  });

  it('setText replaces the document and forgets the undo history', () => {
    const { controller, changes, cursors } = mount('a');
    typeAtEnd(controller, 'b');
    changes.mockClear();

    controller.setText('fresh');

    expect(controller.getText()).toBe('fresh');
    expect(controller.undo()).toBe(false);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(cursors.at(-1)).toEqual({ line: 1, column: 1 });
  });

  it('getText gives the same string until the document changes', () => {
    const { controller } = mount('a');
    expect(controller.getText()).toBe(controller.getText());
    typeAtEnd(controller, 'b');
    expect(controller.getText()).toBe('ab');
  });

  it('typeAtMiddleLine adds up on one line, like real typing', () => {
    const { controller } = mount('one\ntwo\nthree');
    controller.typeAtMiddleLine('x');
    controller.typeAtMiddleLine('y');
    expect(controller.getText()).toBe('one\ntwoxy\nthree');
  });
});

describe('states per document', () => {
  it('swaps documents and keeps the undo history of each', () => {
    const { controller } = mount('one');
    typeAtEnd(controller, ' typed');
    const first = controller.getState();

    controller.setState(EditorController.createState('second'));
    expect(controller.getText()).toBe('second');
    typeAtEnd(controller, '!');
    const second = controller.getState();

    controller.setState(first);
    expect(controller.getText()).toBe('one typed');
    expect(controller.undo()).toBe(true);
    expect(controller.getText()).toBe('one');
    expect(controller.undo()).toBe(false);

    controller.setState(second);
    expect(controller.getText()).toBe('second!');
    expect(controller.undo()).toBe(true);
    expect(controller.getText()).toBe('second');
  });

  it('redo history comes back with the state too', () => {
    const { controller } = mount('a');
    typeAtEnd(controller, 'b');
    controller.undo();
    const first = controller.getState();

    controller.setState(EditorController.createState('other'));
    controller.setState(first);

    expect(controller.redo()).toBe(true);
    expect(controller.getText()).toBe('ab');
  });

  it('keeps the selection of each state', () => {
    const { controller } = mount('line one\nline two');
    controller.view.dispatch({ selection: EditorSelection.single(2, 6) });
    const first = controller.getState();

    controller.setState(EditorController.createState('other doc'));
    expect(controller.getSelectionInfo()).toEqual({ line: 0, column: 0, selectedText: null });

    controller.setState(first);
    expect(controller.getSelectionInfo()).toEqual({ line: 0, column: 6, selectedText: 'ne o' });
  });

  it('a fresh state has no undo history', () => {
    const { controller } = mount('a');
    typeAtEnd(controller, 'b');
    controller.setState(EditorController.createState('new'));
    expect(controller.undo()).toBe(false);
  });

  it('createState gives each state its own flavor and the same extensions as the controller', () => {
    const state = EditorController.createState('~~x~~', 'commonmark');
    const { controller } = mount('');
    controller.setState(state);
    expect(controller.flavor).toBe('commonmark');
    expect(controller.getText()).toBe('~~x~~');
  });

  it('reports a swap to the change, cursor and selection callbacks', () => {
    const { controller, changes, cursors } = mount('a');
    const selections: EditorSelectionInfo[] = [];
    controller.onSelection((info) => selections.push(info));
    changes.mockClear();

    controller.setState(EditorController.createState('x\ny'));

    expect(changes).toHaveBeenCalledTimes(1);
    expect(cursors.at(-1)).toEqual({ line: 1, column: 1 });
    expect(selections).toEqual([{ line: 0, column: 0, selectedText: null }]);
  });

  it('setting the state that is already showing does nothing', () => {
    const { controller, changes } = mount('a');
    changes.mockClear();
    controller.setState(controller.getState());
    expect(changes).not.toHaveBeenCalled();
  });

  it('does not create a second view: the one view shows every state', () => {
    const { controller, parent } = mount('a');
    const view = controller.view;
    controller.setState(EditorController.createState('b'));
    controller.setState(EditorController.createState('c'));
    expect(controller.view).toBe(view);
    expect(parent.querySelectorAll('.cm-editor')).toHaveLength(1);
  });
});

describe('flavors', () => {
  it('parses GFM by default', () => {
    const { controller } = mount('~~x~~\n\n- [ ] a\n');
    expect(controller.flavor).toBe('gfm');
    expect(hasNode(controller.getState(), 'Strikethrough')).toBe(true);
    expect(hasNode(controller.getState(), 'TaskMarker')).toBe(true);
  });

  it('parses plain CommonMark for the CommonMark flavor', () => {
    const { controller } = mount('~~x~~\n\n- [ ] a\n', 'commonmark');
    expect(controller.flavor).toBe('commonmark');
    expect(hasNode(controller.getState(), 'Strikethrough')).toBe(false);
    expect(hasNode(controller.getState(), 'TaskMarker')).toBe(false);
  });

  it.each(['obsidian', 'pandoc', 'quarto', 'mdx'] as const)(
    'parses %s on top of GFM and remembers the flavor',
    async (flavor) => {
      const { controller } = mount('~~x~~', flavor);
      expect(controller.flavor).toBe(flavor);
      expect(hasNode(controller.getState(), 'Strikethrough')).toBe(true);
      // The flavor's editor module loads lazily: let it arrive before the test ends, so it never
      // resolves after the test environment is gone.
      await loadFlavorEditor(flavor);
    },
  );

  it('switching flavor keeps the document, the selection and the undo history', () => {
    const { controller } = mount('~~x~~ text');
    typeAtEnd(controller, '!');
    controller.view.dispatch({ selection: EditorSelection.single(2, 3) });

    controller.setFlavor('commonmark');

    expect(controller.flavor).toBe('commonmark');
    expect(controller.getText()).toBe('~~x~~ text!');
    expect(controller.getSelectionInfo().selectedText).toBe('x');
    expect(hasNode(controller.getState(), 'Strikethrough')).toBe(false);
    expect(controller.undo()).toBe(true);
    expect(controller.getText()).toBe('~~x~~ text');

    controller.setFlavor('gfm');
    expect(hasNode(controller.getState(), 'Strikethrough')).toBe(true);
    expect(controller.getText()).toBe('~~x~~ text');
  });

  it('switching to the same flavor does nothing', () => {
    const { controller } = mount('a');
    const before = controller.getState();
    controller.setFlavor('gfm');
    expect(controller.getState()).toBe(before);
  });

  it('a state keeps its flavor when it is swapped out and back in', () => {
    const { controller } = mount('a', 'commonmark');
    const commonmark = controller.getState();
    controller.setState(EditorController.createState('b', 'obsidian'));
    expect(controller.flavor).toBe('obsidian');
    controller.setState(commonmark);
    expect(controller.flavor).toBe('commonmark');
  });

  it('list continuation works in both parsers', () => {
    for (const flavor of ['gfm', 'commonmark'] as const) {
      const { controller } = mount('- item', flavor);
      controller.view.dispatch({ selection: { anchor: 6 } });
      const handled = enter(controller);
      expect(handled, flavor).toBe(true);
      expect(controller.getText(), flavor).toBe('- item\n- ');
    }
  });
});

/** Runs the Enter binding of the editor (the Markdown list continuation comes first). */
function enter(controller: EditorController): boolean {
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    keyCode: 13,
    bubbles: true,
    cancelable: true,
  });
  controller.view.contentDOM.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('formatting through the controller', () => {
  it('run applies a command, focuses the editor and is one undo step', () => {
    const { controller } = mount('say hello now');
    // happy-dom fires selectionchange synchronously, inside a CodeMirror update, once the editor
    // has focus; the focus call itself is what matters here (real focus is covered in WebKit).
    const focus = vi.spyOn(controller.view, 'focus').mockImplementation(() => {});
    controller.view.dispatch({ selection: EditorSelection.single(4, 9) });

    expect(controller.run('bold')).toBe(true);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(controller.getText()).toBe('say **hello** now');
    expect(controller.getSelectionInfo().selectedText).toBe('hello');

    expect(controller.undo()).toBe(true);
    expect(controller.getText()).toBe('say hello now');
  });

  it('run returns false when the command has nothing to do', () => {
    const { controller } = mount('plain');
    expect(controller.run('paragraph')).toBe(false);
    expect(controller.run('heading-1')).toBe(true);
    expect(controller.run('heading-1')).toBe(false);
  });

  it('run returns false for a name that is not a command', () => {
    const { controller } = mount('x');
    expect(controller.run('nothing' as never)).toBe(false);
    expect(controller.getText()).toBe('x');
  });

  it('toggleTaskAtLine checks the box once per call and is undoable', () => {
    const { controller } = mount('- [ ] a\n- [ ] b');
    expect(controller.toggleTaskAtLine(1)).toBe(true);
    expect(controller.getText()).toBe('- [ ] a\n- [x] b');
    expect(controller.toggleTaskAtLine(1)).toBe(true);
    expect(controller.getText()).toBe('- [ ] a\n- [ ] b');
    controller.undo();
    expect(controller.getText()).toBe('- [ ] a\n- [x] b');
  });

  it('toggleTaskAtLine returns false and changes nothing for a line without a task', () => {
    const { controller, changes } = mount('- [ ] a\nplain');
    changes.mockClear();
    expect(controller.toggleTaskAtLine(1)).toBe(false);
    expect(controller.toggleTaskAtLine(5)).toBe(false);
    expect(controller.getText()).toBe('- [ ] a\nplain');
    expect(changes).not.toHaveBeenCalled();
  });

  it('toggleTaskAtLine leaves the selection alone', () => {
    const { controller } = mount('- [ ] a\nsecond line');
    controller.view.dispatch({ selection: EditorSelection.single(10, 13) });
    controller.toggleTaskAtLine(0);
    expect(controller.getSelectionInfo()).toEqual({ line: 1, column: 5, selectedText: 'con' });
  });

  it('a read-only editor refuses commands and task toggles', () => {
    const { controller } = mount('say hello\n- [ ] a');
    controller.view.dispatch({ selection: EditorSelection.single(4, 9) });
    controller.setReadOnly(true);

    expect(controller.getState().readOnly).toBe(true);
    expect(controller.run('bold')).toBe(false);
    expect(controller.toggleTaskAtLine(1)).toBe(false);
    expect(controller.getText()).toBe('say hello\n- [ ] a');

    controller.setReadOnly(false);
    expect(controller.run('bold')).toBe(true);
  });

  it('read-only belongs to the state: another document is editable', () => {
    const { controller } = mount('a');
    controller.setReadOnly(true);
    const locked = controller.getState();

    controller.setState(EditorController.createState('b'));
    expect(controller.getState().readOnly).toBe(false);

    controller.setState(locked);
    expect(controller.getState().readOnly).toBe(true);
  });
});

describe('selection reports', () => {
  it('gives the 0-based line and column of the caret and null for the selected text', () => {
    const { controller } = mount('one\ntwo three');
    const seen: EditorSelectionInfo[] = [];
    controller.onSelection((info) => seen.push(info));

    controller.view.dispatch({ selection: { anchor: 8 } });

    expect(seen).toEqual([{ line: 1, column: 4, selectedText: null }]);
  });

  it('gives the selected text of a selection', () => {
    const { controller } = mount('one\ntwo three');
    const seen: EditorSelectionInfo[] = [];
    controller.onSelection((info) => seen.push(info));

    controller.view.dispatch({ selection: EditorSelection.single(4, 7) });

    expect(seen.at(-1)).toEqual({ line: 1, column: 3, selectedText: 'two' });
    expect(controller.getSelectionInfo()).toEqual({ line: 1, column: 3, selectedText: 'two' });
  });

  it('reports typing, because it moves the caret', () => {
    const { controller } = mount('a');
    const seen: EditorSelectionInfo[] = [];
    controller.onSelection((info) => seen.push(info));
    typeAtEnd(controller, 'bc');
    expect(seen.at(-1)).toEqual({ line: 0, column: 3, selectedText: null });
  });

  it('stops reporting after the handler is removed', () => {
    const { controller } = mount('abc');
    const handler = vi.fn();
    const stop = controller.onSelection(handler);
    stop();
    controller.view.dispatch({ selection: { anchor: 2 } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not report when only the scroll or the flavor changed', () => {
    const { controller } = mount('abc');
    const handler = vi.fn();
    controller.onSelection(handler);
    controller.setFlavor('commonmark');
    controller.setSoftWrap(false);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('settings that apply to every document', () => {
  it('tab size: 2 spaces by default, changed by the setter, kept across documents', () => {
    const { controller } = mount('a');
    expect(controller.getState().tabSize).toBe(2);
    expect(controller.getState().facet(indentUnit)).toBe('  ');

    controller.setTabSize(4);
    expect(controller.getState().tabSize).toBe(4);
    expect(controller.getState().facet(indentUnit)).toBe('    ');

    const fresh = EditorController.createState('other');
    expect(fresh.tabSize).toBe(2);
    controller.setState(fresh);
    expect(controller.getState().tabSize).toBe(4);
    expect(controller.getState().facet(indentUnit)).toBe('    ');
  });

  it('tab size stays within 1 to 8', () => {
    const { controller } = mount('a');
    controller.setTabSize(0);
    expect(controller.getState().tabSize).toBe(1);
    controller.setTabSize(99);
    expect(controller.getState().tabSize).toBe(8);
    controller.setTabSize(3.4);
    expect(controller.getState().tabSize).toBe(3);
  });

  it('a state saved before a setting changed picks the setting up when it comes back', () => {
    const { controller } = mount('a');
    const saved = controller.getState();
    controller.setState(EditorController.createState('b'));
    controller.setTabSize(6);
    controller.setSoftWrap(false);
    controller.setState(saved);
    expect(controller.getState().tabSize).toBe(6);
    expect(controller.view.contentDOM.classList.contains('cm-lineWrapping')).toBe(false);
  });

  it('soft wrap is on by default and can be switched off and on', () => {
    const { controller } = mount('a');
    const content = controller.view.contentDOM;
    expect(content.classList.contains('cm-lineWrapping')).toBe(true);
    controller.setSoftWrap(false);
    expect(content.classList.contains('cm-lineWrapping')).toBe(false);
    controller.setSoftWrap(true);
    expect(content.classList.contains('cm-lineWrapping')).toBe(true);
  });

  it('line numbers are on by default and can be switched off and on', () => {
    const { controller, parent } = mount('a');
    expect(parent.querySelector('.cm-lineNumbers')).not.toBeNull();
    controller.setLineNumbers(false);
    expect(parent.querySelector('.cm-lineNumbers')).toBeNull();
    controller.setLineNumbers(true);
    expect(parent.querySelector('.cm-lineNumbers')).not.toBeNull();
  });

  it('spell check is on by default and can be switched off and on', () => {
    const { controller } = mount('a');
    const content = controller.view.contentDOM;
    expect(content.getAttribute('spellcheck')).toBe('true');
    controller.setSpellcheck(false);
    expect(content.getAttribute('spellcheck')).toBe('false');
    controller.setSpellcheck(true);
    expect(content.getAttribute('spellcheck')).toBe('true');
  });

  it('labels the editor for assistive technology', () => {
    const { controller } = mount('a');
    expect(controller.view.contentDOM.getAttribute('aria-label')).toBe('Markdown source');
  });
});

describe('find', () => {
  it('openSearch opens the find bar without the replace row', () => {
    const { controller, parent } = mount('find me');
    controller.openSearch(false);
    expect(searchPanelOpen(controller.getState())).toBe(true);
    const panel = parent.querySelector('.cm-search');
    expect(panel).not.toBeNull();
    expect(panel?.classList.contains(REPLACE_MODE_CLASS)).toBe(false);
  });

  it('openSearch(true) shows the replace row and focuses the replace field', () => {
    const { controller, parent } = mount('find me');
    controller.openSearch(true);
    const panel = parent.querySelector('.cm-search');
    expect(panel?.classList.contains(REPLACE_MODE_CLASS)).toBe(true);
    expect(document.activeElement?.getAttribute('name')).toBe('replace');
  });

  it('switches between find and find and replace while the bar is open', () => {
    const { controller, parent } = mount('find me');
    controller.openSearch(true);
    controller.openSearch(false);
    expect(parent.querySelector('.cm-search')?.classList.contains(REPLACE_MODE_CLASS)).toBe(false);
    expect(document.activeElement?.getAttribute('name')).toBe('search');
  });

  it('a read-only editor opens plain find, which has no replace row', () => {
    const { controller, parent } = mount('find me');
    controller.setReadOnly(true);
    controller.openSearch(true);
    expect(parent.querySelector('.cm-search')?.classList.contains(REPLACE_MODE_CLASS)).toBe(false);
    expect(parent.querySelector('input[name=replace]')).toBeNull();
  });

  it('findNext and findPrevious move the selection through the matches, wrapping around', () => {
    const { controller, parent } = mount('one two one two one');
    controller.openSearch(false);
    const field = parent.querySelector<HTMLInputElement>('input[name=search]');
    if (!field) throw new Error('no search field');
    field.value = 'one';
    field.dispatchEvent(new Event('change'));

    const found = () => {
      const { from, to } = controller.getState().selection.main;
      return [from, to];
    };
    controller.findNext();
    expect(found()).toEqual([0, 3]);
    controller.findNext();
    expect(found()).toEqual([8, 11]);
    controller.findNext();
    expect(found()).toEqual([16, 19]);
    controller.findNext();
    expect(found()).toEqual([0, 3]);
    controller.findPrevious();
    expect(found()).toEqual([16, 19]);
    controller.findPrevious();
    expect(found()).toEqual([8, 11]);
  });

  it('findNext with no search yet opens the find bar', () => {
    const { controller } = mount('abc');
    controller.findNext();
    expect(searchPanelOpen(controller.getState())).toBe(true);
  });

  it('closing the bar leaves the search in place for findNext', () => {
    const { controller, parent } = mount('a b a b');
    vi.spyOn(controller.view, 'focus').mockImplementation(() => {});
    controller.openSearch(false);
    const field = parent.querySelector<HTMLInputElement>('input[name=search]');
    if (!field) throw new Error('no search field');
    field.value = 'b';
    field.dispatchEvent(new Event('change'));

    parent.querySelector<HTMLButtonElement>('button[name=close]')?.click();
    expect(searchPanelOpen(controller.getState())).toBe(false);

    controller.findNext();
    expect(controller.getState().selection.main.from).toBe(2);
  });
});

describe('destroy', () => {
  it('removes the editor and stops reporting', () => {
    const { controller, parent } = mount('abc');
    const handler = vi.fn();
    controller.onSelection(handler);
    controller.destroy();
    mounted.splice(mounted.indexOf(controller), 1);
    expect(parent.querySelector('.cm-editor')).toBeNull();
    expect(handler).not.toHaveBeenCalled();
  });
});
