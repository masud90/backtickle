/**
 * Autocomplete for the flavors: the `@codemirror/autocomplete` setup, the per-document data the
 * sources read, and three reusable sources (citation keys, cross-reference labels, note names).
 * The flavor modules decide which sources a flavor uses.
 */
import {
  acceptCompletion,
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
  completionStatus,
  selectedCompletion,
} from '@codemirror/autocomplete';
import { type EditorState, type Extension, Prec, StateEffect, StateField } from '@codemirror/state';
import { keymap } from '@codemirror/view';

export interface CitationEntry {
  /** The key typed after `@`. */
  key: string;
  /** What the popup shows beside the key: author and year. */
  label: string;
  /** The title, shown in the info panel. */
  detail?: string;
}

export interface LabelEntry {
  /** The label with its prefix, for example `fig-plot`. */
  key: string;
  label?: string;
}

export interface NoteEntry {
  name: string;
  path: string;
}

/** What the shell knows about the current document that completion needs. */
export interface CompletionData {
  citations?: CitationEntry[];
  labels?: LabelEntry[];
  notes?: NoteEntry[];
  /**
   * The headings of another note, by the name typed after `[[` (Obsidian `[[Note#`). The shell
   * supplies it: it finds the note in the vault index and reads it with `readLinkedText`
   * (purpose `embed`). Absent when the shell has not wired it.
   */
  noteHeadings?: (name: string) => Promise<string[]>;
}

const setData = StateEffect.define<CompletionData>();

/** Per-document data: lives in the document's state, so it comes back with the tab. */
export const completionDataField = StateField.define<CompletionData>({
  create: () => ({}),
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setData)) return effect.value;
    return value;
  },
});

export const setCompletionDataEffect = (data: CompletionData): StateEffect<CompletionData> =>
  setData.of(data);

export function getCompletionData(state: EditorState): CompletionData {
  return state.field(completionDataField, false) ?? {};
}

let snippetImpl: CompletionSource | null = null;

/** The snippet trigger source: a fixed function whose body the lazy snippets module supplies. */
export const snippetSource: CompletionSource = (context) => snippetImpl?.(context) ?? null;

export function setSnippetImpl(source: CompletionSource | null): void {
  snippetImpl = source;
}

/** Tab picks a snippet from the popup (Return is the completion default); other sources keep Tab. */
export const snippetTabKeymap: Extension = Prec.highest(
  keymap.of([
    {
      key: 'Tab',
      run: (view) =>
        completionStatus(view.state) === 'active' &&
        selectedCompletion(view.state)?.type === 'snippet' &&
        acceptCompletion(view),
    },
  ]),
);

/** The popup and its trigger: completion opens while typing; the theme is in `theme.ts`. */
export function completionSetup(sources: CompletionSource[]): Extension {
  if (sources.length === 0) return [];
  return autocompletion({
    override: sources,
    activateOnTyping: true,
    icons: false,
    maxRenderedOptions: 50,
  });
}

// A citation key: letters, digits and these marks (Pandoc manual, "Citations").
const KEY_CHARS = String.raw`[\w:.#$%&\-+?<>~/]`;
const CITATION = new RegExp(`@${KEY_CHARS}*$`);
const LABEL = new RegExp(`@(?:fig|tbl|sec|eq)-${KEY_CHARS}*$`);

/** The `@` must start a word or follow `[`, `;`, `(` or `-` (so e-mail addresses do not match). */
function atStart(context: CompletionContext, at: number): boolean {
  if (at === 0) return true;
  return /[\s[;(-]/.test(context.state.sliceDoc(at - 1, at));
}

/** Citation keys after `@` in text, or after `[`, `[-@`, `;`. */
export const citationSource: CompletionSource = (context) => {
  const match = context.matchBefore(CITATION);
  if (!match || !atStart(context, match.from)) return null;
  const citations = getCompletionData(context.state).citations ?? [];
  if (citations.length === 0) return null;
  const options: Completion[] = citations.map((entry) => ({
    label: entry.key,
    detail: entry.label,
    info: entry.detail,
    type: 'text',
  }));
  return { from: match.from + 1, options, validFor: new RegExp(`^${KEY_CHARS}*$`) };
};

/** Quarto cross-reference labels after `@fig-`, `@tbl-`, `@sec-` and `@eq-`. */
export const labelSource: CompletionSource = (context) => {
  const match = context.matchBefore(LABEL);
  if (!match || !atStart(context, match.from)) return null;
  const labels = getCompletionData(context.state).labels ?? [];
  if (labels.length === 0) return null;
  const options: Completion[] = labels.map((entry) => ({
    label: entry.key,
    detail: entry.label,
    type: 'text',
  }));
  return { from: match.from + 1, options, validFor: new RegExp(`^${KEY_CHARS}*$`) };
};

const NOTE = /!?\[\[[^\]\n|#]*$/;

/** Note names after `[[` and `![[` (the path is shown when two notes share a name). */
export const noteSource: CompletionSource = (context): CompletionResult | null => {
  const match = context.matchBefore(NOTE);
  if (!match) return null;
  const notes = getCompletionData(context.state).notes ?? [];
  if (notes.length === 0) return null;
  const counts = new Map<string, number>();
  for (const note of notes) counts.set(note.name, (counts.get(note.name) ?? 0) + 1);
  const from = match.from + match.text.indexOf('[[') + 2;
  const options: Completion[] = notes.map((note) => ({
    label: note.name,
    detail: (counts.get(note.name) ?? 0) > 1 ? note.path : undefined,
    type: 'text',
    apply: (view, _completion, start, end) => {
      const closed = view.state.sliceDoc(end, end + 2) === ']]';
      view.dispatch({
        changes: { from: start, to: end, insert: closed ? note.name : `${note.name}]]` },
        selection: { anchor: start + note.name.length + 2 },
        userEvent: 'input.complete',
      });
    },
  }));
  return { from, options, validFor: /^[^\]\n|#]*$/ };
};
