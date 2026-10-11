import { describe, expect, it } from 'vitest';
import { movedFields, tabFromTransfer, untitledTab } from '@/shell/tab';

const base = untitledTab({
  id: 1,
  name: 'Notes',
  text: 'hello',
  view: 'preview',
  flavor: 'obsidian',
  reason: 'chosen',
  chosenFlavor: 'obsidian',
});

describe('tab transfer between windows', () => {
  it('carries the moved fields and takes a new id', () => {
    const moved = { ...base, textDirty: true, editorTopLine: 12, previewScrollTop: 340 };
    const tab = tabFromTransfer(7, {
      path: '/n/notes.md',
      text: 'hello!',
      savedText: 'hello',
      editorState: { doc: 'hello!' },
      tab: movedFields(moved),
    });
    expect(tab.id).toBe(7);
    expect(tab.path).toBe('/n/notes.md');
    expect(tab).toMatchObject({
      name: 'Notes',
      view: 'preview',
      flavor: 'obsidian',
      chosenFlavor: 'obsidian',
      textDirty: true,
      editorTopLine: 12,
      previewScrollTop: 340,
      initialText: 'hello!',
    });
    expect(tab.transfer).toEqual({ editorState: { doc: 'hello!' }, savedText: 'hello' });
  });

  it('ignores fields of the wrong type and falls back to defaults', () => {
    const tab = tabFromTransfer(2, {
      path: null,
      text: '',
      savedText: '',
      editorState: null,
      tab: { name: 5, view: 'nonsense', editorTopLine: 'x', textDirty: 'yes', dismissed: 3 },
    });
    expect(tab).toMatchObject({
      name: 'Untitled',
      view: 'split',
      editorTopLine: 0,
      textDirty: false,
    });
    expect(tab.transfer).toBeNull();
  });
});
