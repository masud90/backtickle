/** WP4.2 editor settings on the real controller. */
import { indentMore, undo } from '@codemirror/commands';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorController } from '@/editor/controller';
import { EDITOR_FONTS, editorMetrics } from '@/shell/appearance';

const mounted: EditorController[] = [];
afterEach(() => {
  for (const controller of mounted.splice(0)) controller.destroy();
  document.body.replaceChildren();
});

function mount(doc: string, caret: number = doc.length) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const controller = new EditorController({
    parent,
    doc,
    onChange: () => {},
    onCursor: () => {},
  });
  mounted.push(controller);
  controller.view.dispatch({ selection: EditorSelection.cursor(caret) });
  return controller;
}

/** Types one character the way the browser does: input handlers first, then the plain insert. */
function type(controller: EditorController, text: string): void {
  const { view } = controller;
  for (const char of text) {
    const { from, to } = view.state.selection.main;
    const handled = view.state
      .facet(EditorView.inputHandler)
      .some((handler) =>
        handler(view, from, to, char, () =>
          view.state.update({ changes: { from, to, insert: char } }),
        ),
      );
    if (!handled) {
      view.dispatch(
        view.state.update({
          changes: { from, to, insert: char },
          selection: EditorSelection.cursor(from + char.length),
          userEvent: 'input.type',
        }),
      );
    }
  }
}

function enter(controller: EditorController): void {
  const { view } = controller;
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  view.contentDOM.dispatchEvent(event);
}

const text = (controller: EditorController) => controller.getState().doc.toString();

describe('D11 line height and font', () => {
  it('the line height setting is a multiple of the font size', () => {
    expect(editorMetrics(13, 1)).toEqual({ font: 13, line: 22 });
    expect(editorMetrics(13, 1, 1.7)).toEqual({ font: 13, line: 22 });
    expect(editorMetrics(20, 1, 2)).toEqual({ font: 20, line: 40 });
    expect(editorMetrics(10, 2, 1.2)).toEqual({ font: 20, line: 24 });
  });

  it('the three families map to stacks, the bundled one to the token itself', () => {
    expect(EDITOR_FONTS['jetbrains-mono'].css).toBeNull();
    expect(EDITOR_FONTS['sf-mono'].css).toContain('ui-monospace');
    expect(EDITOR_FONTS.menlo.css).toContain('Menlo');
  });

  it('a settings change keeps the selection and the undo history', () => {
    const controller = mount('one two three', 3);
    type(controller, 'X');
    controller.view.dispatch({ selection: EditorSelection.range(1, 6) });
    const before = controller.getState().selection.main;
    controller.setTabSize(4);
    controller.setInsertSpaces(false);
    controller.setCurrentLine(false);
    controller.setAutoPair(true);
    controller.setContinueLists(false);
    expect(controller.getState().selection.main.from).toBe(before.from);
    expect(controller.getState().selection.main.to).toBe(before.to);
    expect(text(controller)).toBe('oneX two three');
    undo(controller.view);
    expect(text(controller)).toBe('one two three');
  });
});

describe('D12 insertSpaces', () => {
  it('on (default): Tab indents with spaces; off: with a tab character', () => {
    const on = mount('- a');
    indentMore(on.view);
    expect(text(on)).toBe('  - a');
    const off = mount('- a');
    off.setInsertSpaces(false);
    indentMore(off.view);
    expect(text(off)).toBe('\t- a');
  });
});

describe('D12 autoPair', () => {
  it('is off by default', () => {
    const controller = mount('');
    type(controller, '(');
    expect(text(controller)).toBe('(');
  });

  it.each([
    ['(', '()'],
    ['[', '[]'],
    ['"', '""'],
    ['`', '``'],
    ['**', '****'],
    ['__', '____'],
  ])('on: typing %s gives %s with the caret inside', (typed, expected) => {
    const controller = mount('');
    controller.setAutoPair(true);
    type(controller, typed);
    expect(text(controller)).toBe(expected);
    expect(controller.getState().selection.main.head).toBe(expected.length / 2);
  });

  it('steps over the closing half of ** when it is typed', () => {
    const controller = mount('');
    controller.setAutoPair(true);
    type(controller, '**bold**');
    expect(text(controller)).toBe('**bold**');
    expect(controller.getState().selection.main.head).toBe(8);
  });

  it('does not pair in snake_case', () => {
    const controller = mount('snake_');
    controller.setAutoPair(true);
    type(controller, '_');
    expect(text(controller)).toBe('snake__');
  });

  it('does not pair inside a fenced code block', () => {
    const doc = '```\n';
    const controller = mount(doc);
    controller.setAutoPair(true);
    type(controller, '(');
    type(controller, '**');
    expect(text(controller)).toBe('```\n(**');
  });

  it('does not pair inside the frontmatter', () => {
    const doc = '---\ntitle: ';
    const controller = mount(`${doc}\n---\n\nBody`, doc.length);
    controller.setAutoPair(true);
    type(controller, '"');
    type(controller, '(');
    expect(text(controller)).toBe('---\ntitle: "(\n---\n\nBody');
  });

  it('pairs again in the body after the frontmatter', () => {
    const controller = mount('---\ntitle: x\n---\n\n');
    controller.setAutoPair(true);
    type(controller, '(');
    expect(text(controller)).toBe('---\ntitle: x\n---\n\n()');
  });
});

describe('D12 continueLists', () => {
  it('on (default) Return continues a list; off it inserts a plain newline', () => {
    const on = mount('- item');
    enter(on);
    expect(text(on)).toBe('- item\n- ');
    const off = mount('- item');
    off.setContinueLists(false);
    enter(off);
    expect(text(off)).toBe('- item\n');
  });
});
