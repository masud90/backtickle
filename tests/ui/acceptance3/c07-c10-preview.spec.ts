/**
 * Phase 3 acceptance C07 to C10: find in Preview, find and replace from
 * Preview, and click to source. Mock platform, real WebKit. Expected counts and lines are worked
 * out from the document text each test builds; the large document is the generated 5 MiB file.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Page, test } from '@playwright/test';
import {
  DOCS,
  editor,
  editorText,
  expect,
  FIXTURES,
  launch,
  menu,
  preview,
  selectionOf,
  setSelection,
  setView,
} from './support';

const FILE = `${DOCS}/c07.md`;
const bar = (page: Page) => page.getByTestId('preview-find');
const field = (page: Page) => page.getByTestId('preview-find-input');
const count = (page: Page) => page.getByTestId('preview-find-count');
const scroller = (page: Page) => page.getByTestId('preview-scroll');

async function open(page: Page, text: string, view: 'preview' | 'split' = 'preview') {
  await page.setViewportSize({ width: 1280, height: 760 });
  await launch(page, { seed: { files: { [FILE]: text } }, open: FILE, view });
  await expect(preview(page).locator('.wd-block').first()).toBeAttached({ timeout: 60_000 });
}

/** The ranges of a CSS highlight as text. */
const highlight = (page: Page, name: string) =>
  page.evaluate((key) => {
    const set = CSS.highlights.get(key);
    return set ? [...set].map((range) => (range as Range).toString()) : [];
  }, name);

/** True when the current highlight is inside the visible part of the preview. */
const currentInView = (page: Page) =>
  page.evaluate(() => {
    const host = document.querySelector('[data-testid="preview-scroll"]') as HTMLElement;
    const range = CSS.highlights.get('wd-find-current')?.values().next().value as Range | undefined;
    if (!range) return false;
    const box = host.getBoundingClientRect();
    const rect = range.getBoundingClientRect();
    return rect.height > 0 && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1;
  });

// Matches of "ember" in this text (case-insensitive), counted by hand in reading order:
//   1 "Ember" (heading)  2 "ember" (paragraph, first)  3 "Ember" (paragraph, second)
//   4 "ember" (table cell)  5 "ember" (list item)  6 "ember" (code)  7 "ember" (last paragraph)
// With match case on, "ember" has 5 (all but the two capitalized) and "Ember" has 2.
const TEXT = [
  '# Ember notes',
  '',
  'One ember glows. Another Ember fades.',
  '',
  '| k | v |',
  '| - | - |',
  '| ember | coal |',
  '',
  '- list ember',
  '- list ash',
  '',
  '```js',
  'const ember = 1;',
  '```',
  '',
  ...Array.from({ length: 70 }, (_, i) => `Padding paragraph ${i}.\n`),
  'The final ember sits at the very end.',
  '',
].join('\n');

test.describe('C07 find in the preview', () => {
  test('C07 opens with the menu command, highlights, counts and moves', async ({ page }) => {
    await open(page, TEXT);
    await expect(bar(page)).toHaveCount(0);
    await menu(page, 'find');
    await expect(bar(page)).toBeVisible();
    await expect(field(page)).toBeFocused();

    await field(page).fill('ember');
    await expect(count(page)).toHaveText('1 of 7');
    expect(await highlight(page, 'wd-find-current')).toEqual(['Ember']);
    expect(await highlight(page, 'wd-find')).toHaveLength(6);

    await field(page).press('Enter');
    await expect(count(page)).toHaveText('2 of 7');
    await field(page).press('Shift+Enter');
    await expect(count(page)).toHaveText('1 of 7');
    await field(page).press('Shift+Enter');
    await expect(count(page)).toHaveText('7 of 7');
    // The last match is below the fold: it was scrolled into view.
    await expect.poll(() => currentInView(page)).toBe(true);
    expect(await scroller(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(100);

    // Next and previous commands (the menu items behind the shortcuts).
    await menu(page, 'find-next');
    await expect(count(page)).toHaveText('1 of 7');
    await menu(page, 'find-previous');
    await expect(count(page)).toHaveText('7 of 7');
  });

  test('C07 the buttons move through the matches', async ({ page }) => {
    await open(page, TEXT);
    await menu(page, 'find');
    await field(page).fill('list');
    await expect(count(page)).toHaveText('1 of 2');
    await page.getByTestId('preview-find-next').click();
    await expect(count(page)).toHaveText('2 of 2');
    await page.getByTestId('preview-find-next').click();
    await expect(count(page)).toHaveText('1 of 2');
  });

  test('C07 match case narrows the matches', async ({ page }) => {
    await open(page, TEXT);
    await menu(page, 'find');
    await field(page).fill('ember');
    await expect(count(page)).toHaveText('1 of 7');
    await page.getByTestId('preview-find-case').click();
    await expect(count(page)).toHaveText(/^\d of 5$/);
    await field(page).fill('Ember');
    await expect(count(page)).toHaveText(/^\d of 2$/);
  });

  test('C07 no match says so and clears the highlights', async ({ page }) => {
    await open(page, TEXT);
    await menu(page, 'find');
    await field(page).fill('ember');
    await expect(count(page)).toHaveText('1 of 7');
    await field(page).fill('zzzz');
    await expect(count(page)).toHaveText('No matches');
    expect(await highlight(page, 'wd-find')).toEqual([]);
    expect(await highlight(page, 'wd-find-current')).toEqual([]);
  });

  test('C07 Escape closes the bar and clears the highlights without touching the DOM', async ({
    page,
  }) => {
    await open(page, TEXT);
    const before = await preview(page).innerHTML();
    await menu(page, 'find');
    await field(page).fill('ash');
    await expect(count(page)).toHaveText('1 of 1');
    await field(page).press('Escape');
    await expect(bar(page)).toHaveCount(0);
    expect(await highlight(page, 'wd-find')).toEqual([]);
    expect(await highlight(page, 'wd-find-current')).toEqual([]);
    expect(await preview(page).innerHTML()).toBe(before);
  });
});

test.describe('C08 find in the 5 MiB document', () => {
  test('C08 a match in a far block is counted and revealed', async ({ page }) => {
    test.setTimeout(180_000);
    const lines = readFileSync(join(FIXTURES, 'generated', 'large-5m.md'), 'utf8').split('\n');
    const blankAfter = (from: number) => {
      let i = from;
      while (i < lines.length && lines[i] !== '') i++;
      return i;
    };
    // Markers go into paragraphs of their own, at about 40% and at the very end of the file.
    const middle = blankAfter(Math.floor(lines.length * 0.4));
    const end = blankAfter(lines.length - 30);
    lines.splice(end, 0, '', 'The marker qzvfinal closes the file.');
    lines.splice(middle, 0, '', 'The marker qzvfinal sits in the middle.');

    await open(page, lines.join('\n'));
    await menu(page, 'find');
    await field(page).fill('qzvfinal');
    await expect(count(page)).toHaveText('1 of 2', { timeout: 90_000 });
    await expect.poll(() => currentInView(page), { timeout: 30_000 }).toBe(true);
    expect(await highlight(page, 'wd-find-current')).toEqual(['qzvfinal']);

    await field(page).press('Enter');
    await expect(count(page)).toHaveText('2 of 2');
    await expect.poll(() => currentInView(page), { timeout: 30_000 }).toBe(true);
    // The far block is below the first one: the preview scrolled down.
    const farTop = await scroller(page).evaluate((el) => el.scrollTop);
    await field(page).press('Enter');
    await expect(count(page)).toHaveText('1 of 2');
    await expect.poll(() => currentInView(page), { timeout: 30_000 }).toBe(true);
    expect(await scroller(page).evaluate((el) => el.scrollTop)).toBeLessThan(farTop);
  });
});

test.describe('C09 find and replace from the preview', () => {
  test('C09 switches to Split with the replace bar; Replace All is one undo step', async ({
    page,
  }) => {
    await open(page, TEXT);
    await menu(page, 'find-replace');
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'split');
    await expect(page.locator('.cm-search.wd-replace')).toBeVisible();

    await page.locator('.cm-search input[name=search]').fill('list');
    await page.locator('.cm-search input[name=replace]').fill('item');
    await page.locator('.cm-search button[name=replaceAll]').click();
    await expect.poll(() => editorText(page)).toBe(TEXT.replaceAll('list', 'item'));

    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => editorText(page)).toBe(TEXT);
  });
});

// ---- C10 click to source ------------------------------------------------------------------------

const CLICK_FILE = `${DOCS}/c10.md`;
const CLICK_LINES = [
  '# Click heading', // 1
  '',
  'Opening paragraph with a [link](#click-heading).',
  '',
  '- first item',
  '- second item',
  '',
  '| a | b |',
  '| - | - |',
  '| cell uno | cell dos |',
  '',
  '- [ ] a task box',
  '',
  '<details><summary>Summary line</summary>',
  '',
  'Hidden body.',
  '',
  '</details>',
  '',
  '```js',
  'const copyMe = 1;',
  '```',
  '',
  ...Array.from({ length: 80 }, (_, i) => `Filler ${i}.\n`),
  'Distant paragraph at the bottom.',
  '',
];
const CLICK_TEXT = CLICK_LINES.join('\n');
/** The 1-based line of the first line that contains the needle. */
const lineOf = (needle: string) => CLICK_TEXT.split('\n').findIndex((l) => l.includes(needle)) + 1;

async function openSplit(page: Page, text = CLICK_TEXT, name = CLICK_FILE) {
  await page.setViewportSize({ width: 1280, height: 700 });
  await launch(page, { seed: { files: { [name]: text } }, open: name, view: 'split' });
  await expect(preview(page).locator('.wd-block').first()).toBeVisible({ timeout: 60_000 });
}

/** The 1-based line of the editor caret, from the document and the selection (not the status bar). */
async function caretLine(page: Page): Promise<number> {
  const { head } = await selectionOf(page);
  return (await editorText(page)).slice(0, head).split('\n').length;
}

async function caretToStart(page: Page) {
  await setSelection(page, 0);
  expect(await caretLine(page)).toBe(1);
}

test.describe('C10 click to source', () => {
  test('C10 a click on a paragraph, a list item, a table cell and a heading moves the caret', async ({
    page,
  }) => {
    await openSplit(page);
    const targets: Array<[string, string]> = [
      ['Opening paragraph', 'Opening paragraph'],
      ['second item', 'second item'],
      ['cell dos', 'cell uno'],
      ['Click heading', '# Click heading'],
    ];
    for (const [shown, source] of targets) {
      await caretToStart(page);
      await preview(page)
        .getByText(shown)
        .first()
        .click({ position: { x: 3, y: 3 } });
      await expect.poll(() => caretLine(page)).toBe(lineOf(source));
    }
  });

  test('C10 the editor scrolls so that the line is in view', async ({ page }) => {
    await openSplit(page);
    await caretToStart(page);
    await scroller(page).evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const target = preview(page).getByText('Distant paragraph at the bottom.');
    await expect(target).toBeVisible();
    await target.click({ position: { x: 3, y: 3 } });
    await expect.poll(() => caretLine(page)).toBe(lineOf('Distant paragraph'));
    await expect
      .poll(() =>
        page.evaluate(() => {
          const line = [...document.querySelectorAll('[data-testid="editor"] .cm-line')].find(
            (el) => el.textContent?.includes('Distant paragraph'),
          );
          const host = document.querySelector('[data-testid="editor"] .cm-scroller');
          if (!line || !host) return false;
          const a = line.getBoundingClientRect();
          const b = host.getBoundingClientRect();
          return a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
        }),
      )
      .toBe(true);
  });

  test('C10 the keyboard focus stays where it was', async ({ page }) => {
    await openSplit(page);
    await scroller(page).focus();
    await preview(page)
      .getByText('first item')
      .click({ position: { x: 3, y: 3 } });
    await expect.poll(() => caretLine(page)).toBe(lineOf('first item'));
    const inEditor = await page.evaluate(
      () => document.activeElement?.closest('.cm-editor') != null,
    );
    expect(inEditor).toBe(false);
  });

  test('C10 links, summary and task boxes do not move the caret', async ({ page }) => {
    await openSplit(page);
    await caretToStart(page);
    await preview(page).getByRole('link', { name: 'link' }).click();
    await preview(page).locator('summary').click();
    await preview(page).locator('.task-checkbox').first().click({ force: true });
    expect(await caretLine(page)).toBe(1);
  });

  test('C10 Copy buttons do not move the caret', async ({ page }) => {
    await openSplit(page);
    await caretToStart(page);
    const card = preview(page).locator('.code-card').first();
    await card.scrollIntoViewIfNeeded();
    await card.locator('.code-copy').click();
    expect(await caretLine(page)).toBe(1);
  });

  test('C10 tabs of a Quarto tabset do not move the caret', async ({ page }) => {
    const qmd =
      '# Tabs\n\n::: {.panel-tabset}\n## One\n\nFirst panel.\n\n## Two\n\nSecond panel.\n:::\n';
    await openSplit(page, qmd, `${DOCS}/c10.qmd`);
    await caretToStart(page);
    const tab = preview(page).getByRole('tab', { name: 'Two' });
    await expect(tab).toBeVisible();
    await tab.click();
    expect(await caretLine(page)).toBe(1);
  });

  test('C10 selecting text does not move the caret', async ({ page }) => {
    await openSplit(page);
    await caretToStart(page);
    const box = await preview(page).getByText('Opening paragraph').boundingBox();
    if (!box) throw new Error('paragraph not visible');
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    expect(
      await page.evaluate(() => window.getSelection()?.toString().length ?? 0),
    ).toBeGreaterThan(0);
    expect(await caretLine(page)).toBe(1);
  });

  test('C10 in Preview mode a click does nothing to the editor', async ({ page }) => {
    await openSplit(page);
    await caretToStart(page);
    await setView(page, 'preview');
    await preview(page).getByText('first item').click();
    await setView(page, 'split');
    expect(await caretLine(page)).toBe(1);
  });
});
