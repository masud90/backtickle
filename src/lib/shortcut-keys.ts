/**
 * Shortcut strings: parsing, formatting, recording from a key event,
 * the refusal rules, conflicts, and the CodeMirror key name of a shortcut. Plain data and
 * functions with no imports, so the Preferences window, the shell and the editor can all use it.
 *
 * A shortcut is written as macOS shows it: modifiers in the order Control, Option, Shift, Command,
 * then the key (`⇧⌘O`, `⌃Tab`, `⌥↑`, `F5`). Control may also be written `^`, the registry's form.
 * `src-tauri/src/menu_spec.rs` (`accelerator_for`) reads the same strings for the menu.
 */

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
  return {
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    cmd: event.metaKey,
    key,
  };
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
 * Why a combination cannot be a shortcut, or null when it can: it needs ⌘, ⌃ or ⌥ (function keys
 * excepted), and it must not be one macOS keeps for itself.
 */
export function refusal(combo: Combo): string | null {
  const canonical = formatShortcut(combo);
  if (RESERVED_SHORTCUTS.includes(canonical)) {
    return `${canonical} is reserved by macOS and Writedown.`;
  }
  if (!combo.cmd && !combo.ctrl && !combo.alt && !/^F\d+$/.test(combo.key)) {
    return 'A shortcut needs ⌘, ⌃ or ⌥ with a key, or a function key.';
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

/** The id of another command that has `shortcut`, or null. Compared in canonical form. */
export function findConflict(
  shortcut: string,
  effective: Readonly<Record<string, string | undefined>>,
  exceptId: string,
): string | null {
  const wanted = canonicalShortcut(shortcut);
  if (wanted === null) return null;
  for (const [id, value] of Object.entries(effective)) {
    if (id === exceptId || value === undefined) continue;
    if (canonicalShortcut(value) === wanted) return id;
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

/** A shortcut as a CodeMirror key name (`⇧⌘K` is `Shift-Mod-k`). Null when it does not parse. */
export function toCodeMirrorKey(shortcut: string): string | null {
  const combo = parseShortcut(shortcut);
  if (!combo) return null;
  const parts: string[] = [];
  if (combo.ctrl) parts.push('Ctrl');
  if (combo.alt) parts.push('Alt');
  if (combo.shift) parts.push('Shift');
  if (combo.cmd) parts.push('Mod');
  const key = CM_NAMES[combo.key] ?? (combo.key.length === 1 ? combo.key.toLowerCase() : combo.key);
  parts.push(key);
  return parts.join('-');
}

/** The editor-command ids in the overrides are `editor:<CodeMirror key of the default>`. */
export const EDITOR_PREFIX = 'editor:';
