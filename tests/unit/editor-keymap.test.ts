import { defaultKeymap } from '@codemirror/commands';
import { type KeyBinding, keymap } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { EditorController } from '@/editor/controller';
import { REMOVED_BINDINGS } from '@/editor/keymap';

/** The shortcuts of the menu bar in CodeMirror's notation, where Mod is Command. */
const MENU_SHORTCUTS: Record<string, string> = {
  Settings: 'Mod-,',
  'Hide Writedown': 'Mod-h',
  'Hide Others': 'Alt-Mod-h',
  'Quit Writedown': 'Mod-q',
  New: 'Mod-n',
  Open: 'Mod-o',
  'Close Tab': 'Mod-w',
  'Close Window': 'Shift-Mod-w',
  Save: 'Mod-s',
  'Save As': 'Shift-Mod-s',
  Undo: 'Mod-z',
  Redo: 'Shift-Mod-z',
  Find: 'Mod-f',
  'Find and Replace': 'Alt-Mod-f',
  'Find Next': 'Mod-g',
  'Find Previous': 'Shift-Mod-g',
  Bold: 'Mod-b',
  Italic: 'Mod-i',
  Strikethrough: 'Shift-Mod-x',
  'Inline Code': 'Mod-e',
  Link: 'Mod-k',
  'Heading 1': 'Alt-Mod-1',
  'Heading 2': 'Alt-Mod-2',
  'Heading 3': 'Alt-Mod-3',
  'Heading 4': 'Alt-Mod-4',
  'Heading 5': 'Alt-Mod-5',
  'Heading 6': 'Alt-Mod-6',
  Paragraph: 'Alt-Mod-0',
  Quote: 'Shift-Mod-.',
  'Bulleted List': 'Shift-Mod-8',
  'Numbered List': 'Shift-Mod-7',
  'Task List': 'Shift-Mod-9',
  'View Editor': 'Mod-1',
  'View Split': 'Mod-2',
  'View Preview': 'Mod-3',
  'Show Sidebar': 'Ctrl-Mod-s',
  'Zoom In': 'Mod-=',
  'Zoom Out': 'Mod--',
  'Actual Size': 'Mod-0',
  'Enter Full Screen': 'Ctrl-Mod-f',
  Minimize: 'Mod-m',
  'Show Next Tab': 'Ctrl-Tab',
  'Show Previous Tab': 'Ctrl-Shift-Tab',
};

/** CodeMirror keeps these: the editor handles them itself when the menu does not (Find is the find bar). */
const KEPT_BY_CODEMIRROR = [
  'Undo',
  'Redo',
  'Find',
  'Find and Replace',
  'Find Next',
  'Find Previous',
];

const MODIFIERS = ['Alt', 'Ctrl', 'Meta', 'Shift'] as const;

/**
 * One spelling for a key name, as CodeMirror reads it on a Mac: modifiers in a fixed order, Mod
 * and Cmd as Meta, and a capital letter as Shift plus the letter.
 */
function canonical(name: string): string {
  const parts = name.split(/-(?!$)/);
  let key = parts[parts.length - 1] ?? '';
  const held = new Set<string>();
  for (const part of parts.slice(0, -1)) {
    const lower = part.toLowerCase();
    if (lower === 'mod' || lower === 'cmd' || lower === 'meta' || lower === 'm') held.add('Meta');
    else if (lower === 'alt' || lower === 'a') held.add('Alt');
    else if (lower === 'ctrl' || lower === 'control' || lower === 'c') held.add('Ctrl');
    else if (lower === 'shift' || lower === 's') held.add('Shift');
    else throw new Error(`Unknown modifier in ${name}`);
  }
  if (/^[A-Z]$/.test(key)) {
    held.add('Shift');
    key = key.toLowerCase();
  }
  return [...MODIFIERS.filter((modifier) => held.has(modifier)), key].join('-');
}

/** Every key name a binding answers to on a Mac, including its Shift variant. */
function namesOf(binding: KeyBinding): string[] {
  const base = binding.mac ?? binding.key;
  if (!base) return [];
  const names = [base];
  if (binding.shift) names.push(`Shift-${base}`);
  return names;
}

function boundKeys(): Set<string> {
  const state = EditorController.createState('text', 'gfm');
  const bound = new Set<string>();
  for (const bindings of state.facet(keymap)) {
    for (const binding of bindings) {
      for (const name of namesOf(binding)) bound.add(canonical(name));
    }
  }
  return bound;
}

describe('canonical key names (the test helper)', () => {
  it('reads CodeMirror notation the way CodeMirror does', () => {
    expect(canonical('Shift-Mod-k')).toBe(canonical('Mod-Shift-k'));
    expect(canonical('Mod-Alt-f')).toBe('Alt-Meta-f');
    expect(canonical('Alt-A')).toBe('Alt-Shift-a');
    expect(canonical('Mod--')).toBe('Meta--');
    expect(canonical('Ctrl-Tab')).toBe('Ctrl-Tab');
  });
});

describe('the editor keymap', () => {
  it('binds none of the menu shortcuts, except Undo, Redo and the Find items', () => {
    const bound = boundKeys();
    const collisions = Object.entries(MENU_SHORTCUTS)
      .filter(([item]) => !KEPT_BY_CODEMIRROR.includes(item))
      .filter(([, keys]) => bound.has(canonical(keys)))
      .map(([item, keys]) => `${item} (${keys})`);
    expect(collisions).toEqual([]);
  });

  it('keeps Undo, Redo, Find, Find and Replace, Find Next and Find Previous', () => {
    const bound = boundKeys();
    for (const item of KEPT_BY_CODEMIRROR) {
      expect(bound.has(canonical(MENU_SHORTCUTS[item] ?? '')), item).toBe(true);
    }
  });

  it('does not bind Italic: Mod-i (select parent syntax) is taken out of the defaults', () => {
    expect(REMOVED_BINDINGS).toContain('Mod-i');
    expect(defaultKeymap.some((binding) => binding.key === 'Mod-i')).toBe(true);
    expect(boundKeys().has(canonical('Mod-i'))).toBe(false);
  });

  it('removes only bindings that collide with a menu shortcut', () => {
    const menu = new Set(Object.values(MENU_SHORTCUTS).map(canonical));
    for (const removed of REMOVED_BINDINGS) expect(menu.has(canonical(removed))).toBe(true);
  });

  it('keeps the editing keys: history, Escape, Tab, list continuation and marker deletion', () => {
    const bound = boundKeys();
    for (const key of [
      'Mod-z',
      'Shift-Mod-z',
      'Escape',
      'Tab',
      'Shift-Tab',
      'Enter',
      'Backspace',
      'Mod-a',
      'Mod-g',
      'Shift-Mod-g',
    ]) {
      expect(bound.has(canonical(key)), key).toBe(true);
    }
  });

  it('closes an open find bar with Escape before the default Escape collapses the selection', () => {
    const state = EditorController.createState('text', 'gfm');
    const escapes = state
      .facet(keymap)
      .flat()
      .filter((binding) => binding.key === 'Escape')
      .map((binding) => binding.run?.name);
    expect(escapes[0]).toBe('closeSearchPanel');
    expect(escapes).toContain('simplifySelection');
  });
});
