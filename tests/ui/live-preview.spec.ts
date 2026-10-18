/**
 * Live preview in the editor: syntax hidden outside the lines being edited, on the mock
 * platform. The text itself never changes.
 */
import { expect, type Page, test } from '@playwright/test';
import { editor, HOME, menu, seedMock } from './helpers';

const NOTE = `${HOME}/Documents/note.md`;
const TEXT = [
  '# Title',
  '',
  'Some **bold**, *italic* and `code` with a [link](https://example.com).',
  '',
  '- first',
  '- [ ] open task',
  '- [x] done task',
  '',
  '> quoted',
  '',
  '---',
  '',
  '![Chart](pics/chart.png)',
  '',
  'last line',
  '',
].join('\n');

async function open(page: Page, livePreview: boolean) {
  await seedMock(page, {
    files: { [NOTE]: TEXT },
    launch: { openPath: NOTE, view: 'editor' },
    settings: { editor: { livePreview } },
  });
  await page.goto('/');
  await expect(editor(page)).toContainText('last line');
}

const visibleText = (page: Page) =>
  page
    .locator('[data-testid=editor] .cm-content')
    .evaluate((element) => (element as HTMLElement).innerText);

test('the syntax is hidden outside the caret line and shows again on it', async ({ page }) => {
  await open(page, true);
  // The caret is on line 1: the heading shows its marks, the rest is drawn.
  await expect.poll(() => visibleText(page)).toContain('Some bold, italic and code with a link.');
  const text = await visibleText(page);
  expect(text).toContain('# Title');
  expect(text).not.toContain('**');
  expect(text).not.toContain('](https://example.com)');
  expect(text).not.toContain('> quoted');
  await expect(editor(page).locator('.cm-lp-heading.cm-lp-h1')).toHaveCount(1);
  await expect(editor(page).locator('.cm-lp-bullet')).toHaveCount(1);
  await expect(editor(page).locator('input.cm-lp-task')).toHaveCount(2);
  await expect(editor(page).locator('.cm-lp-rule')).toHaveCount(1);
  await expect(editor(page).locator('.cm-lp-image')).toHaveCount(1);

  // On the caret line the source comes back; the heading marks hide once the caret leaves.
  await editor(page).locator('.cm-line', { hasText: 'bold' }).click();
  await expect.poll(() => visibleText(page)).toContain('**bold**');
  expect(await visibleText(page)).not.toContain('# Title');
});

test('a checkbox toggles the task in the text', async ({ page }) => {
  await open(page, true);
  await editor(page).locator('input.cm-lp-task').first().click();

  await expect(editor(page).locator('input.cm-lp-task:checked')).toHaveCount(2);
  await menu(page, 'toggle-live-preview');
  await expect.poll(() => visibleText(page)).toContain('- [x] open task');
});

test('the View menu turns it on and off, and off shows the plain source', async ({ page }) => {
  await open(page, false);
  expect(await visibleText(page)).toContain('**bold**');

  await menu(page, 'toggle-live-preview');
  await expect.poll(() => visibleText(page)).not.toContain('**bold**');

  await menu(page, 'toggle-live-preview');
  await expect.poll(() => visibleText(page)).toContain('**bold**');
  const settings = await page.evaluate(
    () => window.__BACKTICKLE_MOCK__?.settings.editor.livePreview,
  );
  expect(settings).toBe(false);
});
