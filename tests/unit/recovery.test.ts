import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { caretOffset, stateJson } from '@/shell/recovery';

describe('caretOffset', () => {
  it('maps 1-based line and column from 0 to an offset', () => {
    expect(caretOffset('ab\ncde\nf', 1, 0)).toBe(0);
    expect(caretOffset('ab\ncde\nf', 2, 2)).toBe(5);
    expect(caretOffset('ab\ncde\nf', 3, 1)).toBe(8);
  });

  it('clamps to the line and to the text', () => {
    expect(caretOffset('ab\ncde', 1, 99)).toBe(2);
    expect(caretOffset('ab\ncde', 9, 0)).toBe(6);
    expect(caretOffset('', 1, 5)).toBe(0);
    expect(caretOffset('ab', 1, -3)).toBe(0);
  });
});

describe('stateJson', () => {
  it('is read back by CodeMirror with the text and the caret', () => {
    const state = EditorState.fromJSON(stateJson('one\ntwo', 2, 1), {});
    expect(state.doc.toString()).toBe('one\ntwo');
    expect(state.selection.main.head).toBe(5);
  });
});
