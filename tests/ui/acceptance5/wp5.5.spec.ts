/** WP5.5 acceptance: the Snippets tab, CRUD, insertion, triggers. */
import { expect, type Page, test } from '@playwright/test';
import { editor, HOME, menu, seedMock } from '../helpers';

const DOC = `${HOME}/note.md`;
const CUSTOM = [
  { id: 'a', name: 'Sign off', trigger: 'sig', body: 'Regards,\nAlex\n' },
  { id: 'b', name: 'Stamp', trigger: '', body: 'on {{date}} at {{time}}' },
  { id: 'c', name: 'Quote', trigger: 'qt', body: '> {{selection}}|{{unknown}}' },
];

async function open(page: Page, extra: Record<string, unknown> = {}) {
  await seedMock(page, {
    files: { [DOC]: 'Hello world\n' },
    launch: { openPath: DOC, view: 'editor' },
    snippets: CUSTOM,
    ...extra,
  });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');
  await expect(editor(page)).toBeVisible();
}

const stored = (page: Page) => page.evaluate(() => window.__BACKTICKLE_MOCK__?.snippets ?? []);
const docText = (page: Page) => editor(page).evaluate((el) => (el as HTMLElement).innerText);

async function showTab(page: Page) {
  await page.getByTestId('sidebar-tab-snippets').click();
  await expect(page.getByTestId('snippets-panel')).toBeVisible();
}

test.describe('E5.5 snippets', () => {
  test('E5.5-1 the fourth sidebar tab lists the snippets', async ({ page }) => {
    await open(page);
    const tabs = page.getByTestId('sidebar-tabs').getByRole('tab');
    await expect(tabs).toHaveCount(4);
    await expect(tabs.nth(3)).toHaveAccessibleName('Snippets');
    await showTab(page);
    await expect(page.getByTestId('snippet-row')).toHaveCount(3);
    await expect(page.getByTestId('snippet-row').first()).toContainText('Sign off');
    await expect(page.getByTestId('snippet-row').first()).toContainText('sig');
  });

  test('E5.5-2 the first use offers the five starter snippets', async ({ page }) => {
    await open(page, { snippets: undefined });
    await showTab(page);
    await expect(page.getByTestId('snippet-row')).toHaveCount(5);
    const names = await page.getByTestId('snippet-insert').allInnerTexts();
    expect(names.map((n) => n.split('\n')[0])).toEqual([
      'Callout',
      'Table',
      'Task list',
      'Footnote',
      'Frontmatter',
    ]);
  });

  test('E5.5-3 New adds a snippet and it is stored', async ({ page }) => {
    await open(page);
    await showTab(page);
    await page.getByTestId('snippets-new').click();
    await page.getByTestId('snippet-name').fill('Greeting');
    await page.getByTestId('snippet-trigger').fill('hi');
    await page.getByTestId('snippet-body').fill('Hello, {{selection}}!');
    await page.getByTestId('snippet-save').click();
    await expect(page.getByTestId('snippet-row')).toHaveCount(4);
    const list = await stored(page);
    expect(list.at(-1)).toMatchObject({
      name: 'Greeting',
      trigger: 'hi',
      body: 'Hello, {{selection}}!',
    });
  });

  test('E5.5-4 the form refuses a missing name, a bad trigger and a used trigger', async ({
    page,
  }) => {
    await open(page);
    await showTab(page);
    await page.getByTestId('snippets-new').click();
    await page.getByTestId('snippet-save').click();
    await expect(page.getByTestId('snippet-error')).toContainText('name');
    await page.getByTestId('snippet-name').fill('X');
    await page.getByTestId('snippet-trigger').fill('no good');
    await page.getByTestId('snippet-save').click();
    await expect(page.getByTestId('snippet-error')).toContainText('trigger');
    await page.getByTestId('snippet-trigger').fill('sig');
    await page.getByTestId('snippet-save').click();
    await expect(page.getByTestId('snippet-error')).toContainText('Sign off');
    expect(await stored(page)).toHaveLength(3);
    await page.getByTestId('snippet-cancel').click();
    await expect(page.getByTestId('snippet-row')).toHaveCount(3);
  });

  test('E5.5-5 Edit changes a snippet in place', async ({ page }) => {
    await open(page);
    await showTab(page);
    await page.getByTestId('snippet-row').nth(1).getByTestId('snippet-edit').click();
    await expect(page.getByTestId('snippet-name')).toHaveValue('Stamp');
    await page.getByTestId('snippet-name').fill('Date stamp');
    await page.getByTestId('snippet-trigger').fill('ds');
    await page.getByTestId('snippet-save').click();
    const list = await stored(page);
    expect(list.map((s) => s.name)).toEqual(['Sign off', 'Date stamp', 'Quote']);
    expect(list[1]?.trigger).toBe('ds');
    expect(list[1]?.id).toBe('b');
  });

  test('E5.5-6 Delete asks, and removes only after a yes', async ({ page }) => {
    await open(page, { ask: [false, true] });
    await showTab(page);
    await page.getByTestId('snippet-row').first().getByTestId('snippet-delete').click();
    await expect(page.getByTestId('snippet-row')).toHaveCount(3);
    await page.getByTestId('snippet-row').first().getByTestId('snippet-delete').click();
    await expect(page.getByTestId('snippet-row')).toHaveCount(2);
    expect((await stored(page)).map((s) => s.id)).toEqual(['b', 'c']);
  });

  test('E5.5-7 a click inserts at the cursor and the variables are filled', async ({ page }) => {
    await open(page);
    await showTab(page);
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.getByTestId('snippet-row').nth(1).getByTestId('snippet-insert').click();
    const text = await docText(page);
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(text).toMatch(new RegExp(`on ${iso} at \\d\\d:\\d\\d`));
    await expect(editor(page)).toBeFocused();
  });

  test('E5.5-8 a click replaces the selection and {{selection}} holds it; unknown stays', async ({
    page,
  }) => {
    await open(page);
    await showTab(page);
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.press('Shift+End');
    await page.getByTestId('snippet-row').nth(2).getByTestId('snippet-insert').click();
    expect((await docText(page)).trim()).toBe('> Hello world|{{unknown}}');
  });

  test('E5.5-9 the insertion is one undo step', async ({ page }) => {
    await open(page);
    await showTab(page);
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.getByTestId('snippet-row').first().getByTestId('snippet-insert').click();
    expect(await docText(page)).toContain('Regards,');
    await page.keyboard.press('ControlOrMeta+z');
    expect((await docText(page)).trim()).toBe('Hello world');
  });

  test('E5.5-10 typing a trigger offers the snippet; Tab inserts it in place of the word', async ({
    page,
  }) => {
    await open(page);
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('sig');
    await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('Sign off');
    await page.waitForTimeout(150);
    await page.keyboard.press('Tab');
    await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0);
    expect((await docText(page)).trim()).toBe('Hello world\nRegards,\nAlex');
  });

  test('E5.5-11 Return also accepts, and the pick is one undo step', async ({ page }) => {
    await open(page);
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('qt');
    await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('Quote');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    expect(await docText(page)).toContain('> |{{unknown}}');
    await page.keyboard.press('ControlOrMeta+z');
    expect(await docText(page)).not.toContain('{{unknown}}');
  });

  test('E5.5-12 a snippet without a trigger is never offered', async ({ page }) => {
    await open(page);
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('Stamp');
    await page.waitForTimeout(300);
    await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0);
  });

  test('E5.5-13 with no triggers at all no completion source is registered', async ({ page }) => {
    await open(page, { snippets: [{ id: 'z', name: 'Plain', trigger: '', body: 'x' }] });
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('Plain');
    await page.waitForTimeout(300);
    await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0);
  });

  test('E5.5-14 a trigger added in the tab works at once, a deleted one stops', async ({
    page,
  }) => {
    await open(page, { ask: true });
    await showTab(page);
    await page.getByTestId('snippets-new').click();
    await page.getByTestId('snippet-name').fill('Dash');
    await page.getByTestId('snippet-trigger').fill('dsh');
    await page.getByTestId('snippet-body').fill('---');
    await page.getByTestId('snippet-save').click();
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('dsh');
    await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('Dash');
    await page.keyboard.press('Escape');
    for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');
    await page.getByTestId('snippet-row').last().getByTestId('snippet-delete').click();
    await expect(page.getByTestId('snippet-row')).toHaveCount(3);
    await editor(page).click();
    await page.keyboard.type('dsh');
    await page.waitForTimeout(300);
    await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0);
  });

  test('E5.5-15 a GFM document that is only read loads no snippets chunk', async ({ page }) => {
    const urls: string[] = [];
    page.on('request', (request) => {
      if (/editor\/snippets|SnippetsPanel|shell\/snippets/.test(request.url())) {
        urls.push(request.url());
      }
    });
    await seedMock(page, {
      files: { [DOC]: '# Plain\n\nText.\n' },
      launch: { openPath: DOC, view: 'preview' },
    });
    await page.goto('/');
    await expect(page.getByTestId('document-name')).toHaveText('note.md');
    expect(urls).toEqual([]);
  });

  test('E5.5-16 the Show Snippets palette command opens the tab', async ({ page }) => {
    await open(page);
    await menu(page, 'command-palette');
    await page.getByTestId('picker-input').fill('show snippets');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('sidebar-tab-snippets')).toHaveAttribute('aria-selected', 'true');
  });

  test('E5.5-17 the tab row fits at 240 px, also at interface scale 1.5 (no clipping)', async ({
    page,
  }) => {
    for (const scale of [1, 1.5]) {
      await open(page, { settings: { a11y: { scale } } });
      const row = page.getByTestId('sidebar-tabs');
      // At 1.0 the four tabs share one row; at 1.5 the row may wrap (as before), never clip.
      const tops = await row
        .getByRole('tab')
        .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
      if (scale === 1) expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2);
      else expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(80);
      const fits = await row.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
      expect(fits, `scale ${scale}`).toBe(true);
      const box = await page.getByTestId('sidebar').boundingBox();
      expect(box?.width).toBeLessThanOrEqual(241);
    }
  });
});
