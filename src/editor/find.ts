/**
 * The find bar. CodeMirror's search panel does the work; this adds the two entry points the
 * menu needs (Find, and Find and Replace) on top of it.
 */
import { openSearchPanel } from '@codemirror/search';
import type { EditorView } from '@codemirror/view';

/** Set on the panel when it was opened for Find and Replace: the theme then shows the replace row. */
export const REPLACE_MODE_CLASS = 'wd-replace';

/**
 * Opens the find bar, or moves focus into it when it is already open. With `replace` the replace
 * row is shown and focused; without it only the find row is shown. A read-only editor has no
 * replace row, so it always opens as plain find.
 */
export function openFindPanel(view: EditorView, replace: boolean): boolean {
  openSearchPanel(view);
  const panel = view.dom.querySelector<HTMLElement>('.cm-search');
  if (!panel) return false;
  const withReplace = replace && !view.state.readOnly;
  panel.classList.toggle(REPLACE_MODE_CLASS, withReplace);
  const field = panel.querySelector<HTMLInputElement>(
    withReplace ? 'input[name=replace]' : 'input[name=search]',
  );
  field?.focus();
  field?.select();
  return true;
}
