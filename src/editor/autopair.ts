/**
 * Auto-pairing (`editor.autoPair`): brackets, quotes and backticks through CodeMirror's
 * `closeBrackets`, plus `**` and `__` pairs. Never inside a code block, an HTML block or the
 * frontmatter: there the typed character is inserted as it is.
 */
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { EditorSelection, EditorState, type Extension, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { insideCode } from './syntax';

const BRACKETS = ['(', '[', '{', "'", '"', '`'];
const TRIGGERS = new Set([...BRACKETS, ')', ']', '}', '*', '_']);
const WORD = /[\p{L}\p{N}]/u;

/** Whether `pos` is in the `---` ... `---` block at the top of the document. */
export function insideFrontmatter(state: EditorState, pos: number): boolean {
  const { doc } = state;
  if (doc.line(1).text.trimEnd() !== '---') return false;
  for (let number = 2; number <= doc.lines; number++) {
    const line = doc.line(number);
    const text = line.text.trimEnd();
    if (text === '---' || text === '...') return pos <= line.to;
  }
  return false;
}

/** Inside code, or at the end of a code block that is still open (the caret sits past its last character). */
function inCode(state: EditorState, pos: number): boolean {
  return insideCode(state, pos) || (pos > 0 && insideCode(state, pos - 1));
}

function plainInsert(view: EditorView, text: string): boolean {
  view.dispatch(
    view.state.update(view.state.replaceSelection(text), {
      scrollIntoView: true,
      userEvent: 'input.type',
    }),
  );
  return true;
}

const pairs = Prec.highest(
  EditorView.inputHandler.of((view, from, to, text) => {
    if (text.length !== 1 || !TRIGGERS.has(text) || view.state.readOnly) return false;
    const { state } = view;
    if (inCode(state, from) || insideFrontmatter(state, from)) return plainInsert(view, text);
    if ((text !== '*' && text !== '_') || from !== to || state.selection.ranges.length > 1) {
      return false;
    }
    const prev = state.sliceDoc(from - 1, from);
    const next = state.sliceDoc(from, from + 1);
    // Typing the closing half of an auto-paired `**` or `__` steps over it.
    if (next === text && (prev === text || state.sliceDoc(from + 1, from + 2) === text)) {
      view.dispatch({
        selection: EditorSelection.cursor(from + 1),
        scrollIntoView: true,
        userEvent: 'input.type',
      });
      return true;
    }
    // The second `*` or `_` of an opening pair: `**|**`.
    if (prev === text && from >= 1) {
      const beforePrev = state.sliceDoc(from - 2, from - 1);
      if (beforePrev === text || (text === '_' && WORD.test(beforePrev))) return false;
      view.dispatch({
        changes: { from, insert: text.repeat(3) },
        selection: EditorSelection.cursor(from + 1),
        scrollIntoView: true,
        userEvent: 'input.type',
      });
      return true;
    }
    return false;
  }),
);

export const autoPairOn: Extension = [
  closeBrackets(),
  keymap.of(closeBracketsKeymap),
  // closeBrackets reads its brackets from the language data; Markdown adds the backtick.
  EditorState.languageData.of(() => [{ closeBrackets: { brackets: BRACKETS } }]),
  pairs,
];

export const autoPairOff: Extension = [];
