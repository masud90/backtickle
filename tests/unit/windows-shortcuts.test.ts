import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setOsForTesting } from '@/lib/os';
import {
  comboFromEvent,
  displayShortcut,
  eventRefusal,
  findConflict,
  parseShortcut,
  refusal,
  sameShortcut,
  toCodeMirrorKey,
  windowsShortcut,
} from '@/lib/shortcut-keys';
import { checkChange, filterShortcuts, shortcutGroups, withShortcut } from '@/prefs/shortcuts';

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

const combo = (text: string) => {
  const parsed = parseShortcut(text);
  if (!parsed) throw new Error(`not a shortcut: ${text}`);
  return parsed;
};

afterEach(() => setOsForTesting(null));

describe('the Windows form of a shortcut (the rule of the Rust menu)', () => {
  it('maps ⌘ to Ctrl, ⌥ to Alt and ⇧ to Shift', () => {
    expect(windowsShortcut('⇧⌘O')).toBe('Ctrl+Shift+O');
    expect(windowsShortcut('⌥⌘O')).toBe('Ctrl+Alt+O');
    expect(windowsShortcut('⌥↑')).toBe('Alt+Up');
    expect(windowsShortcut('F5')).toBe('F5');
  });

  it('maps ⌃ alone to Ctrl, and ⌃ with ⌘ to Ctrl+Alt', () => {
    expect(windowsShortcut('⌃Tab')).toBe('Ctrl+Tab');
    expect(windowsShortcut('^⇧Tab')).toBe('Ctrl+Shift+Tab');
    expect(windowsShortcut('^⌘S')).toBe('Ctrl+Alt+S');
  });

  it('has no Windows form for ⌃, ⌥ and ⌘ together', () => {
    expect(windowsShortcut('⌃⌥⌘S')).toBeNull();
  });

  it('names keys as Windows does', () => {
    expect(windowsShortcut('⌘↩')).toBe('Ctrl+Enter');
    expect(windowsShortcut('⌥⎋')).toBe('Alt+Esc');
    expect(windowsShortcut('⌘⌫')).toBe('Ctrl+Backspace');
    expect(windowsShortcut('⌘⌦')).toBe('Ctrl+Delete');
    expect(windowsShortcut('⌥␣')).toBe('Alt+Space');
    expect(windowsShortcut('⌘,')).toBe('Ctrl+,');
  });
});

describe('displayShortcut', () => {
  it('leaves the string as it is on macOS', () => {
    setOsForTesting('mac');
    expect(displayShortcut('^⌘S')).toBe('^⌘S');
    expect(displayShortcut('⇧⌘O')).toBe('⇧⌘O');
    expect(displayShortcut(undefined)).toBeUndefined();
  });

  it('shows the Windows form on Windows, and hides a shortcut without one', () => {
    setOsForTesting('windows');
    expect(displayShortcut('^⌘S')).toBe('Ctrl+Alt+S');
    expect(displayShortcut('⌃Tab')).toBe('Ctrl+Tab');
    expect(displayShortcut('⌃⌥⌘S')).toBeUndefined();
    expect(displayShortcut('Delete')).toBe('Delete');
  });
});

describe('recording on Windows', () => {
  beforeEach(() => setOsForTesting('windows'));

  it('records Ctrl as ⌘, Alt as ⌥ and Shift as ⇧', () => {
    expect(comboFromEvent(ev('KeyO', { ctrl: true, shift: true }))).toEqual(combo('⇧⌘O'));
    expect(comboFromEvent(ev('KeyS', { ctrl: true, alt: true }))).toEqual(combo('⌥⌘S'));
  });

  it('refuses the Windows key', () => {
    expect(eventRefusal(ev('KeyE', { meta: true }))).toMatch(/Windows key/);
    expect(eventRefusal(ev('KeyE', { ctrl: true }))).toBeNull();
    setOsForTesting('mac');
    expect(eventRefusal(ev('KeyE', { meta: true }))).toBeNull();
  });

  it('refuses the keys Windows and Backtickle keep, in Windows words', () => {
    expect(refusal(combo('⌘C'))).toBe('Ctrl+C is reserved by Windows and Backtickle.');
    expect(refusal(combo('⌘Q'))).toMatch(/reserved by Windows/);
    expect(refusal(combo('⌘,'))).toMatch(/reserved by Windows/);
    expect(refusal(combo('⌥F4'))).toMatch(/Alt\+F4 is reserved/);
    expect(refusal(combo('⇧K'))).toBe(
      'A shortcut needs Ctrl or Alt with a key, or a function key.',
    );
  });

  it('lets Ctrl+Tab and ⌘H (Ctrl+H) be shortcuts', () => {
    expect(refusal(combo('⌘Tab'))).toBeNull();
    expect(refusal(combo('⌘H'))).toBeNull();
    expect(refusal(combo('F7'))).toBeNull();
  });

  it('finds conflicts by the Windows keys', () => {
    expect(findConflict('⌘S', { save: '⌃S' }, 'other')).toBe('save');
    expect(findConflict('⌥⌘S', { 'toggle-sidebar': '^⌘S' }, 'other')).toBe('toggle-sidebar');
    expect(findConflict('⌘Tab', { 'next-tab': '^Tab' }, 'other')).toBe('next-tab');
    expect(sameShortcut('⌘S', '⌃S')).toBe(true);
    setOsForTesting('mac');
    expect(findConflict('⌘S', { save: '⌃S' }, 'other')).toBeNull();
  });

  it('reports a recorded Ctrl+Alt+S for Show or Hide Sidebar as no change', () => {
    const groups = shortcutGroups({});
    const change = checkChange(groups, 'toggle-sidebar', combo('⌥⌘S'));
    expect(change).toEqual({ kind: 'ok' });
    expect(withShortcut({}, 'toggle-sidebar', '⌥⌘S', '^⌘S')).toEqual({});
  });

  it('finds rows by the keys as Windows shows them', () => {
    const groups = filterShortcuts(shortcutGroups({}), 'ctrl alt s');
    const ids = groups.flatMap((group) => group.rows.map((row) => row.id));
    expect(ids).toContain('toggle-sidebar');
  });
});

describe('toCodeMirrorKey', () => {
  it('keeps the macOS key names on macOS', () => {
    setOsForTesting('mac');
    expect(toCodeMirrorKey('^⌘S')).toBe('Ctrl-Mod-s');
    expect(toCodeMirrorKey('⌃Tab')).toBe('Ctrl-Tab');
  });

  it('uses Mod for Ctrl on Windows and never Ctrl-Mod', () => {
    setOsForTesting('windows');
    expect(toCodeMirrorKey('^⌘S')).toBe('Alt-Mod-s');
    expect(toCodeMirrorKey('⌃Tab')).toBe('Mod-Tab');
    expect(toCodeMirrorKey('⇧⌘K')).toBe('Shift-Mod-k');
    expect(toCodeMirrorKey('⌥↑')).toBe('Alt-ArrowUp');
    expect(toCodeMirrorKey('⌃⌥⌘S')).toBeNull();
  });
});
