/**
 * D08: the Keyboard Shortcuts list names every menu accelerator
 * of src-tauri/src/menu_spec.rs and every binding of the editor keymap. The Rust file is parsed
 * here with its own pattern (every `Some("...")` accelerator) and compared as symbols.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { editorKeymap } from '@/editor/keymap';
import { cmKeyToSymbols, shortcutGroups } from '@/prefs/shortcuts';

const RUST = readFileSync(join(process.cwd(), 'src-tauri/src/menu_spec.rs'), 'utf8');

function symbols(accelerator: string): string {
  const parts = accelerator.split('+');
  const key = parts.pop() as string;
  const order: Array<[string, string]> = [
    ['Ctrl', '⌃'],
    ['Alt', '⌥'],
    ['Shift', '⇧'],
    ['CmdOrCtrl', '⌘'],
  ];
  const named: Record<string, string> = { Up: '↑', Down: '↓' };
  return (
    order
      .filter(([name]) => parts.includes(name))
      .map(([, s]) => s)
      .join('') + (named[key] ?? (key.length === 1 ? key.toUpperCase() : key))
  );
}

const menuKeys = [...RUST.matchAll(/Some\("((?:Ctrl|Alt|Shift|CmdOrCtrl)\+[^"]+)"\)/g)].map((m) =>
  symbols(m[1] as string),
);
const groups = shortcutGroups();
const listed = groups
  .filter((g) => g.title !== 'Editing')
  .flatMap((g) => g.rows.map((r) => r.keys));
const editing = groups.find((g) => g.title === 'Editing');

describe('D08 menu accelerators', () => {
  it('parses the Rust data', () => {
    expect(menuKeys.length).toBeGreaterThan(40);
  });

  it('D08 the list holds exactly the accelerators of the menu (same multiset)', () => {
    const sort = (list: string[]) => [...list].sort();
    expect(sort(listed)).toEqual(sort(menuKeys));
  });

  it('D08 no two menu rows share keys', () => {
    expect(new Set(listed).size).toBe(listed.length);
  });
});

describe('D08 editor keymap', () => {
  it('D08 has an Editing group', () => {
    expect(editing?.rows.length ?? 0).toBeGreaterThan(5);
  });

  it('D08 every row names a key the editor keymap or the Markdown language binds', () => {
    const bound = new Set(
      editorKeymap.flatMap((b) => [b.key, b.mac, b.linux, b.win]).filter(Boolean) as string[],
    );
    const symbolsBound = new Set([...bound].map((key) => cmKeyToSymbols(key)));
    // Enter (list continuation) is bound by the Markdown language, not by editorKeymap.
    const outside = new Set(['↩']);
    // Shift-Tab is the shift variant of the Tab binding.
    const unbound = (editing?.rows ?? [])
      .map((r) => r.keys)
      .filter((keys) => !symbolsBound.has(keys) && !outside.has(keys) && keys !== '⇧⇥');
    expect(unbound).toEqual([]);
  });
});
