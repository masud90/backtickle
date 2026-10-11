import { describe, expect, it } from 'vitest';
import { toggleTask } from '@/editor/commands';
import { EditorController, type FlavorId } from '@/editor/controller';
import { StateRunner } from './editor-helpers';

/** The document after toggling the task on a 0-based line, or null when nothing would change. */
function toggled(text: string, line: number, flavor: FlavorId = 'gfm'): string | null {
  const state = EditorController.createState(text, flavor);
  const spec = toggleTask(state, line);
  return spec ? state.update(spec).state.doc.toString() : null;
}

describe('toggleTask', () => {
  it('checks an open box and unchecks a done one', () => {
    expect(toggled('- [ ] a', 0)).toBe('- [x] a');
    expect(toggled('- [x] a', 0)).toBe('- [ ] a');
  });

  it('treats [X] as done', () => {
    expect(toggled('- [X] a', 0)).toBe('- [ ] a');
  });

  it('works after -, *, + and numbered markers', () => {
    expect(toggled('* [ ] a', 0)).toBe('* [x] a');
    expect(toggled('+ [x] a', 0)).toBe('+ [ ] a');
    expect(toggled('1. [ ] a', 0)).toBe('1. [x] a');
    expect(toggled('12) [x] a', 0)).toBe('12) [ ] a');
    expect(toggled('3) [ ] a', 0)).toBe('3) [x] a');
  });

  it('only changes the line it is given (0-based)', () => {
    const text = '- [ ] a\n- [ ] b\n- [ ] c';
    expect(toggled(text, 0)).toBe('- [x] a\n- [ ] b\n- [ ] c');
    expect(toggled(text, 1)).toBe('- [ ] a\n- [x] b\n- [ ] c');
    expect(toggled(text, 2)).toBe('- [ ] a\n- [ ] b\n- [x] c');
  });

  it('works on nested items, with spaces or a tab', () => {
    const text = '- [ ] a\n  - [x] b\n    - [ ] c\n\t- [ ] d';
    expect(toggled(text, 1)).toBe('- [ ] a\n  - [ ] b\n    - [ ] c\n\t- [ ] d');
    expect(toggled(text, 2)).toBe('- [ ] a\n  - [x] b\n    - [x] c\n\t- [ ] d');
    expect(toggled(text, 3)).toBe('- [ ] a\n  - [x] b\n    - [ ] c\n\t- [x] d');
  });

  it('works on a task that is not the first line of the document', () => {
    expect(toggled('# Plan\n\ntext\n\n- [ ] ship', 4)).toBe('# Plan\n\ntext\n\n- [x] ship');
  });

  it('works inside a blockquote', () => {
    expect(toggled('> - [ ] a', 0)).toBe('> - [x] a');
    expect(toggled('> > - [x] a', 0)).toBe('> > - [ ] a');
    expect(toggled('>- [ ] a', 0)).toBe('>- [x] a');
    expect(toggled('> 1. [ ] a', 0)).toBe('> 1. [x] a');
  });

  it('works when the box is the only thing after the marker', () => {
    expect(toggled('- [ ]', 0)).toBe('- [x]');
  });

  it('returns null for a line without a task, and changes nothing', () => {
    expect(toggled('- a', 0)).toBeNull();
    expect(toggled('plain text', 0)).toBeNull();
    expect(toggled('', 0)).toBeNull();
    expect(toggled('# [ ] heading', 0)).toBeNull();
    expect(toggled('[ ] no marker', 0)).toBeNull();
    expect(toggled('- [] empty box', 0)).toBeNull();
    expect(toggled('- [y] not a box', 0)).toBeNull();
    expect(toggled('- [ ]glued', 0)).toBeNull();
    expect(toggled('-[ ] no space after the marker', 0)).toBeNull();
    expect(toggled('text - [ ] in the middle', 0)).toBeNull();
  });

  it('returns null for a line that does not exist', () => {
    expect(toggled('- [ ] a', -1)).toBeNull();
    expect(toggled('- [ ] a', 1)).toBeNull();
    expect(toggled('- [ ] a', 0.5)).toBeNull();
    expect(toggled('- [ ] a', Number.NaN)).toBeNull();
  });

  it('returns null for a line that only looks like a task inside a code block', () => {
    expect(toggled('```\n- [ ] a\n```', 1)).toBeNull();
    expect(toggled('para\n\n    - [ ] a', 2)).toBeNull();
    expect(toggled('```\n- [ ] a\n```\n\n- [ ] b', 4)).toBe('```\n- [ ] a\n```\n\n- [x] b');
  });

  it('works on an item nested four spaces deep, which is not a code block', () => {
    expect(toggled('- a\n    - [ ] b', 1)).toBe('- a\n    - [x] b');
  });

  it('works for a document that came from a CRLF file (line endings normalized to LF)', () => {
    expect(toggled('- [ ] a\n- [x] b\n', 1)).toBe('- [ ] a\n- [ ] b\n');
  });

  it('also works when CRLF line breaks are still in the text', () => {
    const state = EditorController.createState('- [ ] a\r\n- [x] b\r\n', 'gfm');
    expect(state.doc.lines).toBe(3);
    const spec = toggleTask(state, 1);
    expect(spec).not.toBeNull();
    expect(state.update(spec ?? {}).state.doc.toString()).toBe('- [ ] a\n- [ ] b\n');
  });

  it('works in the CommonMark flavor, where the preview shows no boxes, too', () => {
    expect(toggled('- [ ] a', 0, 'commonmark')).toBe('- [x] a');
  });

  it('changes one character and is marked as the task input event', () => {
    const state = EditorController.createState('- [ ] a', 'gfm');
    const spec = toggleTask(state, 0);
    expect(spec?.userEvent).toBe('input.task');
    expect(state.update(spec ?? {}).changes.length).toBe(state.doc.length);
    const changed: [number, number][] = [];
    state.update(spec ?? {}).changes.iterChangedRanges((fromA, toA) => changed.push([fromA, toA]));
    expect(changed).toEqual([[3, 4]]);
  });

  it('is one undo step each, even for two toggles in a row', () => {
    const runner = new StateRunner('- [ ] a‸');
    runner.run((state) => toggleTask(state, 0));
    runner.run((state) => toggleTask(state, 0));
    expect(runner.text).toBe('- [ ] a');
    runner.run((state) => toggleTask(state, 0));
    expect(runner.text).toBe('- [x] a');
    runner.undo();
    expect(runner.text).toBe('- [ ] a');
    runner.undo();
    expect(runner.text).toBe('- [x] a');
    runner.undo();
    expect(runner.text).toBe('- [ ] a');
  });

  it('does not move the selection', () => {
    const runner = new StateRunner('first\n- [ ] a\nthi‸rd');
    const before = runner.state.selection.main.head;
    runner.run((state) => toggleTask(state, 1));
    expect(runner.text).toBe('first\n- [x] a\nthird');
    expect(runner.state.selection.main.head).toBe(before);
  });
});
