/**
 * The editor in real WebKit, alone on the harness page (tests/harness/editor.html): typing, lists,
 * indentation, undo, the find bar, formatting commands, navigation and the settings. The look of
 * the editor is in editor-theme.spec.ts.
 */
import { expect, type Page, test } from '@playwright/test';

/** The part of the controller these tests use, as seen from the page. */
interface EditorApi {
  getText(): string;
  setText(text: string): void;
  focus(): void;
  run(command: string): boolean;
  toggleTaskAtLine(line: number): boolean;
  topVisibleLine(): number;
  scrollToLine(line: number, align: 'top' | 'nearest'): void;
  revealLine(line: number): void;
  openSearch(replace: boolean): void;
  findNext(): void;
  findPrevious(): void;
  setFlavor(flavor: string): void;
  setReadOnly(readOnly: boolean): void;
  setTabSize(size: number): void;
  setSoftWrap(on: boolean): void;
  setLineNumbers(on: boolean): void;
  getSelectionInfo(): { line: number; column: number; selectedText: string | null };
  view: { dispatch(spec: unknown): void; scrollDOM: HTMLElement };
}

declare global {
  interface Window {
    __editor: EditorApi;
    __events: { changes: number; scrolls: number; selections: unknown[] };
    __ready: boolean;
  }
}

const HARNESS = '/tests/harness/editor.html';

const content = (page: Page) => page.getByRole('textbox', { name: 'Markdown source' });
const findBar = (page: Page) => page.locator('.cm-search');

async function openEditor(page: Page, text = ''): Promise<void> {
  await page.goto(HARNESS);
  await page.waitForFunction(() => window.__ready === true);
  if (text) await page.evaluate((value) => window.__editor.setText(value), text);
}

/** Gives the editor focus with the caret at the start (or end) of the document. */
async function focusEditor(page: Page, where: 'start' | 'end' = 'start'): Promise<void> {
  await content(page).click();
  await page.keyboard.press(where === 'start' ? 'ControlOrMeta+Home' : 'ControlOrMeta+End');
}

const textOf = (page: Page) => page.evaluate(() => window.__editor.getText());
const selectionOf = (page: Page) => page.evaluate(() => window.__editor.getSelectionInfo());
const topLine = (page: Page) => page.evaluate(() => window.__editor.topVisibleLine());

/** Selects characters `from` to `to` of the document. */
const select = (page: Page, from: number, to: number) =>
  page.evaluate(
    ([a, b]) => window.__editor.view.dispatch({ selection: { anchor: a, head: b } }),
    [from, to],
  );

/** 600 numbered lines; every third is a long paragraph that wraps into several rows. */
function longDocument(): string {
  const lines: string[] = [];
  for (let i = 0; i < 600; i++) {
    lines.push(
      i % 3 === 0 ? `L${i} ${'word '.repeat(60 + (i % 7) * 15)}`.trimEnd() : `L${i} a short line`,
    );
  }
  return lines.join('\n');
}

test.describe('typing', () => {
  test('puts the text in the editor and reports the 0-based selection', async ({ page }) => {
    await openEditor(page);
    await focusEditor(page);

    await page.keyboard.type('Hello, *world*!');

    expect(await textOf(page)).toBe('Hello, *world*!');
    expect(await selectionOf(page)).toEqual({ line: 0, column: 15, selectedText: null });
  });

  test('Cmd+Z and Shift+Cmd+Z undo and redo it', async ({ page }) => {
    await openEditor(page);
    await focusEditor(page);
    await page.keyboard.type('abc');

    await page.keyboard.press('ControlOrMeta+z');
    expect(await textOf(page)).toBe('');

    await page.keyboard.press('ControlOrMeta+Shift+z');
    expect(await textOf(page)).toBe('abc');
  });

  test('a read-only editor takes no typing, and takes it again when it is released', async ({
    page,
  }) => {
    await openEditor(page, 'fixed');
    await page.evaluate(() => window.__editor.setReadOnly(true));
    await focusEditor(page, 'end');

    await page.keyboard.type('x');
    expect(await textOf(page)).toBe('fixed');
    await expect(content(page)).toHaveAttribute('aria-readonly', 'true');

    await page.evaluate(() => window.__editor.setReadOnly(false));
    await page.keyboard.type('x');
    expect(await textOf(page)).toBe('fixedx');
  });
});

test.describe('lists', () => {
  test('Return continues a bulleted list and ends it on an empty item', async ({ page }) => {
    await openEditor(page);
    await focusEditor(page);

    await page.keyboard.type('- one');
    await page.keyboard.press('Enter');
    expect(await textOf(page)).toBe('- one\n- ');
    await page.keyboard.type('two');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    expect(await textOf(page)).toBe('- one\n- two\n');

    await page.keyboard.type('after');
    expect(await textOf(page)).toBe('- one\n- two\nafter');
  });

  test('Return on an empty second item ends the list at once', async ({ page }) => {
    await openEditor(page);
    await focusEditor(page);

    await page.keyboard.type('- one');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    expect(await textOf(page)).toBe('- one\n');
  });

  test('Return continues a numbered list and ends it on an empty item', async ({ page }) => {
    await openEditor(page);
    await focusEditor(page);

    await page.keyboard.type('1. one');
    await page.keyboard.press('Enter');
    expect(await textOf(page)).toBe('1. one\n2. ');
    await page.keyboard.type('two');
    await page.keyboard.press('Enter');
    expect(await textOf(page)).toBe('1. one\n2. two\n3. ');
    await page.keyboard.press('Enter');
    expect(await textOf(page)).toBe('1. one\n2. two\n');
  });

  test('Return continues a task list with an open box and ends it on an empty item', async ({
    page,
  }) => {
    await openEditor(page);
    await focusEditor(page);

    await page.keyboard.type('- [x] done');
    await page.keyboard.press('Enter');
    expect(await textOf(page)).toBe('- [x] done\n- [ ] ');
    await page.keyboard.type('todo');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    expect(await textOf(page)).toBe('- [x] done\n- [ ] todo\n');
  });

  test('Return continues an ordered task list too', async ({ page }) => {
    await openEditor(page);
    await focusEditor(page);

    await page.keyboard.type('1. [ ] first');
    await page.keyboard.press('Enter');
    expect(await textOf(page)).toBe('1. [ ] first\n2. [ ] ');
    await page.keyboard.press('Enter');
    expect(await textOf(page)).toBe('1. [ ] first\n');
  });

  test('Return continues a quote', async ({ page }) => {
    await openEditor(page);
    await focusEditor(page);

    await page.keyboard.type('> quoted');
    await page.keyboard.press('Enter');

    expect(await textOf(page)).toBe('> quoted\n> ');
  });

  test('Backspace right after a marker removes the marker', async ({ page }) => {
    await openEditor(page);
    await focusEditor(page);
    await page.keyboard.type('- item');
    await page.keyboard.press('Enter');
    expect(await textOf(page)).toBe('- item\n- ');

    // On a later item the marker first turns into the indentation of a continued item (the
    // Markdown language's own behavior, so that a list is easy to continue); Backspace again
    // takes that away.
    await page.keyboard.press('Backspace');
    expect(await textOf(page)).toBe('- item\n  ');
    await page.keyboard.press('Backspace');
    expect(await textOf(page)).toBe('- item\n');
  });

  test('Backspace right after the marker of a first item removes it at once', async ({ page }) => {
    await openEditor(page);
    await focusEditor(page);
    await page.keyboard.type('- ');

    await page.keyboard.press('Backspace');

    expect(await textOf(page)).toBe('');
  });

  test('Backspace removes a task marker and a number as a whole', async ({ page }) => {
    await openEditor(page);
    await focusEditor(page);
    await page.keyboard.type('- [ ] ');
    await page.keyboard.press('Backspace');
    expect(await textOf(page)).toBe('');

    await page.keyboard.type('3. ');
    await page.keyboard.press('Backspace');
    expect(await textOf(page)).toBe('');
  });

  test('Tab indents a list item two spaces and Shift+Tab takes it back', async ({ page }) => {
    await openEditor(page, '- one\n- two');
    await focusEditor(page, 'end');

    await page.keyboard.press('Tab');
    expect(await textOf(page)).toBe('- one\n  - two');
    await expect(content(page)).toBeFocused();

    await page.keyboard.press('Shift+Tab');
    expect(await textOf(page)).toBe('- one\n- two');
  });

  test('the tab size setter changes the indent step', async ({ page }) => {
    await openEditor(page, '- one\n- two');
    await page.evaluate(() => window.__editor.setTabSize(4));
    await focusEditor(page, 'end');

    await page.keyboard.press('Tab');

    expect(await textOf(page)).toBe('- one\n    - two');
  });

  test('Tab indents every selected line', async ({ page }) => {
    await openEditor(page, '- a\n- b\n- c');
    await focusEditor(page);
    await select(page, 0, 11);

    await page.keyboard.press('Tab');

    expect(await textOf(page)).toBe('  - a\n  - b\n  - c');
  });

  test('Escape then Tab leaves the editor for the next control', async ({ page }) => {
    await openEditor(page, 'text');
    await focusEditor(page);
    await expect(content(page)).toBeFocused();

    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');

    await expect(page.locator('#after')).toBeFocused();
    expect(await textOf(page)).toBe('text');
  });
});

test.describe('find', () => {
  test('Cmd+F opens the find bar on the find field, and Escape closes it', async ({ page }) => {
    await openEditor(page, 'one two one two one');
    await focusEditor(page);

    await page.keyboard.press('ControlOrMeta+f');
    await expect(findBar(page)).toBeVisible();
    await expect(findBar(page).locator('input[name=search]')).toBeFocused();
    await expect(findBar(page).locator('input[name=replace]')).toBeHidden();

    await page.keyboard.press('Escape');
    await expect(findBar(page)).toHaveCount(0);
    await expect(content(page)).toBeFocused();
  });

  test('typing a query highlights the matches and Return, Cmd+G and Shift+Cmd+G move the selection', async ({
    page,
  }) => {
    await openEditor(page, 'one two one two one');
    await focusEditor(page);
    await page.keyboard.press('ControlOrMeta+f');

    await page.keyboard.type('two');
    await expect(page.locator('.cm-searchMatch')).toHaveCount(2);

    await page.keyboard.press('Enter');
    expect(await selectionOf(page)).toEqual({ line: 0, column: 7, selectedText: 'two' });
    await page.keyboard.press('Enter');
    expect(await selectionOf(page)).toEqual({ line: 0, column: 15, selectedText: 'two' });
    await page.keyboard.press('Shift+Enter');
    expect(await selectionOf(page)).toEqual({ line: 0, column: 7, selectedText: 'two' });

    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+g');
    expect(await selectionOf(page)).toEqual({ line: 0, column: 15, selectedText: 'two' });
    await page.keyboard.press('ControlOrMeta+Shift+g');
    expect(await selectionOf(page)).toEqual({ line: 0, column: 7, selectedText: 'two' });
  });

  test('findNext and findPrevious of the controller move the selection the same way', async ({
    page,
  }) => {
    await openEditor(page, 'ab cd ab cd ab');
    await focusEditor(page);
    await page.keyboard.press('ControlOrMeta+f');
    await page.keyboard.type('ab');
    await page.keyboard.press('Escape');

    await page.evaluate(() => window.__editor.findNext());
    expect(await selectionOf(page)).toEqual({ line: 0, column: 2, selectedText: 'ab' });
    await page.evaluate(() => window.__editor.findNext());
    expect(await selectionOf(page)).toEqual({ line: 0, column: 8, selectedText: 'ab' });
    await page.evaluate(() => window.__editor.findPrevious());
    expect(await selectionOf(page)).toEqual({ line: 0, column: 2, selectedText: 'ab' });
  });

  test('Option+Cmd+F opens find and replace, and replace all is one undo step', async ({
    page,
  }) => {
    await openEditor(page, 'one two one two one');
    await focusEditor(page);

    await page.keyboard.press('ControlOrMeta+Alt+f');
    await expect(findBar(page).locator('input[name=replace]')).toBeVisible();
    await expect(findBar(page).locator('input[name=replace]')).toBeFocused();

    await findBar(page).locator('input[name=search]').fill('two');
    await findBar(page).locator('input[name=replace]').fill('2');
    await findBar(page).locator('button[name=replaceAll]').click();
    expect(await textOf(page)).toBe('one 2 one 2 one');

    // WebKit does not focus a clicked button, so focus goes back to the editor first.
    await page.evaluate(() => window.__editor.focus());
    await page.keyboard.press('ControlOrMeta+z');
    expect(await textOf(page)).toBe('one two one two one');
  });

  test('Escape closes the bar from the replace field', async ({ page }) => {
    await openEditor(page, 'text');
    await focusEditor(page);
    await page.keyboard.press('ControlOrMeta+Alt+f');
    await expect(findBar(page).locator('input[name=replace]')).toBeFocused();

    await page.keyboard.press('Escape');

    await expect(findBar(page)).toHaveCount(0);
    await expect(content(page)).toBeFocused();
  });

  test('Cmd+F while the replace row is showing goes back to plain find', async ({ page }) => {
    await openEditor(page, 'text');
    await focusEditor(page);
    await page.keyboard.press('ControlOrMeta+Alt+f');
    await expect(findBar(page).locator('input[name=replace]')).toBeVisible();

    await page.keyboard.press('ControlOrMeta+f');

    await expect(findBar(page).locator('input[name=replace]')).toBeHidden();
    await expect(findBar(page).locator('input[name=search]')).toBeFocused();
  });

  test('openSearch(replace) from the menu path opens the same bar', async ({ page }) => {
    await openEditor(page, 'text');

    await page.evaluate(() => window.__editor.openSearch(false));
    await expect(findBar(page).locator('input[name=search]')).toBeFocused();
    await expect(findBar(page).locator('input[name=replace]')).toBeHidden();

    await page.evaluate(() => window.__editor.openSearch(true));
    await expect(findBar(page).locator('input[name=replace]')).toBeFocused();
  });

  test('the find bar starts from the selected text', async ({ page }) => {
    await openEditor(page, 'alpha beta alpha');
    await focusEditor(page);
    await select(page, 0, 5);

    await page.keyboard.press('ControlOrMeta+f');

    await expect(findBar(page).locator('input[name=search]')).toHaveValue('alpha');
  });
});

test.describe('formatting commands in the editor', () => {
  test('bold wraps the selection, keeps it selected, and one Cmd+Z undoes it', async ({ page }) => {
    await openEditor(page, 'Hello world');
    await select(page, 6, 11);

    expect(await page.evaluate(() => window.__editor.run('bold'))).toBe(true);
    expect(await textOf(page)).toBe('Hello **world**');
    expect(await selectionOf(page)).toEqual({ line: 0, column: 13, selectedText: 'world' });
    await expect(content(page)).toBeFocused();

    await page.keyboard.press('ControlOrMeta+z');
    expect(await textOf(page)).toBe('Hello world');
  });

  test('typing carries on inside the markers after bold with no selection', async ({ page }) => {
    await openEditor(page);
    await focusEditor(page);

    await page.evaluate(() => window.__editor.run('bold'));
    await page.keyboard.type('strong');

    expect(await textOf(page)).toBe('**strong**');
  });

  test('link selects the placeholder address, which typing replaces', async ({ page }) => {
    await openEditor(page, 'see docs here');
    await select(page, 4, 8);

    await page.evaluate(() => window.__editor.run('link'));
    expect(await textOf(page)).toBe('see [docs](url) here');
    expect((await selectionOf(page)).selectedText).toBe('url');

    await page.keyboard.type('https://example.org');
    expect(await textOf(page)).toBe('see [docs](https://example.org) here');
  });

  test('table selects the first header cell, which typing replaces', async ({ page }) => {
    await openEditor(page, 'Intro');
    await focusEditor(page, 'end');

    await page.evaluate(() => window.__editor.run('table'));
    await page.keyboard.type('Name');

    expect((await textOf(page)).split('\n').slice(0, 4)).toEqual([
      'Intro',
      '',
      '| Name | Header 2 | Header 3 |',
      '| -------- | -------- | -------- |',
    ]);
  });

  test('code block puts the cursor after the backticks for the language name', async ({ page }) => {
    await openEditor(page, 'const a = 1;');
    await focusEditor(page);

    await page.evaluate(() => window.__editor.run('code-block'));
    await page.keyboard.type('ts');

    expect(await textOf(page)).toBe('```ts\nconst a = 1;\n```');
  });

  test('every heading level and the paragraph command work and undo in one step', async ({
    page,
  }) => {
    await openEditor(page, 'Title');
    await focusEditor(page);

    for (const level of [1, 2, 3, 4, 5, 6]) {
      await page.evaluate((l) => window.__editor.run(`heading-${l}`), level);
      expect(await textOf(page)).toBe(`${'#'.repeat(level)} Title`);
    }
    await page.evaluate(() => window.__editor.run('paragraph'));
    expect(await textOf(page)).toBe('Title');
    await page.keyboard.press('ControlOrMeta+z');
    expect(await textOf(page)).toBe('###### Title');
  });

  test('a command that has nothing to do returns false', async ({ page }) => {
    await openEditor(page, 'plain');
    expect(await page.evaluate(() => window.__editor.run('paragraph'))).toBe(false);
    expect(await textOf(page)).toBe('plain');
  });
});

test.describe('task boxes', () => {
  test('toggleTaskAtLine checks and unchecks a box without taking focus or moving the caret', async ({
    page,
  }) => {
    await openEditor(page, '- [ ] first\n- [x] second\nplain');
    await focusEditor(page, 'end');
    const caret = await selectionOf(page);

    expect(await page.evaluate(() => window.__editor.toggleTaskAtLine(0))).toBe(true);
    expect(await page.evaluate(() => window.__editor.toggleTaskAtLine(1))).toBe(true);
    expect(await textOf(page)).toBe('- [x] first\n- [ ] second\nplain');
    expect(await selectionOf(page)).toEqual(caret);

    expect(await page.evaluate(() => window.__editor.toggleTaskAtLine(2))).toBe(false);
    expect(await textOf(page)).toBe('- [x] first\n- [ ] second\nplain');
  });

  test('each toggle is its own undo step', async ({ page }) => {
    await openEditor(page, '- [ ] first\n- [ ] second');
    await focusEditor(page, 'end');
    await page.evaluate(() => window.__editor.toggleTaskAtLine(0));
    await page.evaluate(() => window.__editor.toggleTaskAtLine(1));

    await page.keyboard.press('ControlOrMeta+z');
    expect(await textOf(page)).toBe('- [x] first\n- [ ] second');
    await page.keyboard.press('ControlOrMeta+z');
    expect(await textOf(page)).toBe('- [ ] first\n- [ ] second');
  });
});

test.describe('navigation', () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page, longDocument());
  });

  test('topVisibleLine is 0 at the top', async ({ page }) => {
    expect(await topLine(page)).toBeCloseTo(0, 1);
  });

  test('topVisibleLine and scrollToLine agree within half a line on soft-wrapped text', async ({
    page,
  }) => {
    for (const target of [1, 17, 98.5, 150.25, 301, 444.75, 560, 0]) {
      await page.evaluate((line) => window.__editor.scrollToLine(line, 'top'), target);
      await expect
        .poll(() => topLine(page), { message: `line ${target}`, timeout: 5000 })
        .toBeCloseTo(target, 0);
    }
  });

  test('the line scrolled to sits at the top edge of the editor', async ({ page }) => {
    for (const target of [150, 300, 451]) {
      await page.evaluate((line) => window.__editor.scrollToLine(line, 'top'), target);
      await expect
        .poll(
          () =>
            page.evaluate((n) => {
              const scroller = document.querySelector('.cm-scroller');
              const line = [...document.querySelectorAll('.cm-line')].find((element) =>
                element.textContent?.startsWith(`L${n} `),
              );
              if (!scroller || !line) return null;
              return line.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
            }, target),
          { message: `line ${target}`, timeout: 5000 },
        )
        .toBeCloseTo(0, -1);
    }
  });

  test('a position reached by wheel scrolling reads back and scrolls back to the same place', async ({
    page,
  }) => {
    await page.mouse.move(360, 240);
    await page.mouse.wheel(0, 3000);
    await expect.poll(() => topLine(page)).toBeGreaterThan(30);
    await page.waitForTimeout(300);

    const before = await page.evaluate(() => ({
      line: window.__editor.topVisibleLine(),
      top: window.__editor.view.scrollDOM.scrollTop,
    }));
    await page.evaluate((line) => window.__editor.scrollToLine(line, 'top'), before.line);
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({
      line: window.__editor.topVisibleLine(),
      top: window.__editor.view.scrollDOM.scrollTop,
    }));

    expect(Math.abs(after.line - before.line)).toBeLessThan(0.5);
    expect(Math.abs(after.top - before.top)).toBeLessThan(11);
  });

  test('a fractional line inside a wrapped line is reached', async ({ page }) => {
    // Line 150 wraps into several rows; 150.5 is halfway down it.
    await page.evaluate(() => window.__editor.scrollToLine(150.5, 'top'));
    await expect.poll(() => topLine(page)).toBeCloseTo(150.5, 0);
    const rows = await page.evaluate(() => {
      const line = [...document.querySelectorAll('.cm-line')].find((element) =>
        element.textContent?.startsWith('L150 '),
      );
      return line ? line.getBoundingClientRect().height / 22 : 0;
    });
    expect(rows).toBeGreaterThan(3);
  });

  test('scrollToLine "nearest" scrolls only as far as needed, and not at all for a visible line', async ({
    page,
  }) => {
    const scrollTop = () => page.evaluate(() => window.__editor.view.scrollDOM.scrollTop);

    await page.evaluate(() => window.__editor.scrollToLine(3, 'nearest'));
    await page.waitForTimeout(200);
    expect(await scrollTop()).toBe(0);

    await page.evaluate(() => window.__editor.scrollToLine(300, 'nearest'));
    await expect.poll(() => topLine(page)).toBeGreaterThan(250);
    const visible = await page.evaluate(() => {
      const scroller = document.querySelector('.cm-scroller')?.getBoundingClientRect();
      const line = [...document.querySelectorAll('.cm-line')].find((element) =>
        element.textContent?.startsWith('L300 '),
      );
      const box = line?.getBoundingClientRect();
      return Boolean(
        scroller && box && box.top >= scroller.top - 1 && box.bottom <= scroller.bottom + 1,
      );
    });
    expect(visible).toBe(true);
  });

  test('revealLine puts the line at the top and the cursor on it', async ({ page }) => {
    await page.evaluate(() => window.__editor.revealLine(200));

    await expect.poll(() => topLine(page)).toBeCloseTo(200, 0);
    expect(await selectionOf(page)).toEqual({ line: 200, column: 0, selectedText: null });
  });

  test('revealLine keeps a line number that is out of range inside the document', async ({
    page,
  }) => {
    await page.evaluate(() => window.__editor.revealLine(99999));
    expect((await selectionOf(page)).line).toBe(599);
    await page.evaluate(() => window.__editor.revealLine(-5));
    expect((await selectionOf(page)).line).toBe(0);
  });

  test('onScroll is called when the editor scrolls, whatever moved it', async ({ page }) => {
    const before = await page.evaluate(() => window.__events.scrolls);
    await page.evaluate(() => window.__editor.scrollToLine(120, 'top'));
    await expect.poll(() => page.evaluate(() => window.__events.scrolls)).toBeGreaterThan(before);
  });

  test('onSelection is called for clicks and keys', async ({ page }) => {
    // Short lines: the arrow keys move by screen row, and the long document wraps.
    await page.evaluate(() => window.__editor.setText('one\ntwo\nthree'));
    await page.evaluate(() => {
      window.__events.selections.length = 0;
    });
    await focusEditor(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');

    const last = await page.evaluate(() => window.__events.selections.at(-1));
    expect(last).toEqual({ line: 2, column: 1, selectedText: null });
  });
});

test.describe('settings', () => {
  test('soft wrap is on by default and can be switched off', async ({ page }) => {
    await openEditor(page, `${'word '.repeat(300)}`);
    const overflow = () =>
      page.evaluate(() => {
        const scroller = document.querySelector('.cm-scroller');
        return scroller ? scroller.scrollWidth - scroller.clientWidth : -1;
      });
    expect(await overflow()).toBeLessThanOrEqual(1);

    await page.evaluate(() => window.__editor.setSoftWrap(false));
    await expect.poll(overflow).toBeGreaterThan(100);

    await page.evaluate(() => window.__editor.setSoftWrap(true));
    await expect.poll(overflow).toBeLessThanOrEqual(1);
  });

  test('line numbers are on by default and can be switched off', async ({ page }) => {
    await openEditor(page, 'a\nb');
    await expect(page.locator('.cm-lineNumbers')).toBeVisible();

    await page.evaluate(() => window.__editor.setLineNumbers(false));
    await expect(page.locator('.cm-lineNumbers')).toHaveCount(0);
  });

  test('spell check is on by default', async ({ page }) => {
    await openEditor(page);
    await expect(content(page)).toHaveAttribute('spellcheck', 'true');
  });

  test('switching to the CommonMark flavor drops the strikethrough styling and keeps the text', async ({
    page,
  }) => {
    await openEditor(page, 'a ~~gone~~ b');
    const struck = () =>
      page.evaluate(() => {
        const span = [...document.querySelectorAll('.cm-line span')].find(
          (element) => element.textContent === 'gone',
        );
        return span ? getComputedStyle(span).textDecorationLine : 'none';
      });
    expect(await struck()).toBe('line-through');

    await page.evaluate(() => window.__editor.setFlavor('commonmark'));
    await expect.poll(struck).not.toBe('line-through');
    expect(await textOf(page)).toBe('a ~~gone~~ b');

    await page.evaluate(() => window.__editor.setFlavor('gfm'));
    await expect.poll(struck).toBe('line-through');
  });
});
