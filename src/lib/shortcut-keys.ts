/**
 * Shortcut strings: parsing, formatting, recording from a key event,
 * the refusal rules, conflicts, and the CodeMirror key name of a shortcut. Plain data and
 * functions that import only the system check, so the Preferences window, the shell and the
 * editor can all use it.
 *
 * A shortcut is written as macOS shows it: modifiers in the order Control, Option, Shift, Command,
 * then the key (`⇧⌘O`, `⌃Tab`, `⌥↑`, `F5`). Control may also be written `^`, the registry's form.
 * `src-tauri/src/menu_spec.rs` (`accelerator_for`) reads the same strings for the menu.
 *
 * Windows keeps the same strings and reads them by the rule the Rust menu uses (`windowsKeys`):
 * ⌘ is Ctrl; ⌃ alone is Ctrl too; ⌃ with ⌘ is Ctrl+Alt; ⌥ is Alt and ⇧ is Shift. A shortcut with
 * ⌃, ⌥ and ⌘ together has no Windows form. Shown, compared and handed to CodeMirror, a shortcut
 * on Windows is always its Windows form, so `^S` and `⌘S` are the same keys there (Ctrl+S).
 */
import { isWindows } from './os';

export interface Combo {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  cmd: boolean;
  /** One upper-case character, or `Tab`, `Enter`, `Escape`, `Backspace`, `Delete`, `Space`, `Up`, `Down`, `Left`, `Right`, `F1` to `F20`. */
  key: string;
}

const NAMED_FROM_SYMBOL: Record<string, string> = {
  '↑': 'Up',
  '↓': 'Down',
  '←': 'Left',
  '→': 'Right',
  '↩': 'Enter',
  '⇥': 'Tab',
  '⎋': 'Escape',
  '⌫': 'Backspace',
  '⌦': 'Delete',
  '␣': 'Space',
};

const SYMBOL_FROM_NAMED: Record<string, string> = {
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  Enter: '↩',
  Escape: '⎋',
  Backspace: '⌫',
  Delete: '⌦',
  Space: '␣',
};

const NAMED_KEYS = new Set([
  'Tab',
  'Enter',
  'Escape',
  'Backspace',
  'Delete',
  'Space',
  'Up',
  'Down',
  'Left',
  'Right',
]);

const MODIFIERS = new Set(['⌃', '^', '⌥', '⇧', '⌘']);

/** Reads a shortcut string. Null when it is not one (no key, two keys, unknown name). */
export function parseShortcut(text: string): Combo | null {
  const combo: Combo = { ctrl: false, alt: false, shift: false, cmd: false, key: '' };
  const chars = [...text.trim()];
  let index = 0;
  while (index < chars.length && MODIFIERS.has(chars[index] as string)) {
    const symbol = chars[index] as string;
    if (symbol === '⌃' || symbol === '^') combo.ctrl = true;
    else if (symbol === '⌥') combo.alt = true;
    else if (symbol === '⇧') combo.shift = true;
    else combo.cmd = true;
    index += 1;
  }
  const rest = chars.slice(index).join('');
  if (rest === '') return null;
  if (NAMED_FROM_SYMBOL[rest]) combo.key = NAMED_FROM_SYMBOL[rest] as string;
  else if (NAMED_KEYS.has(rest)) combo.key = rest;
  else if (/^F([1-9]|1[0-9]|20)$/.test(rest)) combo.key = rest;
  else if ([...rest].length === 1 && !/\s/.test(rest)) combo.key = rest.toUpperCase();
  else return null;
  return combo;
}

/** The canonical string of a combination: `⌃⌥⇧⌘` then the key. */
export function formatShortcut(combo: Combo): string {
  const mods =
    (combo.ctrl ? '⌃' : '') +
    (combo.alt ? '⌥' : '') +
    (combo.shift ? '⇧' : '') +
    (combo.cmd ? '⌘' : '');
  const key = combo.key === 'Tab' ? 'Tab' : (SYMBOL_FROM_NAMED[combo.key] ?? combo.key);
  return mods + key;
}

/** The canonical form of a shortcut string, or null when it does not parse. */
export function canonicalShortcut(text: string): string | null {
  const combo = parseShortcut(text);
  return combo ? formatShortcut(combo) : null;
}

const CODE_KEYS: Record<string, string> = {
  Minus: '-',
  Equal: '=',
  Period: '.',
  Comma: ',',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Backquote: '`',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Tab: 'Tab',
  Escape: 'Escape',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Space: 'Space',
};

export interface KeyEventLike {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/** The combination a key event stands for; null for a bare modifier or a key without a name. */
export function comboFromEvent(event: KeyEventLike): Combo | null {
  let key: string | undefined = CODE_KEYS[event.code];
  if (!key) {
    const letter = /^Key([A-Z])$/.exec(event.code);
    const digit = /^(?:Digit|Numpad)([0-9])$/.exec(event.code);
    if (letter) key = letter[1];
    else if (digit) key = digit[1];
    else if (/^F([1-9]|1[0-9]|20)$/.test(event.code)) key = event.code;
  }
  if (!key) return null;
  if (isWindows()) {
    // Ctrl is recorded as ⌘, the key every default shortcut uses for it; the Windows key is
    // refused before this (`eventRefusal`).
    return { ctrl: false, alt: event.altKey, shift: event.shiftKey, cmd: event.ctrlKey, key };
  }
  return {
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    cmd: event.metaKey,
    key,
  };
}

/** Why a key event cannot be recorded at all, or null: on Windows the Windows key is the system's. */
export function eventRefusal(event: KeyEventLike): string | null {
  if (isWindows() && event.metaKey) return 'The Windows key cannot be part of a shortcut.';
  return null;
}

/** A shortcut's keys on Windows: Ctrl, Alt and Shift, then the key. */
export interface WindowsKeys {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

/**
 * The Windows keys of a combination, by the rule of the Rust menu: ⌘ is Ctrl, ⌃ alone is Ctrl,
 * ⌃ with ⌘ is Ctrl+Alt, ⌥ is Alt, ⇧ is Shift. Null for ⌃⌥⌘ together, which has no Windows form.
 */
export function windowsKeys(combo: Combo): WindowsKeys | null {
  if (combo.ctrl && combo.cmd && combo.alt) return null;
  return {
    ctrl: combo.cmd || combo.ctrl,
    alt: combo.alt || (combo.ctrl && combo.cmd),
    shift: combo.shift,
    key: combo.key,
  };
}

const WINDOWS_KEY_NAMES: Record<string, string> = { Escape: 'Esc' };

/** Windows keys as Windows writes them: `Ctrl+Alt+Shift+S`, `Ctrl+Tab`, `Alt+Up`, `F5`. */
export function formatWindowsKeys(keys: WindowsKeys): string {
  const parts: string[] = [];
  if (keys.ctrl) parts.push('Ctrl');
  if (keys.alt) parts.push('Alt');
  if (keys.shift) parts.push('Shift');
  parts.push(WINDOWS_KEY_NAMES[keys.key] ?? keys.key);
  return parts.join('+');
}

/** The Windows form of a shortcut string (`^⌘S` is `Ctrl+Alt+S`), or null when it has none. */
export function windowsShortcut(text: string): string | null {
  const combo = parseShortcut(text);
  const keys = combo ? windowsKeys(combo) : null;
  return keys ? formatWindowsKeys(keys) : null;
}

/**
 * A shortcut as this system shows it: on macOS the string as it is (`⇧⌘O`), on Windows its
 * Windows form (`Ctrl+Shift+O`). Undefined on Windows for a shortcut that has no Windows form, so
 * it is not shown at all; a string that does not parse is shown as it is.
 */
export function displayShortcut(text: string | undefined): string | undefined {
  if (text === undefined || !isWindows()) return text;
  if (parseShortcut(text) === null) return text;
  return windowsShortcut(text) ?? undefined;
}

/**
 * What two shortcuts are compared by: the canonical string on macOS, the Windows form on Windows
 * (where `^S` and `⌘S` are both Ctrl+S). Null when it does not parse or has no Windows form.
 */
export function shortcutIdentity(text: string): string | null {
  return isWindows() ? windowsShortcut(text) : canonicalShortcut(text);
}

/** True when two shortcut strings are the same keys on this system. */
export function sameShortcut(a: string, b: string): boolean {
  const left = shortcutIdentity(a);
  return left !== null && left === shortcutIdentity(b);
}

/** macOS shortcuts that stay fixed, plus the three clipboard keys. */
export const RESERVED_SHORTCUTS: readonly string[] = [
  '⌘Q',
  '⌘H',
  '⌥⌘H',
  '⌘M',
  '⌘Tab',
  '⌘␣',
  '⌃⌘Q',
  '⌘,',
  '⌘C',
  '⌘X',
  '⌘V',
];

/**
 * The same on Windows, in Windows form: the clipboard keys, Quit, Settings and closing the window.
 * Ctrl+Tab is free: it is Show Next Tab.
 */
export const RESERVED_WINDOWS_SHORTCUTS: readonly string[] = [
  'Ctrl+C',
  'Ctrl+X',
  'Ctrl+V',
  'Ctrl+Q',
  'Ctrl+,',
  'Alt+F4',
];

/**
 * Why a combination cannot be a shortcut, or null when it can: it needs ⌘, ⌃ or ⌥ (function keys
 * excepted), and it must not be one macOS keeps for itself. On Windows the same in Windows terms.
 */
export function refusal(combo: Combo): string | null {
  if (isWindows()) return windowsRefusal(combo);
  const canonical = formatShortcut(combo);
  if (RESERVED_SHORTCUTS.includes(canonical)) {
    return `${canonical} is reserved by macOS and Writedown.`;
  }
  if (!combo.cmd && !combo.ctrl && !combo.alt && !/^F\d+$/.test(combo.key)) {
    return 'A shortcut needs ⌘, ⌃ or ⌥ with a key, or a function key.';
  }
  return null;
}

function windowsRefusal(combo: Combo): string | null {
  const keys = windowsKeys(combo);
  if (keys === null) return 'This combination cannot be used on Windows.';
  const label = formatWindowsKeys(keys);
  if (RESERVED_WINDOWS_SHORTCUTS.includes(label)) {
    return `${label} is reserved by Windows and Writedown.`;
  }
  if (!keys.ctrl && !keys.alt && !/^F\d+$/.test(keys.key)) {
    return 'A shortcut needs Ctrl or Alt with a key, or a function key.';
  }
  return null;
}

/** The effective shortcut of every command: the default unless `overrides` says otherwise. */
export function effectiveShortcuts(
  defaults: Readonly<Record<string, string | undefined>>,
  overrides: Readonly<Record<string, string | null>> | undefined,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...defaults };
  for (const [id, value] of Object.entries(overrides ?? {})) {
    out[id] = value === null ? undefined : value;
  }
  return out;
}

/**
 * The id of another command that has `shortcut`, or null. Compared in canonical form, on Windows
 * in Windows form (`shortcutIdentity`).
 */
export function findConflict(
  shortcut: string,
  effective: Readonly<Record<string, string | undefined>>,
  exceptId: string,
): string | null {
  const wanted = shortcutIdentity(shortcut);
  if (wanted === null) return null;
  for (const [id, value] of Object.entries(effective)) {
    if (id === exceptId || value === undefined) continue;
    if (shortcutIdentity(value) === wanted) return id;
  }
  return null;
}

const CM_NAMES: Record<string, string> = {
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Space: ' ',
};

/**
 * A shortcut as a CodeMirror key name (`⇧⌘K` is `Shift-Mod-k`). Null when it does not parse, or
 * on Windows when it has no Windows form. On Windows Ctrl is `Mod` (`^⌘S` is `Alt-Mod-s`).
 */
export function toCodeMirrorKey(shortcut: string): string | null {
  const combo = parseShortcut(shortcut);
  if (!combo) return null;
  const parts: string[] = [];
  if (isWindows()) {
    const keys = windowsKeys(combo);
    if (!keys) return null;
    if (keys.alt) parts.push('Alt');
    if (keys.shift) parts.push('Shift');
    if (keys.ctrl) parts.push('Mod');
  } else {
    if (combo.ctrl) parts.push('Ctrl');
    if (combo.alt) parts.push('Alt');
    if (combo.shift) parts.push('Shift');
    if (combo.cmd) parts.push('Mod');
  }
  const key = CM_NAMES[combo.key] ?? (combo.key.length === 1 ? combo.key.toLowerCase() : combo.key);
  parts.push(key);
  return parts.join('-');
}

/** The editor-command ids in the overrides are `editor:<CodeMirror key of the default>`. */
export const EDITOR_PREFIX = 'editor:';
