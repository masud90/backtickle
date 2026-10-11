/**
 * The editor's key bindings.
 *
 * The macOS menu owns the formatting shortcuts (Cmd+B, Cmd+I, Shift+Cmd+X, Cmd+E, Cmd+K,
 * Option+Cmd+1 to 6 and 0, Shift+Cmd+period, Shift+Cmd+8, 7 and 9;) and routes each one
 * to `EditorController.run`, so the editor, the menu and the toolbar share one path. None of
 * them is bound here. What stays is editing, history, Find, indentation, and the list
 * continuation of the Markdown language (bound at higher precedence by `markdownSupport`).
 */
import { defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap } from '@codemirror/search';
import type { KeyBinding } from '@codemirror/view';
import { EDITOR_PREFIX, toCodeMirrorKey } from '@/lib/shortcut-keys';
import { openFindPanel } from './find';

/**
 * Bindings of CodeMirror's default keymap that collide with a menu shortcut and are dropped.
 * Mod-i is "select parent syntax" there and would swallow Italic. Everything else in the default
 * keymap was checked against and does not collide (see tests/unit/editor-keymap.test.ts).
 */
export const REMOVED_BINDINGS: readonly string[] = ['Mod-i'];

function isRemoved(binding: KeyBinding): boolean {
  return [binding.key, binding.mac, binding.win, binding.linux].some(
    (key) => key !== undefined && REMOVED_BINDINGS.includes(key),
  );
}

/**
 * Find (Cmd+F), Find and Replace (Option+Cmd+F), Find Next and Previous (Cmd+G, Shift+Cmd+G),
 * Escape to close. CodeMirror's search bindings come first so that Escape closes an open find bar
 * before the default Escape collapses the selection.
 */
const findKeymap: readonly KeyBinding[] = [
  { key: 'Mod-f', run: (view) => openFindPanel(view, false), scope: 'editor search-panel' },
  { key: 'Mod-Alt-f', run: (view) => openFindPanel(view, true), scope: 'editor search-panel' },
  ...searchKeymap.filter((binding) => binding.key !== 'Mod-f'),
];

export const editorKeymap: readonly KeyBinding[] = [
  ...findKeymap,
  ...historyKeymap,
  ...defaultKeymap.filter((binding) => !isRemoved(binding)),
  // Tab and Shift-Tab indent and outdent (list items nest). Escape then Tab leaves the editor.
  indentWithTab,
];

/** A CodeMirror key name in one form, so `Shift-Mod-k` and `Mod-Shift-K` compare equal. */
function normalKey(key: string): string {
  const parts = key.split('-');
  let last = parts.pop() ?? '';
  if (last === '' && parts.length > 0) {
    last = '-';
    parts.pop();
  }
  const mods = parts
    .map((part) => (/^(cmd|meta|m)$/i.test(part) ? 'Mod' : part.toLowerCase()))
    .sort();
  return `${mods.join('-')}-${last.length === 1 ? last.toLowerCase() : last}`;
}

/**
 * The editor's bindings with the user's shortcut changes (Phase 5, `editor:<default key>` entries
 * of the `shortcuts` setting): a changed key replaces the default one, a null one removes it.
 * Without any, the same array as `editorKeymap`.
 */
export function editorKeymapWith(
  overrides: Readonly<Record<string, string | null>> | undefined,
): readonly KeyBinding[] {
  const changes = new Map<string, string | null>();
  for (const [id, value] of Object.entries(overrides ?? {})) {
    if (!id.startsWith(EDITOR_PREFIX)) continue;
    const wanted = value === null ? null : toCodeMirrorKey(value);
    if (value !== null && wanted === null) continue;
    changes.set(normalKey(id.slice(EDITOR_PREFIX.length)), wanted);
  }
  if (changes.size === 0) return editorKeymap;
  const out: KeyBinding[] = [];
  for (const binding of editorKeymap) {
    const next: KeyBinding = { ...binding };
    let touched = false;
    for (const field of ['key', 'mac', 'win', 'linux'] as const) {
      const key = binding[field];
      if (key === undefined) continue;
      const change = changes.get(normalKey(key));
      if (change === undefined) continue;
      touched = true;
      if (change === null) delete next[field];
      else next[field] = change;
    }
    if (!touched) out.push(binding);
    else if (next.key || next.mac || next.win || next.linux) out.push(next);
  }
  return out;
}
