/**
 * Snippets in the editor (WP5.5): variables, the trigger completion
 * source and insertion. A lazy chunk: it loads when the Snippets tab is first shown or the first
 * character is typed in the editor, never for the welcome screen or a document that is only read.
 *
 * Variables in a body: `{{date}}` (ISO date), `{{time}}` (HH:MM), `{{selection}}` (the selected
 * text). Nothing else is evaluated; unknown `{{...}}` stays as typed.
 */
import {
  type Completion,
  type CompletionContext,
  type CompletionSource,
  startCompletion,
} from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { getPlatform, type Snippet } from '@/lib/platform';
import { setSnippetImpl } from './complete';
import { currentEditor, setSnippetTriggersOn } from './controller';

const TRIGGER_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const VARIABLE = /\{\{(date|time|selection)\}\}/g;

export function isValidTrigger(trigger: string): boolean {
  return TRIGGER_PATTERN.test(trigger);
}

const two = (n: number) => String(n).padStart(2, '0');

/** The local date as YYYY-MM-DD. */
export function isoDate(now: Date): string {
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

/** The local time as HH:MM. */
export function hourMinute(now: Date): string {
  return `${two(now.getHours())}:${two(now.getMinutes())}`;
}

/** Replaces the three variables in one pass (text put in by a variable is not expanded again). */
export function expandBody(body: string, selection: string, now: Date = new Date()): string {
  return body.replace(VARIABLE, (_match, name: string) => {
    if (name === 'date') return isoDate(now);
    if (name === 'time') return hourMinute(now);
    return selection;
  });
}

/** The snippets that have a valid trigger, in the order of the list. */
export function withTriggers(list: Snippet[]): Snippet[] {
  return list.filter((entry) => isValidTrigger(entry.trigger));
}

const WORD = /[A-Za-z0-9_-]+$/;

/** The completion source for a list: the word before the caret against the triggers. */
export function triggerSource(list: Snippet[]): CompletionSource {
  const triggered = withTriggers(list);
  return (context: CompletionContext) => {
    if (triggered.length === 0 || context.state.readOnly) return null;
    const match = context.matchBefore(WORD);
    if (!match) return null;
    const options: Completion[] = triggered.map((entry) => ({
      label: entry.trigger,
      detail: entry.name,
      type: 'snippet',
      apply: (view, _completion, from, to) => {
        const insert = expandBody(entry.body, '');
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + insert.length },
          scrollIntoView: true,
          userEvent: 'input.complete',
        });
      },
    }));
    return { from: match.from, options, validFor: /^[A-Za-z0-9_-]*$/ };
  };
}

/** Inserts a snippet at the caret, replacing the selection, as one undo step. */
export function insertSnippet(view: EditorView, entry: Snippet, now: Date = new Date()): boolean {
  if (view.state.readOnly) return false;
  const range = view.state.selection.main;
  const insert = expandBody(entry.body, view.state.sliceDoc(range.from, range.to), now);
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from + insert.length },
    scrollIntoView: true,
    userEvent: 'input.snippet',
  });
  view.focus();
  return true;
}

/** Makes the list the one the editor completes from. */
export function useSnippets(list: Snippet[]): void {
  const any = withTriggers(list).length > 0;
  setSnippetImpl(any ? triggerSource(list) : null);
  setSnippetTriggersOn(any);
}

/** Reads the snippets once the first character was typed and registers the triggers. */
export async function activateSnippets(): Promise<void> {
  const platform = await getPlatform();
  const list = await platform.getSnippets();
  useSnippets(list);
  const view = currentEditor()?.view;
  if (view && withTriggers(list).length > 0) startCompletion(view);
}
