/**
 * Helpers for the editor tests. Documents and expectations are written as text with the
 * selection marked inline: `«text»` is a selected range and `‸` is a caret, so a test reads as
 * "this document, this selection, this command, that document, that selection".
 */
import { undo } from '@codemirror/commands';
import {
  EditorSelection,
  type EditorState,
  type Transaction,
  type TransactionSpec,
} from '@codemirror/state';
import { EditorController, type FlavorId } from '@/editor/controller';

const START = '«';
const END = '»';
const CARET = '‸';

export interface Marked {
  text: string;
  anchor: number;
  head: number;
}

/** Splits a marked document into its text and selection (a caret at 0 when nothing is marked). */
export function parseMarked(marked: string): Marked {
  const start = marked.indexOf(START);
  if (start >= 0) {
    const withoutStart = marked.replace(START, '');
    const end = withoutStart.indexOf(END);
    if (end < 0) throw new Error(`Unclosed selection in ${JSON.stringify(marked)}`);
    return { text: withoutStart.replace(END, ''), anchor: start, head: end };
  }
  const caret = marked.indexOf(CARET);
  if (caret >= 0) return { text: marked.replace(CARET, ''), anchor: caret, head: caret };
  return { text: marked, anchor: 0, head: 0 };
}

/** The text of a state with its main selection marked. */
export function renderMarked(state: EditorState): string {
  const text = state.doc.toString();
  const { from, to, empty } = state.selection.main;
  if (empty) return text.slice(0, from) + CARET + text.slice(from);
  return text.slice(0, from) + START + text.slice(from, to) + END + text.slice(to);
}

/** A state for a marked document, with the same extensions as the editor. */
export function stateOf(marked: string, flavor: FlavorId = 'gfm'): EditorState {
  const { text, anchor, head } = parseMarked(marked);
  const state = EditorController.createState(text, flavor);
  return state.update({ selection: EditorSelection.single(anchor, head) }).state;
}

export type Command = (state: EditorState) => TransactionSpec | null;

/** Runs a command on a marked document and returns the marked result, or null for no change. */
export function apply(marked: string, command: Command, flavor: FlavorId = 'gfm'): string | null {
  const state = stateOf(marked, flavor);
  const spec = command(state);
  return spec ? renderMarked(state.update(spec).state) : null;
}

/** A state that runs transactions, to test undo without a view. */
export class StateRunner {
  state: EditorState;

  constructor(marked: string, flavor: FlavorId = 'gfm') {
    this.state = stateOf(marked, flavor);
  }

  run(command: Command): boolean {
    const spec = command(this.state);
    if (!spec) return false;
    this.state = this.state.update(spec).state;
    return true;
  }

  /** Types text at the caret the way the input handler does (joins into one undo group). */
  type(text: string): void {
    const at = this.state.selection.main.head;
    this.state = this.state.update({
      changes: { from: at, insert: text },
      selection: { anchor: at + text.length },
      userEvent: 'input.type',
    }).state;
  }

  /** Moves the caret to the end of the document. */
  moveToEnd(): void {
    this.state = this.state.update({ selection: { anchor: this.state.doc.length } }).state;
  }

  undo(): boolean {
    return undo({
      state: this.state,
      dispatch: (transaction: Transaction) => {
        this.state = transaction.state;
      },
    });
  }

  get marked(): string {
    return renderMarked(this.state);
  }

  get text(): string {
    return this.state.doc.toString();
  }
}
