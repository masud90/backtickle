import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { editorKeymap } from '@/editor/keymap';
import { EDITOR_KEY_TABLE } from '@/editor/keymap-table';
import {
  cmKeyToSymbols,
  filterShortcuts,
  MENU_GROUPS,
  normalizeKeys,
  shortcutGroups,
} from '@/prefs/shortcuts';
import { SPECS } from '@/shell/menu-specs';

const RUST = readFileSync(join(process.cwd(), 'src-tauri/src/menu_spec.rs'), 'utf8');

/** Every `item(id, label, Some("accelerator"), ...)` or `check(...)` of the menu data, as text. */
function rustAccelerators(): Map<string, string> {
  const found = new Map<string, string>();
  const pattern =
    /\b(?:item|check)\(\s*([A-Z_]+|"[a-z0-9-]+")\s*,\s*"[^"]*"\s*,\s*Some\("([^"]+)"\)/g;
  for (const match of RUST.matchAll(pattern)) {
    const rawId = match[1] as string;
    const id = rawId.startsWith('"') ? rawId.slice(1, -1) : rawId;
    found.set(id, match[2] as string);
  }
  return found;
}

/** The menu library's syntax as macOS symbols, in the order Control, Option, Shift, Command. */
function toSymbols(accelerator: string): string {
  const parts = accelerator.split('+');
  const key = parts.pop() as string;
  const mods = new Set(parts);
  let out = '';
  if (mods.has('Ctrl')) out += '⌃';
  if (mods.has('Alt')) out += '⌥';
  if (mods.has('Shift')) out += '⇧';
  if (mods.has('CmdOrCtrl')) out += '⌘';
  return out + (key.length === 1 ? key.toUpperCase() : key);
}

describe('Keyboard Shortcuts against the menu data in menu_spec.rs', () => {
  const rust = rustAccelerators();
  const rows = new Map(shortcutGroups().flatMap((group) => group.rows.map((row) => [row.id, row])));

  it('parses a plausible number of accelerators from the Rust file', () => {
    // 3 sanity anchors that cannot be right by accident.
    expect(rust.get('save')).toBe('CmdOrCtrl+S');
    expect(rust.get('previous-tab')).toBe('Ctrl+Shift+Tab');
    expect(rust.size).toBeGreaterThan(40);
  });

  it('lists every accelerator of the menu, with the same keys', () => {
    const ids = new Map<string, string>([
      ['SETTINGS_ID', 'settings'],
      ['QUIT_ID', 'quit'],
      ['UNDO_ID', 'undo'],
      ['REDO_ID', 'redo'],
    ]);
    for (const [rawId, accelerator] of rust) {
      const id = ids.get(rawId) ?? rawId;
      const row = rows.get(id);
      expect(row, `menu item ${id} is missing from the list`).toBeDefined();
      expect(row?.keys, id).toBe(toSymbols(accelerator));
    }
  });

  it('lists nothing for a menu item without an accelerator, and nothing the menu lacks', () => {
    const menuIds = new Set(
      [...rust.keys()].map(
        (id) =>
          ({ SETTINGS_ID: 'settings', QUIT_ID: 'quit', UNDO_ID: 'undo', REDO_ID: 'redo' })[id] ??
          id,
      ),
    );
    for (const group of shortcutGroups()) {
      if (group.title === 'Editing') continue;
      for (const row of group.rows) expect(menuIds.has(row.id), row.id).toBe(true);
    }
  });

  it('puts every action that has a shortcut in exactly one group', () => {
    const grouped = MENU_GROUPS.flatMap((group) => group.actions);
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const [action, [, , shortcut]] of Object.entries(SPECS)) {
      if (shortcut === undefined) continue;
      expect(grouped, action).toContain(action);
    }
  });
});

describe('editing keys', () => {
  const bound = new Set(
    editorKeymap.flatMap((binding) => [binding.key, binding.mac, binding.linux, binding.win]),
  );

  it('names only keys the editor binds (or the Markdown language binds)', () => {
    for (const entry of EDITOR_KEY_TABLE) {
      if (entry.outside) continue;
      // `Shift-Tab` is the `shift` variant of the `Tab` binding (indentWithTab).
      const shifted = entry.key.startsWith('Shift-') ? entry.key.slice(6) : null;
      const ok =
        bound.has(entry.key) ||
        (shifted !== null && editorKeymap.some((b) => b.key === shifted && b.shift !== undefined));
      expect(ok, entry.key).toBe(true);
    }
  });

  it('writes keys as macOS symbols', () => {
    expect(cmKeyToSymbols('Mod-Alt-g')).toBe('⌥⌘G');
    expect(cmKeyToSymbols('Shift-Alt-ArrowUp')).toBe('⌥⇧↑');
    expect(cmKeyToSymbols('Tab')).toBe('⇥');
    expect(cmKeyToSymbols('Mod-]')).toBe('⌘]');
  });
});

describe('search', () => {
  const all = shortcutGroups();
  const names = (query: string) =>
    filterShortcuts(all, query).flatMap((group) => group.rows.map((row) => row.name));

  it('finds Link by "⌘K" and by "cmd k"', () => {
    expect(names('⌘K')).toContain('Link');
    expect(names('cmd k')).toContain('Link');
    expect(names('command K')).toContain('Link');
  });

  it('finds by name, ignoring case', () => {
    expect(names('QUICK open')).toEqual(['Quick Open']);
  });

  it('normalizes typed keys', () => {
    expect(normalizeKeys('Cmd + Shift + O')).toBe('⌘⇧o');
    expect(normalizeKeys('^⌘S')).toBe('⌃⌘s');
  });

  it('finds nothing for an unknown word', () => {
    expect(names('zzzz')).toEqual([]);
  });
});
