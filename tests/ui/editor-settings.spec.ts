/** WP4.2 editor and saving settings in the main window. */
import { expect, type Page, test } from '@playwright/test';
import type { MockSeed } from '../../src/lib/platform-mock';
import { editor, HOME, menu, seedMock, typeAtEnd } from './helpers';

const NOTE = `${HOME}/Documents/note.md`;
const NOTE_TEXT = '# Note\n\n- one\n- two\n\nBody text.\n';

async function open(page: Page, seed: MockSeed = {}, path: string | null = NOTE) {
  await seedMock(page, {
    launch: path ? { openPath: path, view: 'split' } : { welcome: true },
    ...seed,
    files: { [NOTE]: NOTE_TEXT, ...seed.files },
  });
  await page.goto('/');
  if (path) await expect(editor(page)).toBeVisible();
}

const mock = <T>(page: Page, fn: (m: NonNullable<Window['__WRITEDOWN_MOCK__']>) => T) =>
  page.evaluate(`(${fn.toString()})(window.__WRITEDOWN_MOCK__)`) as Promise<T>;

const change = (page: Page, patch: unknown) =>
  page.evaluate((p) => window.__WRITEDOWN_MOCK__?.settingsChanged(p as never), patch);

test.describe('D11 font family, size and line height', () => {
  test('change the editor font and line box, and keep cursor, selection and undo', async ({
    page,
  }) => {
    await open(page);
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('typed');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    const position = await page.getByTestId('status-position').textContent();
    const line = page.locator('.cm-line').first();
    const before = await line.evaluate((el) => getComputedStyle(el).lineHeight);
    expect(before).toBe('22px');

    await change(page, { editor: { fontFamily: 'menlo', fontSize: 16, lineHeight: 2 } });
    await expect(line).toHaveCSS('line-height', '32px');
    await expect(line).toHaveCSS('font-size', '16px');
    const family = await page
      .locator('.cm-scroller')
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family).toContain('Menlo');
    await expect(page.getByTestId('editor-font-info')).toContainText('Font: Menlo (16px)');
    expect(await page.getByTestId('status-position').textContent()).toBe(position);
    expect(await page.evaluate(() => getSelection()?.toString())).toBe('ed');

    await change(page, { editor: { fontFamily: 'sf-mono' } });
    const sf = await page.locator('.cm-scroller').evaluate((el) => getComputedStyle(el).fontFamily);
    expect(sf).toContain('ui-monospace');
    await change(page, { editor: { fontFamily: 'jetbrains-mono' } });
    const jb = await page.locator('.cm-scroller').evaluate((el) => getComputedStyle(el).fontFamily);
    expect(jb).toContain('JetBrains Mono');

    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor(page)).not.toContainText('typed');
  });
});

test.describe('D12 editor switches', () => {
  test('paneHeaders off hides both headers; currentLine off removes both highlights', async ({
    page,
  }) => {
    await open(page);
    await expect(page.getByTestId('editor-header')).toBeVisible();
    await expect(page.getByTestId('preview-header')).toBeVisible();
    await editor(page).click();
    await expect(page.locator('.cm-activeLine')).toHaveCount(1);
    await expect(page.locator('.cm-activeLineGutter')).toHaveCount(1);

    await change(page, { editor: { paneHeaders: false, currentLine: false } });
    await expect(page.getByTestId('editor-header')).toHaveCount(0);
    await expect(page.getByTestId('preview-header')).toHaveCount(0);
    await expect(page.locator('.cm-activeLine')).toHaveCount(0);
    await expect(page.locator('.cm-activeLineGutter')).toHaveCount(0);

    await change(page, { editor: { paneHeaders: true, currentLine: true } });
    await expect(page.getByTestId('editor-header')).toBeVisible();
    await expect(page.locator('.cm-activeLine')).toHaveCount(1);
  });

  test('continueLists off: Return in a list is a plain newline', async ({ page }) => {
    await open(page, { settings: { editor: { continueLists: false } } });
    await typeAtEnd(page, '- item');
    await page.keyboard.press('Enter');
    await page.keyboard.type('x');
    await expect(page.locator('.cm-line', { hasText: /^x$/ })).toHaveCount(1);
  });

  test('autoPair on pairs brackets, ** and backticks, and not inside a fence', async ({ page }) => {
    await open(page, { settings: { editor: { autoPair: true } } });
    await typeAtEnd(page, '(');
    await expect(page.locator('.cm-line', { hasText: '()' })).toHaveCount(1);
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('**');
    await expect(page.locator('.cm-line', { hasText: '****' })).toHaveCount(1);
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('`');
    await expect(page.locator('.cm-line', { hasText: '``' })).toHaveCount(1);
  });

  test('autoPair does not pair inside a fenced code block', async ({ page }) => {
    await open(page, {
      settings: { editor: { autoPair: true } },
      files: { [NOTE]: '```\ncode\n```\n' },
    });
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await page.keyboard.type('(');
    await expect(page.locator('.cm-line', { hasText: /^code\($/ })).toHaveCount(1);
  });

  test('insertSpaces off: Tab inserts a tab character', async ({ page }) => {
    await open(page, { settings: { editor: { insertSpaces: false } } });
    await typeAtEnd(page, 'abc');
    await page.keyboard.press('Tab');
    const text = await page.evaluate(
      () => document.querySelector('.cm-content')?.textContent ?? '',
    );
    expect(text).toContain('\tabc');
  });
});

const dirtyDot = (page: Page) => page.getByTestId('dirty-dot');
const saves = (page: Page) => mock(page, (m) => m.saves.length);

test.describe('D13 auto-save', () => {
  test('saves 2 s after the last edit and clears the dot', async ({ page }) => {
    await open(page, { settings: { saving: { autoSave: true } } });
    await typeAtEnd(page, 'one');
    await expect(dirtyDot(page)).toBeVisible();
    await page.waitForTimeout(1200);
    await page.keyboard.type('two');
    await page.waitForTimeout(1200);
    expect(await saves(page)).toBe(0);
    await expect.poll(() => saves(page), { timeout: 5000 }).toBe(1);
    expect(await mock(page, (m) => m.saves[0]?.text.endsWith('onetwo'))).toBe(true);
    await expect(dirtyDot(page)).toHaveCount(0);
  });

  test('is off by default', async ({ page }) => {
    await open(page);
    await typeAtEnd(page, 'one');
    await page.waitForTimeout(2600);
    expect(await saves(page)).toBe(0);
    await expect(dirtyDot(page)).toBeVisible();
  });

  test('saves at once when the tab is switched away', async ({ page }) => {
    const other = `${HOME}/Documents/other.md`;
    await open(page, { settings: { saving: { autoSave: true } }, files: { [other]: '# Other\n' } });
    await typeAtEnd(page, 'x');
    await mock(page, (m) => m.openFiles(['/Users/mock/Documents/other.md']));
    await expect.poll(() => saves(page)).toBe(1);
  });

  test('saves at once when the window loses focus', async ({ page }) => {
    await open(page, { settings: { saving: { autoSave: true } } });
    await typeAtEnd(page, 'x');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect.poll(() => saves(page), { timeout: 1500 }).toBe(1);
  });

  test('never saves an untitled document', async ({ page }) => {
    await open(page, { settings: { saving: { autoSave: true } } }, null);
    await menu(page, 'new');
    await expect(editor(page)).toBeVisible();
    await typeAtEnd(page, 'draft');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForTimeout(2600);
    expect(await saves(page)).toBe(0);
    await expect(dirtyDot(page)).toBeVisible();
  });

  test('turning it off cancels the wait', async ({ page }) => {
    await open(page, { settings: { saving: { autoSave: true } } });
    await typeAtEnd(page, 'x');
    await change(page, { saving: { autoSave: false } });
    await page.waitForTimeout(2600);
    expect(await saves(page)).toBe(0);
  });
});

test.describe('D14 auto-save with the file changed outside', () => {
  test('does not write, shows the banner, and Keep Mine then saves', async ({ page }) => {
    await open(page, { settings: { saving: { autoSave: true } }, ask: false });
    await typeAtEnd(page, 'mine');
    await page.evaluate(
      ([path, text]) => window.__WRITEDOWN_MOCK__?.externallyModify(path as string, text as string),
      [NOTE, '# Theirs\n'],
    );
    const banner = page.getByTestId('banner-external');
    await expect(banner).toBeVisible({ timeout: 6000 });
    expect(await saves(page)).toBe(0);
    expect(await mock(page, (m) => m.file('/Users/mock/Documents/note.md')?.text)).toBe(
      '# Theirs\n',
    );
    await banner.getByRole('button', { name: 'Keep Mine' }).click();
    await expect.poll(() => saves(page)).toBe(1);
    await expect(banner).toHaveCount(0);
    expect(
      await mock(page, (m) => m.file('/Users/mock/Documents/note.md')?.text.endsWith('mine')),
    ).toBe(true);
    await expect(dirtyDot(page)).toHaveCount(0);
  });
});

test.describe('D15 new documents', () => {
  test('take CRLF and no final newline; an existing LF file keeps LF', async ({ page }) => {
    await open(page, { settings: { saving: { newLineEnding: 'crlf' } } }, null);
    await menu(page, 'new');
    await expect(editor(page)).toBeVisible();
    await typeAtEnd(page, 'a\nb');
    await page.evaluate(() =>
      window.__WRITEDOWN_MOCK__?.setAnswers({ saveDialog: '/Users/mock/Documents/new.md' }),
    );
    await menu(page, 'save');
    await expect.poll(() => saves(page)).toBe(1);
    const saved = await mock(page, (m) => m.saves[0]);
    expect(saved?.format.lineEnding).toBe('crlf');
    expect(saved?.text).toBe('a\nb');
    expect(await mock(page, (m) => m.file('/Users/mock/Documents/new.md')?.bytes)).toBe(4);
  });

  test('final newline off (default): saved as typed; on adds one, never two', async ({ page }) => {
    await open(page, {}, null);
    await menu(page, 'new');
    await expect(editor(page)).toBeVisible();
    await typeAtEnd(page, 'a');
    await page.evaluate(() =>
      window.__WRITEDOWN_MOCK__?.setAnswers({ saveDialog: '/Users/mock/Documents/new.md' }),
    );
    await menu(page, 'save');
    await expect.poll(() => saves(page)).toBe(1);
    expect((await mock(page, (m) => m.saves[0]))?.text).toBe('a');

    await change(page, { saving: { newFinalNewline: true } });
    await menu(page, 'new');
    await typeAtEnd(page, 'b');
    await page.evaluate(() =>
      window.__WRITEDOWN_MOCK__?.setAnswers({ saveDialog: '/Users/mock/Documents/two.md' }),
    );
    await menu(page, 'save');
    await expect.poll(() => saves(page)).toBe(2);
    expect((await mock(page, (m) => m.saves[1]))?.text).toBe('b\n');

    await menu(page, 'new');
    await typeAtEnd(page, 'c\n');
    await page.evaluate(() =>
      window.__WRITEDOWN_MOCK__?.setAnswers({ saveDialog: '/Users/mock/Documents/three.md' }),
    );
    await menu(page, 'save');
    await expect.poll(() => saves(page)).toBe(3);
    expect((await mock(page, (m) => m.saves[2]))?.text).toBe('c\n');
  });

  test('an existing LF file saves as LF even when new files are CRLF', async ({ page }) => {
    await open(page, { settings: { saving: { newLineEnding: 'crlf' } } });
    await typeAtEnd(page, 'z');
    await menu(page, 'save');
    await expect.poll(() => saves(page)).toBe(1);
    const saved = await mock(page, (m) => m.saves[0]);
    expect(saved?.format.lineEnding).toBe('lf');
    expect(saved?.text).toBe(`${NOTE_TEXT}z`);
  });
});

test.describe('D16 default folder', () => {
  test('the Save dialog of an untitled document starts in the default folder', async ({ page }) => {
    await open(page, { settings: { saving: { defaultFolder: `${HOME}/Documents` } } }, null);
    await menu(page, 'new');
    await expect(editor(page)).toBeVisible();
    await typeAtEnd(page, 'a');
    await menu(page, 'save');
    await expect
      .poll(() => mock(page, (m) => m.saveDialogs.map((d) => d.directory)))
      .toEqual([`${HOME}/Documents`]);
  });

  test('without a default folder the dialog gets no folder', async ({ page }) => {
    await open(page, {}, null);
    await menu(page, 'new');
    await expect(editor(page)).toBeVisible();
    await typeAtEnd(page, 'a');
    await menu(page, 'save');
    await expect
      .poll(() => mock(page, (m) => m.saveDialogs.map((d) => d.directory)))
      .toEqual([null]);
  });
});
