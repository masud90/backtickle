/**
 * The editing keys of the editor, with names, for the Keyboard Shortcuts list in Preferences.
 * Plain data with no imports, so the Preferences window does not load CodeMirror.
 * `tests/unit/prefs-shortcuts.test.ts` checks that every `key` is a binding of `editorKeymap`
 * (or, with `outside`, of the Markdown language's own keymap) so the list cannot name a key the
 * editor does not have. The formatting shortcuts are menu items and are listed from the menu.
 */
export interface EditorKeyEntry {
  /** CodeMirror key name, for example `Mod-Alt-g`. */
  key: string;
  label: string;
  /** True when the binding lives outside `editorKeymap` (the Markdown language bindings). */
  outside?: boolean;
  /** True when the key cannot be changed in Preferences (the keys that leave or confirm). */
  fixed?: boolean;
}

export const EDITOR_KEY_TABLE: readonly EditorKeyEntry[] = [
  { key: 'Enter', fixed: true, label: 'Continue the list or quote', outside: true },
  { key: 'Tab', fixed: true, label: 'Indent' },
  { key: 'Shift-Tab', fixed: true, label: 'Outdent' },
  { key: 'Escape', fixed: true, label: 'Then Tab or Shift-Tab: leave the editor' },
  { key: 'Shift-Alt-m', label: 'Let Tab leave the editor (on or off)' },
  { key: 'Mod-]', label: 'Indent line' },
  { key: 'Mod-[', label: 'Outdent line' },
  { key: 'Alt-ArrowUp', label: 'Move line up' },
  { key: 'Alt-ArrowDown', label: 'Move line down' },
  { key: 'Shift-Alt-ArrowUp', label: 'Copy line up' },
  { key: 'Shift-Alt-ArrowDown', label: 'Copy line down' },
  { key: 'Shift-Mod-k', label: 'Delete line' },
  { key: 'Mod-Enter', label: 'Insert a blank line below' },
  { key: 'Mod-d', label: 'Select the next occurrence' },
  { key: 'Mod-Shift-l', label: 'Select all occurrences' },
  { key: 'Mod-Alt-g', label: 'Go to line' },
  { key: 'Mod-u', label: 'Undo the last selection' },
  { key: 'Mod-a', label: 'Select all' },
];
