import { describe, expect, it } from 'vitest';
import {
  BLOCK_GROUPS,
  HEADING_ENTRIES,
  rovingIndex,
  TEXT_BUTTONS,
  tooltip,
  VIEW_BUTTONS,
} from '../../src/shell/toolbar';

describe('toolbar definitions', () => {
  it('has the buttons of the mock, each once', () => {
    const actions = [...TEXT_BUTTONS, ...BLOCK_GROUPS.flat()].map((button) => button.action);
    expect(actions).toEqual([
      'bold',
      'italic',
      'strikethrough',
      'code',
      'quote',
      'rule',
      'bullet-list',
      'numbered-list',
      'task-list',
      'link',
      'image',
      'code-block',
      'table',
    ]);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('gives every button a name and a glyph or an icon', () => {
    for (const button of [...TEXT_BUTTONS, ...BLOCK_GROUPS.flat()]) {
      expect(button.label.length).toBeGreaterThan(0);
      expect(button.icon ?? button.glyph).toBeDefined();
    }
  });

  it('offers Paragraph and Heading 1 to 6', () => {
    expect(HEADING_ENTRIES.map((entry) => entry.action)).toEqual([
      'paragraph',
      'heading-1',
      'heading-2',
      'heading-3',
      'heading-4',
      'heading-5',
      'heading-6',
    ]);
  });

  it('has the three views with their shortcuts', () => {
    expect(VIEW_BUTTONS.map((b) => [b.mode, b.shortcut])).toEqual([
      ['editor', '⌘1'],
      ['split', '⌘2'],
      ['preview', '⌘3'],
    ]);
  });
});

describe('tooltip', () => {
  it('puts the shortcut in parentheses', () => {
    expect(tooltip('Bold', '⌘B')).toBe('Bold (⌘B)');
    expect(tooltip('Image')).toBe('Image');
  });
});

describe('rovingIndex', () => {
  it('moves with the arrows and wraps', () => {
    expect(rovingIndex('ArrowRight', 0, 3)).toBe(1);
    expect(rovingIndex('ArrowDown', 2, 3)).toBe(0);
    expect(rovingIndex('ArrowLeft', 0, 3)).toBe(2);
    expect(rovingIndex('ArrowUp', 1, 3)).toBe(0);
  });

  it('jumps with Home and End and ignores other keys', () => {
    expect(rovingIndex('Home', 2, 4)).toBe(0);
    expect(rovingIndex('End', 0, 4)).toBe(3);
    expect(rovingIndex('a', 0, 4)).toBeNull();
    expect(rovingIndex('ArrowDown', 0, 0)).toBeNull();
  });
});
