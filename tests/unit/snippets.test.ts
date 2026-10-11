import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import {
  expandBody,
  hourMinute,
  insertSnippet,
  isoDate,
  isValidTrigger,
  triggerSource,
  withTriggers,
} from '@/editor/snippets';
import type { Snippet } from '@/lib/platform';
import { draftProblem, withDraft } from '@/shell/snippets/form';

const NOW = new Date(2026, 9, 4, 7, 5, 9); // 4 October 2026, 07:05 local
const snip = (id: string, trigger: string, body = 'b'): Snippet => ({
  id,
  name: `Name ${id}`,
  trigger,
  body,
});

describe('snippet variables', () => {
  it('fills date as ISO, time as HH:MM and selection', () => {
    expect(isoDate(NOW)).toBe('2026-10-04');
    expect(hourMinute(NOW)).toBe('07:05');
    expect(expandBody('{{date}} {{time}} [{{selection}}]', 'picked', NOW)).toBe(
      '2026-10-04 07:05 [picked]',
    );
  });

  it('leaves unknown variables and near misses as typed', () => {
    expect(expandBody('{{name}} {{ date }} {date} {{DATE}} {{date', 'x', NOW)).toBe(
      '{{name}} {{ date }} {date} {{DATE}} {{date',
    );
  });

  it('does not expand variables that came in through the selection', () => {
    expect(expandBody('{{selection}}', '{{date}}', NOW)).toBe('{{date}}');
  });

  it('repeats a variable each time it appears', () => {
    expect(expandBody('{{date}}/{{date}}', '', NOW)).toBe('2026-10-04/2026-10-04');
  });
});

describe('snippet triggers', () => {
  it('accepts letters, digits, - and _ only, up to 32 characters', () => {
    for (const ok of ['a', 'A1', 'my-snip_2', 'x'.repeat(32)])
      expect(isValidTrigger(ok), ok).toBe(true);
    for (const bad of ['', 'has space', 'dot.dot', 'é', 'x'.repeat(33), '@a']) {
      expect(isValidTrigger(bad), bad).toBe(false);
    }
  });

  it('keeps only snippets with a valid trigger', () => {
    expect(
      withTriggers([snip('1', 'a'), snip('2', ''), snip('3', 'b c')]).map((s) => s.id),
    ).toEqual(['1']);
  });

  it('offers the triggers for the word before the caret and replaces that word', () => {
    const list = [snip('1', 'callout', '> {{selection}}|'), snip('2', 'table')];
    const state = EditorState.create({ doc: 'text ca', selection: { anchor: 7 } });
    const result = triggerSource(list)(new CompletionContext(state, 7, false));
    expect(result && 'options' in result ? result.options.map((o) => o.label) : null).toEqual([
      'callout',
      'table',
    ]);
    expect(result && 'from' in result ? result.from : -1).toBe(5);
  });

  it('offers nothing when no snippet has a trigger or the caret is not after a word', () => {
    const state = EditorState.create({ doc: 'a ', selection: { anchor: 2 } });
    expect(triggerSource([snip('1', '')])(new CompletionContext(state, 2, false))).toBeNull();
    expect(triggerSource([snip('1', 'a')])(new CompletionContext(state, 2, false))).toBeNull();
  });

  it('inserting a snippet replaces the selection and is one undo step', () => {
    const view = new EditorView({
      state: EditorState.create({ doc: 'a WORD b', selection: { anchor: 2, head: 6 } }),
    });
    insertSnippet(view, snip('1', '', '[{{selection}}]'), NOW);
    expect(view.state.doc.toString()).toBe('a [WORD] b');
    expect(view.state.selection.main.head).toBe(8);
    view.destroy();
  });
});

describe('snippet form', () => {
  const list = [snip('1', 'one'), snip('2', '')];

  it('needs a name', () => {
    expect(draftProblem({ id: '', name: '  ', trigger: '', body: '' }, list)).toMatch(/name/i);
  });

  it('refuses an invalid trigger and a trigger another snippet has', () => {
    expect(draftProblem({ id: '', name: 'n', trigger: 'a b', body: '' }, list)).toMatch(/trigger/i);
    expect(draftProblem({ id: '', name: 'n', trigger: 'one', body: '' }, list)).toMatch(/Name 1/);
    expect(draftProblem({ id: '1', name: 'n', trigger: 'one', body: '' }, list)).toBeNull();
  });

  it('adds a new snippet at the end and replaces an edited one in place', () => {
    const added = withDraft(list, { id: '', name: ' New ', trigger: ' nw ', body: 'x' });
    expect(added.map((s) => s.name)).toEqual(['Name 1', 'Name 2', 'New']);
    expect(added[2]?.trigger).toBe('nw');
    const edited = withDraft(list, { id: '2', name: 'Edited', trigger: '', body: 'y' });
    expect(edited.map((s) => s.name)).toEqual(['Name 1', 'Edited']);
  });
});
