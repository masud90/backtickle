/** WP5.2 typewriter scrolling: the extension and the controller switch. */
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorController } from '@/editor/controller';
import { typewriterExtension, wantsCentering } from '@/editor/typewriter';

const DOC = 'one\ntwo\nthree\n';

function stateOn(): EditorState {
  return EditorState.create({ doc: DOC, extensions: [typewriterExtension] });
}

describe('the typewriter extension', () => {
  it('adds a scroll effect to a cursor move', () => {
    const tr = stateOn().update({ selection: EditorSelection.cursor(5), userEvent: 'select' });
    expect(tr.effects).toHaveLength(1);
  });

  it('adds a scroll effect to typing, deleting and undo', () => {
    const state = stateOn();
    for (const userEvent of ['input.type', 'delete.backward', 'undo']) {
      const tr = state.update({ changes: { from: 0, insert: 'x' }, userEvent });
      expect(tr.effects, userEvent).toHaveLength(1);
    }
  });

  it('adds nothing when a transaction neither moves the cursor nor edits', () => {
    const tr = stateOn().update({ scrollIntoView: true });
    expect(tr.effects).toHaveLength(0);
  });

  it('leaves a click with the mouse alone, so the text does not move under the pointer', () => {
    const tr = stateOn().update({
      selection: EditorSelection.cursor(5),
      userEvent: 'select.pointer',
    });
    expect(tr.effects).toHaveLength(0);
  });

  it('leaves remote changes alone', () => {
    const tr = stateOn().update({
      changes: { from: 0, insert: 'x' },
      annotations: Transaction.remote.of(true),
    });
    expect(wantsCentering(tr)).toBe(false);
    expect(tr.effects).toHaveLength(0);
  });

  it('is absent from a state without it', () => {
    const tr = EditorState.create({ doc: DOC }).update({ selection: EditorSelection.cursor(5) });
    expect(tr.effects).toHaveLength(0);
  });
});

describe('EditorController.setTypewriter', () => {
  const mounted: EditorController[] = [];
  afterEach(() => {
    for (const controller of mounted.splice(0)) controller.destroy();
    document.body.replaceChildren();
  });

  function mount(): EditorController {
    const parent = document.createElement('div');
    document.body.append(parent);
    const controller = new EditorController({
      parent,
      doc: DOC,
      onChange: () => {},
      onCursor: () => {},
    });
    mounted.push(controller);
    return controller;
  }

  const padded = (c: EditorController) => c.view.dom.style.getPropertyValue('--wd-typewriter-pad');

  it('is off by default and turns on and off', async () => {
    const controller = mount();
    expect(padded(controller)).toBe('');
    controller.setTypewriter(true);
    await vi.waitFor(() => expect(padded(controller)).not.toBe(''));
    controller.setTypewriter(false);
    expect(padded(controller)).toBe('');
  });

  it('stays on across a state switch', async () => {
    const controller = mount();
    controller.setTypewriter(true);
    await vi.waitFor(() => expect(padded(controller)).not.toBe(''));
    const other = EditorController.createState('other', 'gfm');
    controller.setState(other);
    expect(padded(controller)).not.toBe('');
  });
});
