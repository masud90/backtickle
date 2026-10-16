import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { byOs, isLinux, isMac, isWindows, markDocumentOs, osName, setOsForTesting } from '@/lib/os';
import { fileUrl, isAbsolutePath, joinPath, parentFolder, pathRoot, samePath } from '@/lib/paths';
import {
  comboFromEvent,
  displayShortcut,
  eventRefusal,
  findConflict,
  parseShortcut,
  refusal,
  toCodeMirrorKey,
} from '@/lib/shortcut-keys';
import { filterShortcuts, normalizeKeys, shortcutGroups } from '@/prefs/shortcuts';
import { classifyHref } from '@/preview/events';
import { classifyImageSource } from '@/preview/images';
import { applyVibrancy } from '@/shell/appearance';
import { nameProblem } from '@/shell/files/tree';
import { DEFAULT_SETTINGS_FOR_TESTS } from './a11y-helpers';

/*
 * Linux (WebKitGTK): the window chrome and the shortcut keys of Windows, the paths and the file
 * names of macOS, and no material behind the sidebar.
 */

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

describe('telling the systems apart', () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
  const withUserAgent = (value: string) => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value });
  };

  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'userAgent', original);
    else delete (navigator as { userAgent?: unknown }).userAgent;
  });

  it('reads Linux from the WebKitGTK user agent', () => {
    withUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    );
    expect(osName()).toBe('linux');
    expect(isLinux()).toBe(true);
    expect(isWindows()).toBe(false);
    expect(isMac()).toBe(false);
  });

  it('reads Linux from a user agent without X11', () => {
    withUserAgent('Mozilla/5.0 (Wayland; Linux aarch64) AppleWebKit/605.1.15 (KHTML, like Gecko)');
    expect(osName()).toBe('linux');
  });

  it('reads Windows and macOS as before', () => {
    withUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    );
    expect(osName()).toBe('windows');
    expect(isWindows()).toBe(true);
    withUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
    );
    expect(osName()).toBe('mac');
    expect(isMac()).toBe(true);
  });

  it('marks the document with data-os="linux"', () => {
    setOsForTesting('linux');
    markDocumentOs();
    expect(document.documentElement.dataset.os).toBe('linux');
    delete document.documentElement.dataset.os;
  });
});

describe('byOs', () => {
  it('takes the Linux form on Linux', () => {
    setOsForTesting('linux');
    expect(byOs('Finder', 'File Explorer', 'File Manager')).toBe('File Manager');
  });

  it('takes the Windows form on Linux when there is no Linux form', () => {
    setOsForTesting('linux');
    expect(byOs('⌘⌫', 'Delete')).toBe('Delete');
  });

  it('keeps the macOS and the Windows forms', () => {
    setOsForTesting('mac');
    expect(byOs('Finder', 'File Explorer', 'File Manager')).toBe('Finder');
    setOsForTesting('windows');
    expect(byOs('Finder', 'File Explorer', 'File Manager')).toBe('File Explorer');
  });
});

describe('shortcuts on Linux (as on Windows)', () => {
  beforeEach(() => setOsForTesting('linux'));

  it('shows the Ctrl form, and hides a shortcut without one', () => {
    expect(displayShortcut('⇧⌘O')).toBe('Ctrl+Shift+O');
    expect(displayShortcut('^⌘S')).toBe('Ctrl+Alt+S');
    expect(displayShortcut('⌃⌥⌘S')).toBeUndefined();
  });

  it('records Ctrl as ⌘ and refuses the Super key', () => {
    expect(comboFromEvent(ev('KeyO', { ctrl: true, shift: true }))).toEqual(combo('⇧⌘O'));
    expect(eventRefusal(ev('KeyE', { meta: true }))).toBe(
      'The Super key cannot be part of a shortcut.',
    );
    expect(eventRefusal(ev('KeyE', { ctrl: true }))).toBeNull();
  });

  it('refuses the reserved keys in Linux words', () => {
    expect(refusal(combo('⌘C'))).toBe('Ctrl+C is reserved by the system and Writedown.');
    expect(refusal(combo('⌥F4'))).toMatch(/Alt\+F4 is reserved/);
    expect(refusal(combo('⌃⌥⌘S'))).toBe('This combination cannot be used on Linux.');
    expect(refusal(combo('⇧K'))).toBe(
      'A shortcut needs Ctrl or Alt with a key, or a function key.',
    );
    expect(refusal(combo('⌘H'))).toBeNull();
  });

  it('finds conflicts by the Ctrl keys', () => {
    expect(findConflict('⌘S', { save: '⌃S' }, 'other')).toBe('save');
  });

  it('uses Mod for Ctrl in CodeMirror', () => {
    expect(toCodeMirrorKey('^⌘S')).toBe('Alt-Mod-s');
    expect(toCodeMirrorKey('⌃Tab')).toBe('Mod-Tab');
  });

  it('searches the list by the words it shows', () => {
    expect(normalizeKeys('Ctrl + S')).toBe('ctrls');
    const groups = filterShortcuts(shortcutGroups({}), 'ctrl alt s');
    const ids = groups.flatMap((group) => group.rows.map((row) => row.id));
    expect(ids).toContain('toggle-sidebar');
  });
});

describe('paths on Linux (as on macOS)', () => {
  beforeEach(() => setOsForTesting('linux'));

  it('has only the root /', () => {
    expect(pathRoot('/home/a/b.md')).toBe('/');
    expect(pathRoot('C:/Users/a.md')).toBe('');
    expect(isAbsolutePath('C:/Users/a.md')).toBe(false);
    expect(parentFolder('/home/a/b.md')).toBe('/home/a');
    expect(parentFolder('/b.md')).toBe('/');
    expect(joinPath('/home/a/notes', '../img/x.png')).toBe('/home/a/img/x.png');
    expect(fileUrl('/home/a/my notes.md')).toBe('file:///home/a/my%20notes.md');
  });

  it('compares paths with their case', () => {
    expect(samePath('/home/a/Notes.md', '/home/a/Notes.md')).toBe(true);
    expect(samePath('/home/a/Notes.md', '/home/a/notes.md')).toBe(false);
  });

  it('reads C:/ as a scheme, not a drive', () => {
    expect(classifyHref('C:/a.md')).toBe('external');
    expect(classifyImageSource('C:/a.png')).toBe('blocked');
    expect(classifyImageSource('/home/a/a.png')).toBe('local');
  });
});

describe('file names on Linux (the macOS rules)', () => {
  beforeEach(() => setOsForTesting('linux'));

  it('refuses / and : and a leading dot', () => {
    expect(nameProblem('a/b.md')).toBe('A name cannot contain "/" or ":".');
    expect(nameProblem('a:b.md')).toBe('A name cannot contain "/" or ":".');
    expect(nameProblem('.hidden.md')).toBe('A name cannot start with a dot.');
  });

  it('allows the names only Windows refuses', () => {
    expect(nameProblem('CON.md')).toBeNull();
    expect(nameProblem('what?.md')).toBeNull();
    expect(nameProblem('a <b>.md')).toBeNull();
    expect(nameProblem('ends with dot.')).toBeNull();
  });
});

describe('applyVibrancy on Linux', () => {
  const settings = DEFAULT_SETTINGS_FOR_TESTS();

  beforeEach(() => {
    setOsForTesting('linux');
    document.body.dataset.platform = 'tauri';
  });

  it('keeps the sidebar opaque with the setting on', async () => {
    const el = document.createElement('html');
    applyVibrancy(el, { ...settings, vibrancy: true });
    expect(el.dataset.vibrancy).toBeUndefined();
    await Promise.resolve();
    await Promise.resolve();
    expect(el.dataset.vibrancy).toBeUndefined();
  });

  it('takes the material away that was on', () => {
    const el = document.createElement('html');
    el.dataset.vibrancy = 'on';
    applyVibrancy(el, { ...settings, vibrancy: true });
    expect(el.dataset.vibrancy).toBeUndefined();
  });
});
