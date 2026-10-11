/**
 * Helpers for the commands of the Insert menu. Each one changes the document with a single
 * dispatch, so it is one undo step, and refuses to run in a read-only editor.
 */
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/**
 * Wraps every selected range in `before` and `after` and keeps the text selected. A caret gets
 * `before + placeholder + after`, with the placeholder selected (or the caret between the marks
 * when there is no placeholder).
 */
export function wrapSelection(
  view: EditorView,
  before: string,
  after: string,
  placeholder = '',
): boolean {
  if (view.state.readOnly) return false;
  const spec = view.state.changeByRange((range) => {
    if (range.empty) {
      const start = range.from + before.length;
      return {
        changes: { from: range.from, insert: before + placeholder + after },
        range: EditorSelection.range(start, start + placeholder.length),
      };
    }
    const text = view.state.sliceDoc(range.from, range.to);
    return {
      changes: { from: range.from, to: range.to, insert: before + text + after },
      range: EditorSelection.range(
        range.from + before.length,
        range.from + before.length + text.length,
      ),
    };
  });
  view.dispatch(view.state.update(spec, { userEvent: 'input', scrollIntoView: true }));
  return true;
}

/** Which part of an inserted block to select afterwards, as offsets into the block text. */
export interface BlockSelection {
  from: number;
  to?: number;
}

/**
 * Inserts a block on its own lines, set off by a blank line from the text around it. On a blank
 * line it replaces the line's blank space; on a line with text it goes after that line. The
 * block text should not end with a newline. Selects `select` (offsets into `text`), or puts the
 * caret after the block.
 */
export function insertBlock(view: EditorView, text: string, select?: BlockSelection): boolean {
  if (view.state.readOnly) return false;
  const { doc, selection } = view.state;
  const line = doc.lineAt(selection.main.head);
  const blank = line.text.trim() === '';
  const from = blank ? line.from : line.to;
  const before = blank
    ? line.number > 1 && doc.line(line.number - 1).text.trim() !== ''
      ? '\n'
      : ''
    : '\n\n';
  const hasNext = line.number < doc.lines;
  // The line's own terminator follows the block, so one more newline makes the blank line.
  const after = hasNext && doc.line(line.number + 1).text.trim() !== '' ? '\n' : '';
  const start = from + before.length;
  const range = select
    ? EditorSelection.range(start + select.from, start + (select.to ?? select.from))
    : EditorSelection.cursor(start + text.length);
  view.dispatch({
    changes: { from, to: line.to, insert: before + text + after },
    selection: range,
    userEvent: 'input',
    scrollIntoView: true,
  });
  return true;
}

/** Inserts `text` at the caret (replacing a selection) and selects `select` within it. */
export function insertInline(view: EditorView, text: string, select?: BlockSelection): boolean {
  if (view.state.readOnly) return false;
  const main = view.state.selection.main;
  const range = select
    ? EditorSelection.range(main.from + select.from, main.from + (select.to ?? select.from))
    : EditorSelection.cursor(main.from + text.length);
  view.dispatch({
    changes: { from: main.from, to: main.to, insert: text },
    selection: range,
    userEvent: 'input',
    scrollIntoView: true,
  });
  return true;
}
