/**
 * The Keyboard Shortcuts list: menu items grouped as in the menus,
 * from `src/shell/menu-specs.ts` (the command registry's data), plus the editing keys of the
 * editor. Read-only. No imports from CodeMirror or the shell, so the window stays small.
 */
import { EDITOR_KEY_TABLE } from '@/editor/keymap-table';
import type { MenuAction } from '@/lib/platform';
import {
  type Combo,
  canonicalShortcut,
  EDITOR_PREFIX,
  findConflict,
  formatShortcut,
  refusal,
} from '@/lib/shortcut-keys';
import { SPECS } from '@/shell/menu-specs';

export interface ShortcutRow {
  id: string;
  name: string;
  /** Symbols as macOS shows them, for example `⇧⌘O`; empty when the shortcut was removed. */
  keys: string;
  /** The default keys, empty for none. */
  defaultKeys: string;
  /** True when the user changed it from the default (Phase 5). */
  changed: boolean;
  /** False for Settings, Quit and the keys that confirm or leave (Return, Tab, Escape). */
  editable: boolean;
}

export interface ShortcutGroup {
  title: string;
  rows: ShortcutRow[];
}

/** Menu actions by menu, in menu order. Every action with a shortcut must be here (tested). */
export const MENU_GROUPS: ReadonlyArray<{ title: string; actions: readonly MenuAction[] }> = [
  {
    title: 'File',
    actions: [
      'new',
      'open',
      'open-folder',
      'quick-open',
      'close-tab',
      'close-window',
      'save',
      'save-as',
      'export-pdf',
      'print',
    ],
  },
  {
    title: 'Edit',
    actions: [
      'undo',
      'redo',
      'paste-plain',
      'find',
      'find-replace',
      'find-next',
      'find-previous',
      'search-folder',
    ],
  },
  {
    title: 'Format',
    actions: [
      'bold',
      'italic',
      'strikethrough',
      'code',
      'link',
      'quote',
      'bullet-list',
      'numbered-list',
      'task-list',
      'heading-1',
      'heading-2',
      'heading-3',
      'heading-4',
      'heading-5',
      'heading-6',
      'paragraph',
    ],
  },
  {
    title: 'View',
    actions: [
      'command-palette',
      'view-editor',
      'view-split',
      'view-preview',
      'toggle-sidebar',
      'zoom-in',
      'zoom-out',
      'zoom-reset',
    ],
  },
  { title: 'Window', actions: ['next-tab', 'previous-tab'] },
];

/** Menu items that are not `MenuAction`s (Settings and Quit are handled by Rust). */
export const APP_MENU_ROWS: readonly ShortcutRow[] = [
  fixedRow('settings', 'Settings…', '⌘,'),
  fixedRow('quit', 'Quit Writedown', '⌘Q'),
];

function fixedRow(id: string, name: string, keys: string): ShortcutRow {
  return { id, name, keys, defaultKeys: keys, changed: false, editable: false };
}

const SYMBOL_ORDER = ['⌃', '⌥', '⇧', '⌘'];
const KEY_NAMES: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: '↩',
  Tab: '⇥',
  Escape: '⎋',
  Backspace: '⌫',
  Delete: '⌦',
};

/** A CodeMirror key name such as `Shift-Alt-ArrowUp` as macOS symbols (`⌥⇧↑`). */
export function cmKeyToSymbols(key: string): string {
  const parts = key.split('-');
  let last = parts.pop() ?? '';
  if (last === '' && parts.length > 0) {
    last = '-';
    parts.pop();
  }
  const mods = new Set<string>();
  for (const part of parts) {
    if (part === 'Mod' || part === 'Cmd' || part === 'Meta') mods.add('⌘');
    else if (part === 'Ctrl') mods.add('⌃');
    else if (part === 'Alt') mods.add('⌥');
    else if (part === 'Shift') mods.add('⇧');
  }
  const name = KEY_NAMES[last] ?? (last.length === 1 ? last.toUpperCase() : last);
  return SYMBOL_ORDER.filter((symbol) => mods.has(symbol)).join('') + name;
}

/** The registry's `^` for Control becomes the macOS symbol. */
function displayKeys(shortcut: string): string {
  return shortcut.replaceAll('^', '⌃');
}

/** Overrides only: a command id to a shortcut string (canonical) or null for none. */
export type Overrides = Readonly<Record<string, string | null>>;

/** What a row shows: the override, else the default. An empty string is no shortcut. */
function rowFor(
  id: string,
  name: string,
  defaultKeys: string,
  editable: boolean,
  overrides: Overrides | undefined,
): ShortcutRow {
  const has = overrides !== undefined && Object.hasOwn(overrides, id);
  const keys = has ? (overrides[id] ?? '') : defaultKeys;
  return { id, name, keys, defaultKeys, changed: has, editable };
}

export function shortcutGroups(overrides?: Overrides): ShortcutGroup[] {
  const groups: ShortcutGroup[] = [{ title: 'Writedown', rows: [...APP_MENU_ROWS] }];
  for (const { title, actions } of MENU_GROUPS) {
    const rows: ShortcutRow[] = [];
    for (const action of actions) {
      const [label, , shortcut] = SPECS[action];
      if (shortcut === undefined) continue;
      rows.push(rowFor(action, label.replace(/…$/, ''), displayKeys(shortcut), true, overrides));
    }
    groups.push({ title, rows });
  }
  groups.push({
    title: 'Editing',
    rows: EDITOR_KEY_TABLE.map((entry) =>
      rowFor(
        `${EDITOR_PREFIX}${entry.key}`,
        entry.label,
        cmKeyToSymbols(entry.key),
        !entry.fixed && !entry.outside,
        overrides,
      ),
    ),
  });
  return groups;
}

/** The effective shortcut of every row, canonical, by command id (rows without one are left out). */
export function effectiveById(groups: readonly ShortcutGroup[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const group of groups) {
    for (const row of group.rows) {
      const canonical = row.keys === '' ? null : canonicalShortcut(row.keys);
      if (canonical !== null) out[row.id] = canonical;
    }
  }
  return out;
}

export function rowById(groups: readonly ShortcutGroup[], id: string): ShortcutRow | undefined {
  for (const group of groups) {
    const found = group.rows.find((row) => row.id === id);
    if (found) return found;
  }
  return undefined;
}

export type Change =
  | { kind: 'refused'; message: string }
  | { kind: 'conflict'; otherId: string; otherName: string }
  | { kind: 'ok' };

/** Whether `combo` can be the shortcut of `id` now: refused, used by another command, or fine. */
export function checkChange(groups: readonly ShortcutGroup[], id: string, combo: Combo): Change {
  const message = refusal(combo);
  if (message !== null) return { kind: 'refused', message };
  const otherId = findConflict(formatShortcut(combo), effectiveById(groups), id);
  if (otherId === null) return { kind: 'ok' };
  return { kind: 'conflict', otherId, otherName: rowById(groups, otherId)?.name ?? otherId };
}

/** The overrides after `id` takes `shortcut` (null: none); a value equal to the default is no override. */
export function withShortcut(
  overrides: Overrides,
  id: string,
  shortcut: string | null,
  defaultKeys: string,
): Record<string, string | null> {
  const next = { ...overrides };
  const defaultCanonical = defaultKeys === '' ? null : canonicalShortcut(defaultKeys);
  const wanted = shortcut === null ? null : canonicalShortcut(shortcut);
  if (wanted === defaultCanonical) delete next[id];
  else next[id] = wanted;
  return next;
}

const WORD_SYMBOLS: Array<[RegExp, string]> = [
  [/\b(?:cmd|command)\b/g, '⌘'],
  [/\b(?:ctrl|control)\b/g, '⌃'],
  [/\b(?:opt|option|alt)\b/g, '⌥'],
  [/\bshift\b/g, '⇧'],
];

/** Lowercase, words for modifiers become symbols, spaces and plus signs go: `cmd k` is `⌘k`. */
export function normalizeKeys(text: string): string {
  let out = text.toLowerCase().replaceAll('^', '⌃');
  for (const [pattern, symbol] of WORD_SYMBOLS) out = out.replace(pattern, symbol);
  return out.replace(/[\s+]/g, '');
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** Rows whose name contains every word of `query`, or whose keys contain the typed keys. */
export function filterShortcuts(groups: ShortcutGroup[], query: string): ShortcutGroup[] {
  const trimmed = query.trim();
  if (!trimmed) return groups;
  const words = fold(trimmed).split(/\s+/).filter(Boolean);
  const typedKeys = normalizeKeys(trimmed);
  const out: ShortcutGroup[] = [];
  for (const group of groups) {
    const rows = group.rows.filter((row) => {
      const name = fold(`${row.name} ${group.title}`);
      if (words.every((word) => name.includes(word))) return true;
      return normalizeKeys(row.keys).includes(typedKeys);
    });
    if (rows.length > 0) out.push({ title: group.title, rows });
  }
  return out;
}
