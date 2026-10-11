/**
 * Return and Backspace in lists, quotes and task items.
 *
 * The Markdown language continues lists, quotes and bullet task items (`- [ ] text`) on Return,
 * ends them on an empty item, and takes a marker away on Backspace. Two things are added here:
 *
 * - An empty item always ends its list. The language's own Return turns a two-item list with an
 *   empty second item into a loose list instead (a blank line between the items), which needs a
 *   second Return to end; `nonTightLists: false` turns that off.
 * - Ordered task items (`1. [ ] text`): the language does not know their box, so Return would
 *   continue with a plain `2. ` and an empty `1. [ ] ` would not end.
 * - An empty quote line ends the quote. The language only ends it after two empty quote lines
 *   (an empty `>` line is a paragraph break there); `endEmptyQuote` ends one quote level at once.
 */
import {
  deleteMarkupBackward,
  insertNewlineContinueMarkupCommand,
} from '@codemirror/lang-markdown';
import { ChangeSet, EditorSelection, Prec } from '@codemirror/state';
import { type Command, keymap } from '@codemirror/view';
import { insideCode } from './syntax';

/** The Markdown language's Return, with an empty item always ending its list. */
const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });

/** The start of an ordered task item: prefix (group 1), number, delimiter, spaces, box, spaces. */
const ORDERED_TASK = /^([ \t]*(?:>[ \t]?)*[ \t]*)\d{1,9}[.)][ \t]+\[[ xX]\](?:[ \t]+|$)/;

/**
 * Return after the text of an ordered task item starts the next item with an open box; on an item
 * with no text it takes the marker away, which ends the list. Returns false for anything else,
 * so the Markdown language's own Return handles it.
 */
export const continueOrderedTask: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  if (state.readOnly || state.selection.ranges.length > 1 || !range.empty) return false;
  const line = state.doc.lineAt(range.head);
  const match = ORDERED_TASK.exec(line.text);
  if (!match || range.head - line.from < match[0].length || insideCode(state, range.head)) {
    return false;
  }

  if (range.head === line.to && line.text.slice(match[0].length).trim() === '') {
    const from = line.from + (match[1] ?? '').length;
    view.dispatch({
      changes: { from, to: line.to },
      selection: EditorSelection.cursor(from),
      scrollIntoView: true,
      userEvent: 'delete',
    });
    return true;
  }

  // The Markdown language builds the new item (numbering, indentation, quote marks); the box is
  // added to the same transaction so the whole Return is one undo step.
  return continueMarkup({
    state,
    dispatch: (transaction) => {
      const at = transaction.newSelection.main.head;
      const box = ChangeSet.of({ from: at, insert: '[ ] ' }, transaction.newDoc.length);
      view.dispatch({
        changes: transaction.changes.compose(box),
        selection: EditorSelection.cursor(at + 4),
        scrollIntoView: true,
        userEvent: 'input',
      });
    },
  });
};

/** A line of only optional indentation and one or more quote markers. */
const EMPTY_QUOTE = /^[ \t]*(?:>[ \t]*)+$/;

/**
 * Return at the end of a line with nothing but quote markers (`> `, `> > `) ends one quote level:
 * the last `>` and the whitespace after it are removed and no newline is inserted. Returns false
 * for anything else, so the Markdown language's own Return handles it.
 */
export const endEmptyQuote: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  if (state.readOnly || state.selection.ranges.length > 1 || !range.empty) return false;
  const line = state.doc.lineAt(range.head);
  if (range.head !== line.to || !EMPTY_QUOTE.test(line.text) || insideCode(state, range.head)) {
    return false;
  }
  const from = line.from + line.text.lastIndexOf('>');
  view.dispatch({
    changes: { from, to: line.to },
    selection: EditorSelection.cursor(from),
    scrollIntoView: true,
    userEvent: 'delete',
  });
  return true;
};

/** Backspace right after the marker of an ordered task item takes the whole marker away. */
export const deleteOrderedTaskMarker: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  if (state.readOnly || state.selection.ranges.length > 1 || !range.empty) return false;
  const line = state.doc.lineAt(range.head);
  const match = ORDERED_TASK.exec(line.text);
  if (!match || range.head - line.from !== match[0].length || insideCode(state, range.head)) {
    return false;
  }
  const from = line.from + (match[1] ?? '').length;
  view.dispatch({
    changes: { from, to: range.head },
    selection: EditorSelection.cursor(from),
    scrollIntoView: true,
    userEvent: 'delete.backward',
  });
  return true;
};

/**
 * Return and Backspace for the editor: the ordered task commands first, then the Markdown
 * language's own. Whatever none of them handles falls through to the default keymap.
 */
export const listKeymap = [
  Prec.highest(
    keymap.of([
      { key: 'Enter', run: continueOrderedTask },
      { key: 'Enter', run: endEmptyQuote },
      { key: 'Backspace', run: deleteOrderedTaskMarker },
    ]),
  ),
  Prec.high(
    keymap.of([
      { key: 'Enter', run: continueMarkup },
      { key: 'Backspace', run: deleteMarkupBackward },
    ]),
  ),
];
