/**
 * Acceptance cases A11 to A14: the editor.
 * Formatting semantics follow the editor specification; where the specification leaves the exact marker
 * open (`*` or `_`, `-` or `*`) the test accepts either.
 */
import { type Page, test } from '@playwright/test';
import {
  dirtyDot,
  editor,
  editorText,
  expect,
  launch,
  menu,
  openFiles,
  selectionOf,
  selectText,
  setSelection,
  setView,
  TEST_TIMEOUT,
} from './support';

test.setTimeout(TEST_TIMEOUT);

const DOCS = '/Users/mock/docs';

/** Gives the focus back to the editor without touching its selection (a person clicks in it). */
async function focusEditor(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      document.querySelector('[data-testid="editor"] .cm-content') as HTMLElement & {
        cmTile?: { view?: { focus(): void } };
      }
    ).cmTile?.view?.focus();
  });
}

type Route = 'menu' | 'toolbar';

async function runFormat(page: Page, route: Route, action: string): Promise<void> {
  if (route === 'menu') {
    await menu(page, action);
    return;
  }
  if (action.startsWith('heading-') || action === 'paragraph') {
    await page.getByTestId('tool-heading').click();
    const label =
      action === 'paragraph' ? 'Paragraph' : `Heading ${action.slice('heading-'.length)}`;
    await page.getByRole('menuitem', { name: label }).click();
    return;
  }
  await page.getByTestId(`tool-${action}`).click();
}

const BASE = 'hello world\nsecond line\nthird line\n\n## Heading line\n';

interface Case {
  name: string;
  action: string;
  /** Selection: a string to select, or a caret offset in the text of the line named by `caretIn`. */
  select: string | { caretIn: string; at: number } | { caretAtLine: number };
  /** Checks the document after the command (and the selection when given). */
  check: (text: string, selection: { text: string; from: number; to: number }) => void;
}

function lineStart(text: string, line: number): number {
  return text.split('\n').slice(0, line).join('\n').length + (line > 0 ? 1 : 0);
}

const CASES: Case[] = [
  {
    name: 'bold',
    action: 'bold',
    select: 'world',
    check: (t) => expect(t).toMatch(/^hello (\*\*|__)world\1\nsecond/),
  },
  {
    name: 'italic',
    action: 'italic',
    select: 'world',
    check: (t) => expect(t).toMatch(/^hello (\*|_)world\1\nsecond/),
  },
  {
    name: 'strikethrough',
    action: 'strikethrough',
    select: 'world',
    check: (t) => expect(t).toMatch(/^hello ~~world~~\nsecond/),
  },
  {
    name: 'code',
    action: 'code',
    select: 'world',
    check: (t) => expect(t).toMatch(/^hello `world`\nsecond/),
  },
  {
    name: 'link',
    action: 'link',
    select: 'world',
    check: (t, s) => {
      expect(t).toMatch(/^hello \[world\]\(url\)\nsecond/);
      expect(s.text).toBe('url');
    },
  },
  {
    name: 'image',
    action: 'image',
    select: 'world',
    check: (t, s) => {
      expect(t).toMatch(/^hello !\[world\]\(path\)\nsecond/);
      expect(s.text).toBe('path');
    },
  },
  {
    name: 'quote',
    action: 'quote',
    select: 'hello world',
    check: (t) => expect(t).toMatch(/^> hello world\nsecond line\n/),
  },
  {
    name: 'bullet-list',
    action: 'bullet-list',
    select: 'hello world\nsecond line',
    check: (t) => expect(t).toMatch(/^([-*+]) hello world\n\1 second line\nthird line\n/),
  },
  {
    name: 'numbered-list',
    action: 'numbered-list',
    select: 'hello world\nsecond line',
    check: (t) => expect(t).toMatch(/^1\. hello world\n2\. second line\nthird line\n/),
  },
  {
    name: 'task-list',
    action: 'task-list',
    select: 'hello world',
    check: (t) => expect(t).toMatch(/^[-*+] \[ \] hello world\nsecond line\n/),
  },
  {
    name: 'code-block',
    action: 'code-block',
    select: 'hello world',
    check: (t, s) => {
      expect(t).toMatch(/^```\nhello world\n```\nsecond line\n/);
      // The cursor sits after the opening backticks.
      expect(s.from).toBe(3);
      expect(s.to).toBe(3);
    },
  },
  {
    name: 'table',
    action: 'table',
    select: { caretAtLine: 3 },
    check: (t, s) => {
      const rows = t.split('\n').filter((line) => /^\s*\|.*\|\s*$/.test(line));
      // A header row, a separator row and at least one body row, each with 3 columns.
      expect(rows.length).toBeGreaterThanOrEqual(3);
      for (const row of rows)
        expect(
          row
            .trim()
            .replace(/^\||\|$/g, '')
            .split('|'),
        ).toHaveLength(3);
      expect(rows[1]).toMatch(/^\s*\|(\s*:?-+:?\s*\|){3}\s*$/);
      // The first header cell is selected.
      const firstRowStart = t.indexOf(rows[0] as string);
      expect(s.from).toBeGreaterThanOrEqual(firstRowStart);
      expect(s.to).toBeLessThanOrEqual(firstRowStart + (rows[0] as string).indexOf('|', 1) + 1);
      expect(s.text.length).toBeGreaterThan(0);
    },
  },
  {
    name: 'rule',
    action: 'rule',
    select: { caretAtLine: 3 },
    check: (t) => {
      expect(t.split('\n')).toContain('---');
      expect(t).toContain('third line');
    },
  },
  ...[1, 2, 3, 4, 5, 6].map(
    (level): Case => ({
      name: `heading-${level}`,
      action: `heading-${level}`,
      select: { caretIn: 'hello world', at: 3 },
      check: (t) =>
        expect(t).toMatch(new RegExp(`^${'#'.repeat(level)} hello world\\nsecond line\\n`)),
    }),
  ),
  {
    name: 'heading-2 on two selected lines',
    action: 'heading-2',
    select: 'hello world\nsecond line',
    check: (t) => expect(t).toMatch(/^## hello world\n## second line\nthird line\n/),
  },
  {
    name: 'heading-3 changes the level of a heading',
    action: 'heading-3',
    select: { caretIn: 'Heading line', at: 4 },
    check: (t) => expect(t).toMatch(/\n### Heading line\n$/),
  },
  {
    name: 'paragraph removes the heading',
    action: 'paragraph',
    select: { caretIn: 'Heading line', at: 4 },
    check: (t) => expect(t).toMatch(/\nHeading line\n$/),
  },
  {
    name: 'bold at the cursor wraps the word',
    action: 'bold',
    select: { caretIn: 'world', at: 2 },
    check: (t) => expect(t).toMatch(/^hello (\*\*|__)world\1\nsecond/),
  },
  {
    name: 'bold on an empty line inserts an empty pair with the cursor inside',
    action: 'bold',
    select: { caretAtLine: 3 },
    check: (t, s) => {
      const start = lineStart(t, 3);
      expect(t.split('\n')[3]).toMatch(/^(\*\*\*\*|____)$/);
      expect(s.from).toBe(start + 2);
      expect(s.to).toBe(start + 2);
    },
  },
  {
    name: 'quote on two lines',
    action: 'quote',
    select: 'hello world\nsecond line',
    check: (t) => expect(t).toMatch(/^> hello world\n> second line\nthird line\n/),
  },
];

async function applySelection(page: Page, select: Case['select']): Promise<void> {
  if (typeof select === 'string') {
    await selectText(page, select);
    return;
  }
  const text = await editorText(page);
  if ('caretIn' in select) {
    await setSelection(page, text.indexOf(select.caretIn) + select.at);
  } else {
    await setSelection(page, lineStart(text, select.caretAtLine));
  }
}

async function readState(page: Page) {
  const [text, selection] = await Promise.all([editorText(page), selectionOf(page)]);
  return { text, selection };
}

test('A11 Each formatting command (toolbar and menu action) produces the specified text and is undone by one Cmd+Z', async ({
  page,
}) => {
  const path = `${DOCS}/format.md`;
  await launch(page, { seed: { files: { [path]: BASE } }, open: path, view: 'split' });
  await expect(page.getByTestId('view-split')).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => editorText(page)).toBe(BASE);

  for (const route of ['menu', 'toolbar'] as const) {
    for (const c of CASES) {
      const label = `${c.name} via ${route}`;
      await applySelection(page, c.select);
      await runFormat(page, route, c.action);
      await expect
        .poll(async () => (await editorText(page)) !== BASE, { message: `${label}: text changes` })
        .toBe(true);
      const { text, selection } = await readState(page);
      try {
        c.check(text, { text: selection.text, from: selection.from, to: selection.to });
      } catch (error) {
        throw new Error(`${label}: ${(error as Error).message}\nDocument was:\n${text}`);
      }
      // One Cmd+Z restores the document exactly.
      await focusEditor(page);
      await page.keyboard.press('ControlOrMeta+z');
      await expect
        .poll(() => editorText(page), { message: `${label}: one undo restores the text` })
        .toBe(BASE);
    }
  }
});

test('A11 Toggling a format off removes the markers that surround the selection', async ({
  page,
}) => {
  const path = `${DOCS}/toggle.md`;
  await launch(page, {
    seed: { files: { [path]: 'say **loud** now\n' } },
    open: path,
    view: 'split',
  });
  await selectText(page, 'loud');
  await menu(page, 'bold');
  await expect.poll(() => editorText(page)).toBe('say loud now\n');
  await menu(page, 'bold');
  await expect.poll(() => editorText(page)).toMatch(/^say (\*\*|__)loud\1 now\n$/);
});

test('A11 Format commands are disabled in Preview and do nothing there', async ({ page }) => {
  const path = `${DOCS}/preview-only.md`;
  await launch(page, { seed: { files: { [path]: BASE } }, open: path, view: 'preview' });
  await expect(page.getByTestId('tool-bold')).toBeDisabled();
  await expect(page.getByTestId('tool-heading')).toBeDisabled();
  // The text arrives after the view: wait for it, so the check below compares like with like.
  await expect.poll(() => editorText(page)).toBe(BASE);
  await menu(page, 'bold');
  await menu(page, 'heading-1');
  expect(await editorText(page)).toBe(BASE);
  await setView(page, 'split');
  await expect(page.getByTestId('tool-bold')).toBeEnabled();
});

test('A12 Return continues bulleted, numbered, task and quote lines and ends them on an empty item', async ({
  page,
}) => {
  await launch(page);
  const type = async (s: string) => page.keyboard.type(s);
  const enter = () => page.keyboard.press('Enter');

  // Bulleted list.
  await menu(page, 'new');
  await editor(page).click();
  await type('- one');
  await enter();
  expect(await editorText(page)).toBe('- one\n- ');
  await type('two');
  await enter();
  expect(await editorText(page)).toBe('- one\n- two\n- ');
  await enter(); // an empty item ends the list
  const ended = await editorText(page);
  expect(ended.startsWith('- one\n- two\n')).toBe(true);
  expect(ended.split('\n').at(-1)).toBe('');
  expect(ended.split('\n').some((line) => /^[-*+]\s*$/.test(line))).toBe(false);

  // Numbered list counts on and ends on an empty item.
  await menu(page, 'new');
  await editor(page).click();
  await type('1. a');
  await enter();
  expect(await editorText(page)).toBe('1. a\n2. ');
  await type('b');
  await enter();
  expect(await editorText(page)).toBe('1. a\n2. b\n3. ');
  await enter();
  expect((await editorText(page)).split('\n').some((line) => /^\d+\.\s*$/.test(line))).toBe(false);

  // Task list continues with a fresh unchecked box.
  await menu(page, 'new');
  await editor(page).click();
  await type('- [ ] write');
  await enter();
  expect(await editorText(page)).toBe('- [ ] write\n- [ ] ');
  await type('review');
  await enter();
  await enter();
  const tasks = await editorText(page);
  expect(tasks.startsWith('- [ ] write\n- [ ] review\n')).toBe(true);
  expect(tasks.split('\n').some((line) => /^[-*+] \[ \]\s*$/.test(line))).toBe(false);

  // Quote continues and ends.
  await menu(page, 'new');
  await editor(page).click();
  await type('> quoted');
  await enter();
  expect(await editorText(page)).toBe('> quoted\n> ');

  // Backspace at a marker removes it; Tab and Shift-Tab indent and outdent an item.
  await menu(page, 'new');
  await editor(page).click();
  await type('- x');
  await enter();
  await page.keyboard.press('Backspace');
  // The Markdown language leaves the indentation where the marker was: the marker is gone.
  expect((await editorText(page)).split('\n').at(-1)).toMatch(/^\s*$/);
  await menu(page, 'new');
  await editor(page).click();
  await type('- a');
  await enter();
  await type('b');
  await page.keyboard.press('Tab');
  expect((await editorText(page)).split('\n')[1]).toMatch(/^\s+[-*+] b$/);
  await page.keyboard.press('Shift+Tab');
  expect((await editorText(page)).split('\n')[1]).toMatch(/^[-*+] b$/);
});

test('A12 Return on an empty quote line ends the quote', async ({ page }) => {
  await launch(page);
  await menu(page, 'new');
  await editor(page).click();
  await page.keyboard.type('> quoted');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  expect((await editorText(page)).split('\n').some((line) => /^>\s*$/.test(line))).toBe(false);
});

test('A13 Cmd+F opens the find bar; Escape closes it; find next and previous move the selection', async ({
  page,
}) => {
  const path = `${DOCS}/find.md`;
  await launch(page, {
    seed: { files: { [path]: 'foo bar foo baz foo\n' } },
    open: path,
    view: 'editor',
  });
  const bar = page.locator('[data-testid="editor"] .cm-search');
  await expect(bar).toHaveCount(0);
  await setSelection(page, 0);

  await menu(page, 'find');
  await expect(bar).toBeVisible();
  const field = bar.locator('input[name="search"]');
  await expect(field).toBeFocused();
  await page.keyboard.type('foo');

  await menu(page, 'find-next');
  await expect.poll(async () => (await selectionOf(page)).text).toBe('foo');
  const first = (await selectionOf(page)).from;
  await menu(page, 'find-next');
  await expect.poll(async () => (await selectionOf(page)).from).not.toBe(first);
  expect((await selectionOf(page)).text).toBe('foo');
  const second = (await selectionOf(page)).from;
  await menu(page, 'find-next');
  await expect.poll(async () => (await selectionOf(page)).from).not.toBe(second);
  await menu(page, 'find-previous');
  await expect.poll(async () => (await selectionOf(page)).from).toBe(second);
  expect((await selectionOf(page)).text).toBe('foo');

  // Escape closes the bar.
  await page.keyboard.press('Escape');
  await expect(bar).toHaveCount(0);

  // The keyboard shortcut opens it again.
  await focusEditor(page);
  await page.keyboard.press('ControlOrMeta+f');
  await expect(bar).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bar).toHaveCount(0);
});

test('A14 Undo and redo through menu actions', async ({ page }) => {
  const path = `${DOCS}/undo.md`;
  await launch(page, { seed: { files: { [path]: 'base\n' } }, open: path, view: 'editor' });
  await openFiles(page, [path]);
  await setSelection(page, 5);
  await page.keyboard.type('edit');
  await expect.poll(() => editorText(page)).toBe('base\nedit');
  await expect(dirtyDot(page)).toBeVisible();

  await menu(page, 'undo');
  await expect.poll(() => editorText(page)).toBe('base\n');
  // Back at the loaded text: the document is clean again.
  await expect(dirtyDot(page)).toHaveCount(0);

  await menu(page, 'redo');
  await expect.poll(() => editorText(page)).toBe('base\nedit');
  await expect(dirtyDot(page)).toBeVisible();

  // Undo past the first edit does nothing further.
  await menu(page, 'undo');
  await menu(page, 'undo');
  await expect.poll(() => editorText(page)).toBe('base\n');
});
