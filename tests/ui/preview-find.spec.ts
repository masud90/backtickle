/**
 * Find in Preview. Mock platform, real WebKit. Expected
 * counts come from the text the tests build themselves. Run with WD_UI_PORT=1467.
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
  setView,
} from './acceptance2/common';

const FILE = `${DOCS}/find.md`;
const TEXT = [
  '# Alpha notes',
  '',
  'The alpha line says Alpha once more.',
  '',
  '| a | b |',
  '| - | - |',
  '| alpha | beta |',
  '',
  '- item alpha',
  '- item gamma',
  '',
  '```js',
  'const alpha = 1;',
  '```',
  '',
  'Last paragraph, no match here except alpha.',
  '',
].join('\n');

const bar = (page: Page) => page.getByTestId('preview-find');
const field = (page: Page) => page.getByTestId('preview-find-input');
const count = (page: Page) => page.getByTestId('preview-find-count');
const highlighted = (page: Page, name: 'wd-find' | 'wd-find-current') =>
  page.evaluate((key) => {
    const set = CSS.highlights.get(key);
    return set ? [...set].map((range) => (range as Range).toString()) : [];
  }, name);

async function openDocument(page: Page, text: string, view: 'preview' | 'split' = 'preview') {
  await page.setViewportSize({ width: 1280, height: 820 });
  await launch(page, { seed: { files: { [FILE]: text } }, open: FILE, view });
  await expect(preview(page).locator('.wd-block').first()).toBeVisible({ timeout: 60_000 });
}

test.describe('C07 find in the preview', () => {
  test('C07 opens over the preview, counts, moves and clears', async ({ page }) => {
    await openDocument(page, TEXT);
    await expect(bar(page)).toHaveCount(0);

    await menu(page, 'find');
    await expect(bar(page)).toBeVisible();
    await expect(field(page)).toBeFocused();

    await field(page).fill('alpha');
    // Case-insensitive: Alpha (heading), alpha, Alpha, alpha (cell), alpha (item), alpha (code), alpha.
    await expect(count(page)).toHaveText('1 of 7');
    expect(await highlighted(page, 'wd-find-current')).toEqual(['Alpha']);
    expect((await highlighted(page, 'wd-find')).length).toBe(6);

    await field(page).press('Enter');
    await expect(count(page)).toHaveText('2 of 7');
    expect(await highlighted(page, 'wd-find-current')).toEqual(['alpha']);

    await field(page).press('Shift+Enter');
    await expect(count(page)).toHaveText('1 of 7');
    await field(page).press('Shift+Enter');
    await expect(count(page)).toHaveText('7 of 7');

    await menu(page, 'find-next');
    await expect(count(page)).toHaveText('1 of 7');
    await menu(page, 'find-previous');
    await expect(count(page)).toHaveText('7 of 7');
  });

  test('C07 match case narrows the matches', async ({ page }) => {
    await openDocument(page, TEXT);
    await menu(page, 'find');
    await field(page).fill('alpha');
    await expect(count(page)).toHaveText('1 of 7');
    await page.getByTestId('preview-find-case').click();
    await expect(count(page)).toHaveText('1 of 5');
    await field(page).fill('Alpha');
    await expect(count(page)).toHaveText(/ of 2$/);
    expect(await highlighted(page, 'wd-find-current')).toEqual(['Alpha']);
    await field(page).fill('nothing-like-this');
    await expect(count(page)).toHaveText('No matches');
    expect(await highlighted(page, 'wd-find')).toEqual([]);
  });

  test('C07 the buttons move, and Escape closes and clears', async ({ page }) => {
    await openDocument(page, TEXT);
    await menu(page, 'find');
    await field(page).fill('beta');
    await expect(count(page)).toHaveText('1 of 1');
    await page.getByTestId('preview-find-next').click();
    await expect(count(page)).toHaveText('1 of 1');
    await field(page).fill('gamma');
    expect(await highlighted(page, 'wd-find-current')).toEqual(['gamma']);

    await field(page).press('Escape');
    await expect(bar(page)).toHaveCount(0);
    expect(await highlighted(page, 'wd-find-current')).toEqual([]);
    expect(await highlighted(page, 'wd-find')).toEqual([]);
    // The preview itself is untouched: no wrapper elements were added for highlights.
    await expect(preview(page).locator('mark')).toHaveCount(0);
  });

  test('C07 a match below the fold is scrolled into view', async ({ page }) => {
    const filler = Array.from({ length: 120 }, (_, i) => `Filler paragraph ${i}.\n`).join('\n');
    await openDocument(page, `# Top\n\n${filler}\nThe zebra is at the end.\n`);
    await menu(page, 'find');
    await field(page).fill('zebra');
    await expect(count(page)).toHaveText('1 of 1');
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const scroller = document.querySelector('[data-testid="preview-scroll"]') as HTMLElement;
          const range = CSS.highlights.get('wd-find-current')?.values().next().value as Range;
          const box = scroller.getBoundingClientRect();
          const rect = range.getBoundingClientRect();
          return rect.top >= box.top && rect.bottom <= box.bottom;
        }),
      )
      .toBe(true);
  });

  test('C07 Find in Split goes to the editor unless the preview has the focus', async ({
    page,
  }) => {
    await openDocument(page, TEXT, 'split');
    await editor(page).click();
    await menu(page, 'find');
    await expect(page.locator('.cm-search')).toBeVisible();
    await expect(bar(page)).toHaveCount(0);

    await page.getByTestId('preview-scroll').focus();
    await menu(page, 'find');
    await expect(bar(page)).toBeVisible();
    await expect(field(page)).toBeFocused();
  });
});

test.describe('C08 find in a large document', () => {
  test('C08 a match in a far block is counted and revealed', async ({ page }) => {
    const base = readFileSync(join(FIXTURES, 'generated', 'large-5m.md'), 'utf8').split('\n');
    // Two markers, in paragraphs of their own: one in the middle, one near the end.
    const at = (line: number) => {
      let i = line;
      while (i < base.length && base[i] !== '') i++;
      return i;
    };
    const middle = at(50000);
    const end = at(base.length - 40);
    base.splice(end, 0, '', 'The marker zxqvault ends the file.');
    base.splice(middle, 0, '', 'The marker zxqvault sits in the middle.');
    const text = base.join('\n');

    await openDocument(page, text);
    await menu(page, 'find');
    await field(page).fill('zxqvault');
    await expect(count(page)).toHaveText('1 of 2', { timeout: 60_000 });

    const inView = () =>
      page.evaluate(() => {
        const scroller = document.querySelector('[data-testid="preview-scroll"]') as HTMLElement;
        const range = CSS.highlights.get('wd-find-current')?.values().next().value as
          | Range
          | undefined;
        if (!range) return null;
        const box = scroller.getBoundingClientRect();
        const rect = range.getBoundingClientRect();
        return {
          text: range.toString(),
          visible: rect.height > 0 && rect.top >= box.top && rect.bottom <= box.bottom,
        };
      });
    await expect.poll(inView, { timeout: 20_000 }).toEqual({ text: 'zxqvault', visible: true });

    await field(page).press('Enter');
    await expect(count(page)).toHaveText('2 of 2');
    await expect.poll(inView, { timeout: 20_000 }).toEqual({ text: 'zxqvault', visible: true });

    await field(page).press('Enter');
    await expect(count(page)).toHaveText('1 of 2');
    await expect.poll(inView, { timeout: 20_000 }).toEqual({ text: 'zxqvault', visible: true });
  });
});

test.describe('C09 find and replace from the preview', () => {
  test('C09 switches to Split with the replace bar; Replace All is one undo step', async ({
    page,
  }) => {
    await openDocument(page, TEXT);
    await menu(page, 'find-replace');
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'split');
    await expect(page.locator('.cm-search.wd-replace')).toBeVisible();

    await page.locator('.cm-search input[name=search]').fill('gamma');
    await page.locator('.cm-search input[name=replace]').fill('delta');
    await page.locator('.cm-search button[name=replaceAll]').click();
    await expect(editor(page)).toContainText('- item delta');
    expect(await editorText(page)).not.toContain('gamma');

    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+z');
    expect(await editorText(page)).toContain('- item gamma');
    expect(await editorText(page)).not.toContain('delta');
    await setView(page, 'split');
  });
});
