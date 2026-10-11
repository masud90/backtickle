import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import type { DocumentFile } from '@/lib/platform';
import {
  applyAppearance,
  clampZoom,
  editorMetrics,
  stepZoom,
  zoomPercent,
} from '@/shell/appearance';
import { fileTab, tabIsDirty, untitledTab } from '@/shell/tab';

const file: DocumentFile = {
  path: '/Users/me/Notes/plan.md',
  text: '# Plan',
  encoding: 'utf-8',
  legacyEncoding: null,
  lossy: false,
  lineEnding: 'crlf',
  mixedLineEndings: false,
  readOnly: false,
  bytes: 8,
  modifiedMs: 1_700_000_000_000,
};

describe('tabIsDirty', () => {
  it('is clean for a fresh tab', () => {
    const tab = untitledTab({
      id: 1,
      name: 'Untitled',
      text: '',
      view: 'split',
      flavor: 'gfm',
      reason: 'default',
    });

    expect(tabIsDirty(tab)).toBe(false);
  });

  it('is dirty when the text differs, and clean again when it is back to the saved text', () => {
    // The shell compares documents, not edit counters: undoing back to the saved text clears it.
    const saved = EditorState.create({ doc: 'hello' }).doc;
    const edited = EditorState.create({ doc: 'hello!' }).doc;
    const undone = EditorState.create({ doc: 'hello' }).doc;
    const base = untitledTab({
      id: 1,
      name: 'Untitled',
      text: 'hello',
      view: 'split',
      flavor: 'gfm',
      reason: 'default',
    });

    expect(tabIsDirty({ ...base, textDirty: !edited.eq(saved) })).toBe(true);
    expect(tabIsDirty({ ...base, textDirty: !undone.eq(saved) })).toBe(false);
  });

  it('counts a switched line ending as an edit, and switching back clears it', () => {
    const tab = fileTab(1, file, { obsidianVault: false, location: 'local' }, 'preview', {
      flavor: 'gfm',
      reason: 'default',
      chosen: null,
    });

    expect(tab.format.lineEnding).toBe('crlf');
    expect(tabIsDirty(tab)).toBe(false);
    expect(tabIsDirty({ ...tab, format: { ...tab.format, lineEnding: 'lf' } })).toBe(true);
    expect(tabIsDirty({ ...tab, format: { ...tab.format, lineEnding: 'crlf' } })).toBe(false);
  });
});

describe('fileTab', () => {
  it('takes name, format, flags and times from the file', () => {
    const tab = fileTab(
      7,
      { ...file, legacyEncoding: 'windows-1252', readOnly: true },
      { obsidianVault: false, location: 'icloud' },
      'split',
      { flavor: 'obsidian', reason: 'vault', chosen: null },
    );

    expect(tab).toMatchObject({
      id: 7,
      path: file.path,
      name: 'plan.md',
      initialText: '# Plan',
      legacyEncoding: 'windows-1252',
      readOnly: true,
      modifiedMs: 1_700_000_000_000,
      savedAtMs: 1_700_000_000_000,
      location: 'icloud',
      view: 'split',
      flavor: 'obsidian',
      reason: 'vault',
    });
  });
});

describe('zoom', () => {
  it('stays between 50 and 200 percent', () => {
    expect(clampZoom(0.1)).toBe(0.5);
    expect(clampZoom(3)).toBe(2);
    expect(clampZoom(1.234)).toBe(1.23);
  });

  it('steps by 10 percent on the grid', () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(0.5, -1)).toBe(0.5);
    expect(stepZoom(2, 1)).toBe(2);
    expect(stepZoom(1.1, 1)).toBe(1.2);
  });

  it('shows whole percents', () => {
    expect(zoomPercent(1.1)).toBe(110);
    expect(zoomPercent(0.5)).toBe(50);
  });

  it('scales the editor font and keeps the 13 to 22 line ratio', () => {
    expect(editorMetrics(13, 1)).toEqual({ font: 13, line: 22 });
    expect(editorMetrics(13, 2)).toEqual({ font: 26, line: 44 });
    expect(editorMetrics(16, 1.5)).toEqual({ font: 24, line: 41 });
  });
});

describe('applyAppearance', () => {
  it('sets data-theme for light and dark, and removes it for system', () => {
    const root = document.createElement('html');

    applyAppearance(root, 'dark');
    expect(root.dataset.theme).toBe('dark');
    applyAppearance(root, 'light');
    expect(root.dataset.theme).toBe('light');
    applyAppearance(root, 'system');
    expect(root.dataset.theme).toBeUndefined();
  });
});
