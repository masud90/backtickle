import { EditorSelection } from '@codemirror/state';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorController } from '@/editor/controller';
import { continueOrderedTask, deleteOrderedTaskMarker, endEmptyQuote } from '@/editor/lists';
import { parseMarked, renderMarked } from './editor-helpers';

const mounted: EditorController[] = [];

afterEach(() => {
  for (const controller of mounted.splice(0)) controller.destroy();
  document.body.replaceChildren();
});

/** An editor showing a marked document, with the caret or selection in place. */
function open(marked: string): EditorController {
  const { text, anchor, head } = parseMarked(marked);
  const parent = document.createElement('div');
  document.body.append(parent);
  const controller = new EditorController({
    parent,
    doc: text,
    onChange: () => {},
    onCursor: () => {},
  });
  controller.view.dispatch({ selection: EditorSelection.single(anchor, head) });
  mounted.push(controller);
  return controller;
}

/** Sends a key to the editor the way the browser does and returns the marked document after it. */
function press(marked: string, key: 'Enter' | 'Backspace'): string {
  const controller = open(marked);
  const codes = { Enter: 13, Backspace: 8 };
  controller.view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key, keyCode: codes[key], bubbles: true, cancelable: true }),
  );
  return renderMarked(controller.getState());
}

describe('Return in a list', () => {
  it('continues a bulleted list and ends it on an empty item', () => {
    expect(press('- a‸', 'Enter')).toBe('- a\n- ‸');
    expect(press('- a\n- ‸', 'Enter')).toBe('- a\n‸');
    expect(press('* a‸', 'Enter')).toBe('* a\n* ‸');
  });

  it('continues a numbered list and ends it on an empty item', () => {
    expect(press('1. a‸', 'Enter')).toBe('1. a\n2. ‸');
    expect(press('9) a‸', 'Enter')).toBe('9) a\n10) ‸');
    expect(press('1. a\n2. ‸', 'Enter')).toBe('1. a\n‸');
  });

  it('numbers the items that follow after a new item in the middle', () => {
    expect(press('1. a‸\n2. b', 'Enter')).toBe('1. a\n2. ‸\n3. b');
  });

  it('continues a quote', () => {
    expect(press('> a‸', 'Enter')).toBe('> a\n> ‸');
  });

  it('splits an item at the caret', () => {
    expect(press('- ab‸cd', 'Enter')).toBe('- ab\n- ‸cd');
  });
});

describe('Return on an empty quote line', () => {
  it('ends the quote', () => {
    expect(press('> quoted‸', 'Enter')).toBe('> quoted\n> ‸');
    expect(press('> quoted\n> ‸', 'Enter')).toBe('> quoted\n‸');
  });

  it('ends one level of a nested quote', () => {
    expect(press('> > a\n> > ‸', 'Enter')).toBe('> > a\n> ‸');
  });

  it('still ends a list inside a quote as before', () => {
    expect(press('> - a\n> - ‸', 'Enter')).toBe('> - a\n> ‸');
  });

  it('leaves a quote mark inside a code block alone', () => {
    const controller = open('```\n> ‸\n```');
    expect(endEmptyQuote(controller.view)).toBe(false);
    expect(controller.getText()).toBe('```\n> \n```');
  });

  it('leaves a line with text to the language', () => {
    const controller = open('> a‸');
    expect(endEmptyQuote(controller.view)).toBe(false);
  });

  it('is one undo step', () => {
    const controller = open('> a\n> ‸');
    controller.view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }),
    );
    expect(controller.getText()).toBe('> a\n');
    controller.undo();
    expect(controller.getText()).toBe('> a\n> ');
  });
});

describe('Return in a bullet task list (the Markdown language does this)', () => {
  it('continues with an open box, even after a done item', () => {
    expect(press('- [ ] a‸', 'Enter')).toBe('- [ ] a\n- [ ] ‸');
    expect(press('- [x] done‸', 'Enter')).toBe('- [x] done\n- [ ] ‸');
    expect(press('* [X] a‸', 'Enter')).toBe('* [X] a\n* [ ] ‸');
    expect(press('+ [ ] a‸', 'Enter')).toBe('+ [ ] a\n+ [ ] ‸');
  });

  it('ends the list on an empty task item', () => {
    expect(press('- [ ] a\n- [ ] ‸', 'Enter')).toBe('- [ ] a\n‸');
    expect(press('- [ ] ‸', 'Enter')).toBe('‸');
  });

  it('works nested and inside a quote', () => {
    expect(press('- a\n  - [ ] b‸', 'Enter')).toBe('- a\n  - [ ] b\n  - [ ] ‸');
    expect(press('> - [ ] a‸', 'Enter')).toBe('> - [ ] a\n> - [ ] ‸');
  });
});

describe('Return in an ordered task list', () => {
  it('continues with the next number and an open box', () => {
    expect(press('1. [ ] a‸', 'Enter')).toBe('1. [ ] a\n2. [ ] ‸');
    expect(press('1. [x] a‸', 'Enter')).toBe('1. [x] a\n2. [ ] ‸');
    expect(press('3) [ ] a‸', 'Enter')).toBe('3) [ ] a\n4) [ ] ‸');
  });

  it('numbers the items that follow after a new item in the middle', () => {
    expect(press('1. [ ] a‸\n2. [ ] b', 'Enter')).toBe('1. [ ] a\n2. [ ] ‸\n3. [ ] b');
  });

  it('splits an item at the caret', () => {
    expect(press('1. [ ] ab‸cd', 'Enter')).toBe('1. [ ] ab\n2. [ ] ‸cd');
  });

  it('ends the list on an empty item', () => {
    expect(press('1. [ ] a\n2. [ ] ‸', 'Enter')).toBe('1. [ ] a\n‸');
    expect(press('1. [ ] ‸', 'Enter')).toBe('‸');
  });

  it('works nested and inside a quote', () => {
    expect(press('- a\n  1. [ ] b‸', 'Enter')).toBe('- a\n  1. [ ] b\n  2. [ ] ‸');
    expect(press('> 1. [ ] a‸', 'Enter')).toBe('> 1. [ ] a\n> 2. [ ] ‸');
  });

  it('is one undo step', () => {
    const controller = open('1. [ ] a‸\n2. [ ] b');
    controller.view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }),
    );
    expect(controller.getText()).toBe('1. [ ] a\n2. [ ] \n3. [ ] b');
    controller.undo();
    expect(controller.getText()).toBe('1. [ ] a\n2. [ ] b');
  });

  it('leaves a line inside a code block alone', () => {
    const controller = open('```\n1. [ ] a‸\n```');
    expect(continueOrderedTask(controller.view)).toBe(false);
    expect(controller.getText()).toBe('```\n1. [ ] a\n```');
  });

  it('leaves other places to the editor: inside the marker, with a selection, when read-only', () => {
    const inside = open('1. [‸ ] a');
    expect(continueOrderedTask(inside.view)).toBe(false);

    const selected = open('1. [ ] «a»');
    expect(continueOrderedTask(selected.view)).toBe(false);

    const readOnly = open('1. [ ] a‸');
    readOnly.setReadOnly(true);
    expect(continueOrderedTask(readOnly.view)).toBe(false);
    expect(readOnly.getText()).toBe('1. [ ] a');

    const plain = open('1. a‸');
    expect(continueOrderedTask(plain.view)).toBe(false);
  });
});

describe('Backspace at a marker', () => {
  it('removes a bullet, a number and a quote mark', () => {
    expect(press('- ‸a', 'Backspace')).toBe('‸a');
    expect(press('1. ‸a', 'Backspace')).toBe('‸a');
    expect(press('> ‸a', 'Backspace')).toBe('‸a');
  });

  it('removes the whole marker of a bullet task item', () => {
    expect(press('- [ ] ‸a', 'Backspace')).toBe('‸a');
    expect(press('- [x] ‸', 'Backspace')).toBe('‸');
  });

  it('removes the whole marker of an ordered task item', () => {
    expect(press('1. [ ] ‸a', 'Backspace')).toBe('‸a');
    expect(press('2) [x] ‸', 'Backspace')).toBe('‸');
    expect(press('> 1. [ ] ‸a', 'Backspace')).toBe('> ‸a');
  });

  it('deletes one character as usual anywhere else', () => {
    expect(press('1. [ ] a‸', 'Backspace')).toBe('1. [ ] ‸');
    expect(press('1. [ ‸] a', 'Backspace')).toBe('1. [‸] a');
  });

  it('leaves a selection and a code block to the editor', () => {
    const selected = open('1. [ ] «a»');
    expect(deleteOrderedTaskMarker(selected.view)).toBe(false);

    const code = open('```\n1. [ ] ‸a\n```');
    expect(deleteOrderedTaskMarker(code.view)).toBe(false);
  });
});
