import { describe, expect, it } from 'vitest';
import { editorKeymap, editorKeymapWith } from '@/editor/keymap';
import { defaultSettings, mergeSettings } from '@/lib/platform-mock';
import {
  canonicalShortcut,
  comboFromEvent,
  effectiveShortcuts,
  findConflict,
  formatShortcut,
  parseShortcut,
  refusal,
  toCodeMirrorKey,
} from '@/lib/shortcut-keys';
import { checkChange, effectiveById, shortcutGroups, withShortcut } from '@/prefs/shortcuts';

const ev = (
  code: string,
  mods: Partial<Record<'ctrl' | 'alt' | 'shift' | 'meta', boolean>> = {},
) => ({
  code,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
  metaKey: !!mods.meta,
});

describe('parsing and formatting shortcut strings', () => {
  it('reads macOS symbols, the caret and key names', () => {
    expect(parseShortcut('⇧⌘O')).toEqual({
      ctrl: false,
      alt: false,
      shift: true,
      cmd: true,
      key: 'O',
    });
    expect(parseShortcut('^⌘S')?.ctrl).toBe(true);
    expect(parseShortcut('⌥↑')?.key).toBe('Up');
    expect(parseShortcut('⌃⇥')?.key).toBe('Tab');
    expect(parseShortcut('⌃Tab')?.key).toBe('Tab');
    expect(parseShortcut('F12')?.key).toBe('F12');
    expect(parseShortcut('⌘k')?.key).toBe('K');
  });

  it('refuses text that is not a shortcut', () => {
    for (const bad of ['', '⌘', '⌘AB', '⌘F0', '⌘F21', 'Cmd+K', '⌘ ']) {
      expect(parseShortcut(bad), bad).toBeNull();
    }
  });

  it('writes the canonical form: Control, Option, Shift, Command, then the key', () => {
    expect(canonicalShortcut('⌘⇧o')).toBe('⇧⌘O');
    expect(canonicalShortcut('^⌘S')).toBe('⌃⌘S');
    expect(canonicalShortcut('⌥Up')).toBe('⌥↑');
    expect(canonicalShortcut('⌃⇥')).toBe('⌃Tab');
    expect(formatShortcut({ ctrl: true, alt: true, shift: true, cmd: true, key: 'Space' })).toBe(
      '⌃⌥⇧⌘␣',
    );
  });

  it('makes CodeMirror key names', () => {
    expect(toCodeMirrorKey('⇧⌘K')).toBe('Shift-Mod-k');
    expect(toCodeMirrorKey('⌥↑')).toBe('Alt-ArrowUp');
    expect(toCodeMirrorKey('⌃⌥⌘G')).toBe('Ctrl-Alt-Mod-g');
    expect(toCodeMirrorKey('⌘]')).toBe('Mod-]');
    expect(toCodeMirrorKey('nonsense!')).toBeNull();
  });
});

describe('recording from a key event', () => {
  it('uses the physical key, so Option does not change the letter', () => {
    expect(comboFromEvent(ev('KeyB', { alt: true, meta: true }))).toEqual({
      ctrl: false,
      alt: true,
      shift: false,
      cmd: true,
      key: 'B',
    });
    expect(formatShortcut(comboFromEvent(ev('Digit8', { shift: true, meta: true })) as never)).toBe(
      '⇧⌘8',
    );
    expect(formatShortcut(comboFromEvent(ev('Period', { shift: true, meta: true })) as never)).toBe(
      '⇧⌘.',
    );
    expect(formatShortcut(comboFromEvent(ev('ArrowDown', { alt: true })) as never)).toBe('⌥↓');
    expect(formatShortcut(comboFromEvent(ev('F5')) as never)).toBe('F5');
  });

  it('ignores a bare modifier', () => {
    expect(comboFromEvent(ev('MetaLeft', { meta: true }))).toBeNull();
    expect(comboFromEvent(ev('ShiftLeft', { shift: true }))).toBeNull();
  });
});

describe('refused combinations', () => {
  const check = (text: string) => refusal(parseShortcut(text) as never);

  it('needs Command, Control or Option, except for function keys', () => {
    expect(check('B')).toMatch(/needs/);
    expect(check('⇧B')).toMatch(/needs/);
    expect(check('F5')).toBeNull();
    expect(check('⇧F5')).toBeNull();
    expect(check('⌥B')).toBeNull();
    expect(check('⌃B')).toBeNull();
  });

  it('refuses the shortcuts macOS keeps', () => {
    for (const reserved of ['⌘Q', '⌘H', '⌥⌘H', '⌘M', '⌘Tab', '⌘␣', '⌃⌘Q', '⌘,']) {
      expect(check(reserved), reserved).toMatch(/reserved/);
    }
    expect(check('⌘J')).toBeNull();
  });
});

describe('overrides, conflicts and the effective shortcuts', () => {
  it('an override replaces the default and null removes it', () => {
    const effective = effectiveShortcuts(
      { bold: '⌘B', italic: '⌘I' },
      { bold: '⌥⌘B', italic: null },
    );
    expect(effective).toEqual({ bold: '⌥⌘B', italic: undefined });
  });

  it('finds the other command with a shortcut, comparing canonical forms', () => {
    const effective = { bold: '⌘B', link: '⌘K', find: '^⌘F' };
    expect(findConflict('⌘k', effective, 'bold')).toBe('link');
    expect(findConflict('⌘K', effective, 'link')).toBeNull();
    expect(findConflict('⌃⌘F', effective, 'bold')).toBe('find');
    expect(findConflict('⌘J', effective, 'bold')).toBeNull();
  });

  it('the list shows overrides, marks them and the checks use them', () => {
    const groups = shortcutGroups({ bold: '⌥⌘B', italic: null });
    const row = (id: string) => groups.flatMap((g) => g.rows).find((r) => r.id === id);
    expect(row('bold')).toMatchObject({ keys: '⌥⌘B', defaultKeys: '⌘B', changed: true });
    expect(row('italic')).toMatchObject({ keys: '', changed: true });
    expect(row('link')).toMatchObject({ keys: '⌘K', changed: false, editable: true });
    expect(row('quit')?.editable).toBe(false);
    expect(row('editor:Enter')?.editable).toBe(false);
    expect(row('editor:Mod-d')?.editable).toBe(true);
    // Italic lost ⌘I, so Link may take it; Bold's old ⌘B is free; Link's ⌘K is not.
    expect(checkChange(groups, 'link', parseShortcut('⌘I') as never).kind).toBe('ok');
    expect(checkChange(groups, 'italic', parseShortcut('⌘K') as never)).toEqual({
      kind: 'conflict',
      otherId: 'link',
      otherName: 'Link',
    });
    expect(checkChange(groups, 'italic', parseShortcut('⌘Q') as never).kind).toBe('refused');
    expect(effectiveById(groups).bold).toBe('⌥⌘B');
  });

  it('a value equal to the default is no override', () => {
    expect(withShortcut({ bold: '⌥⌘B' }, 'bold', '⌘B', '⌘B')).toEqual({});
    expect(withShortcut({}, 'bold', '⌥⌘b', '⌘B')).toEqual({ bold: '⌥⌘B' });
    expect(withShortcut({}, 'bold', null, '⌘B')).toEqual({ bold: null });
    expect(withShortcut({ x: null }, 'x', null, '')).toEqual({});
  });
});

describe('the setting in the mock (same rules as settings.rs)', () => {
  const base = defaultSettings();

  it('defaults to none and keeps known commands with parsable strings, canonical', () => {
    expect(base.shortcuts).toEqual({});
    const got = mergeSettings(base, {
      shortcuts: {
        bold: '⌘⌥b',
        italic: null,
        'editor:Mod-d': '⌃D',
        'No Such!': '⌘J',
        save: 'x y',
        quit: '⌘J',
      },
    });
    expect(got.shortcuts).toEqual({ bold: '⌥⌘B', italic: null, 'editor:Mod-d': '⌃D' });
  });

  it('a patch replaces the whole set, so a reset removes entries', () => {
    const one = mergeSettings(base, { shortcuts: { bold: '⌥⌘B', italic: '⌥⌘I' } });
    expect(mergeSettings(one, { shortcuts: { bold: '⌥⌘B' } }).shortcuts).toEqual({ bold: '⌥⌘B' });
    expect(mergeSettings(one, { shortcuts: {} }).shortcuts).toEqual({});
    expect(mergeSettings(one, { shortcuts: 3 as never }).shortcuts).toEqual(one.shortcuts);
  });
});

describe('the editor keymap with overrides', () => {
  const keysOf = (map: readonly { key?: string; mac?: string }[]) =>
    map.flatMap((binding) => [binding.key, binding.mac]).filter(Boolean);

  it('without editor overrides it is the default keymap itself', () => {
    expect(editorKeymapWith(undefined)).toBe(editorKeymap);
    expect(editorKeymapWith({ bold: '⌥⌘B' })).toBe(editorKeymap);
  });

  it('moves a binding to the new key and drops the old one', () => {
    expect(keysOf(editorKeymap)).toContain('Mod-Alt-g');
    const changed = editorKeymapWith({ 'editor:Mod-Alt-g': '⌃⌥L' });
    expect(keysOf(changed)).not.toContain('Mod-Alt-g');
    expect(keysOf(changed)).toContain('Ctrl-Alt-l');
    expect(changed.length).toBe(editorKeymap.length);
  });

  it('a null override removes the binding', () => {
    const removed = editorKeymapWith({ 'editor:Mod-d': null });
    expect(keysOf(removed)).not.toContain('Mod-d');
    expect(removed.length).toBe(editorKeymap.length - 1);
  });

  it('finds a binding that lives in the mac field', () => {
    const changed = editorKeymapWith({ 'editor:Shift-Alt-m': '⌃⌥M' });
    expect(keysOf(changed)).not.toContain('Shift-Alt-m');
    expect(keysOf(changed)).toContain('Ctrl-Alt-m');
  });
});
