/**
 * Editable shortcuts, cases E5.10-1 to E5.10-11, against the mock.
 * The menu accelerators themselves are native; their rebuild is covered by the Rust tests
 * (menu_spec.rs) and the gate's real-app check. Run with WD_UI_PORT=1500.
 */
import { expect, type Page, test } from '@playwright/test';
import { editor, HOME, menu, seedMock } from '../helpers';
import { at, openPrefs, settingsNow } from '../prefs-helpers';

const DOC = `${HOME}/note.md`;

async function openShortcuts(page: Page, shortcuts: Record<string, string | null> = {}) {
  await openPrefs(page, { settings: { shortcuts } });
  await page.getByTestId('category-shortcuts').click();
  await page.getByTestId('shortcuts-File').waitFor();
}

const row = (page: Page, command: string) => page.locator(`[data-command="${command}"]`);
const keys = (page: Page, command: string) => row(page, command).getByTestId('shortcut-keys');
const overrides = async (page: Page) => at(await settingsNow(page), 'shortcuts');

async function record(page: Page, command: string, combo: string) {
  await row(page, command).getByTestId('shortcut-change').click();
  await page.keyboard.press(combo);
}

test('E5.10-1 rows have Change; settings, quit and the confirming keys do not', async ({
  page,
}) => {
  await openShortcuts(page);
  await expect(row(page, 'bold').getByTestId('shortcut-change')).toBeVisible();
  await expect(row(page, 'editor:Mod-d').getByTestId('shortcut-change')).toBeVisible();
  for (const fixed of ['settings', 'quit', 'editor:Enter', 'editor:Tab', 'editor:Escape']) {
    await expect(row(page, fixed).getByTestId('shortcut-change')).toHaveCount(0);
  }
  await expect(row(page, 'bold').getByTestId('shortcut-changed')).toHaveCount(0);
  await expect(page.getByTestId('shortcuts-reset-all')).toBeDisabled();
});

test('E5.10-2 recording takes the next combination, marks the row Changed and stores it', async ({
  page,
}) => {
  await openShortcuts(page);
  await record(page, 'bold', 'Alt+Meta+J');
  await expect(keys(page, 'bold')).toHaveText('⌥⌘J');
  await expect(row(page, 'bold').getByTestId('shortcut-changed')).toBeVisible();
  expect(await overrides(page)).toEqual({ bold: '⌥⌘J' });
  // The Return key on the focused Change button starts recording too.
  await row(page, 'italic').getByTestId('shortcut-change').focus();
  await page.keyboard.press('Enter');
  await expect(keys(page, 'italic')).toHaveText('Type a shortcut');
  await page.keyboard.press('Escape');
  await expect(keys(page, 'italic')).toHaveText('⌘I');
});

test('E5.10-3 Escape cancels and Delete removes the shortcut', async ({ page }) => {
  await openShortcuts(page);
  await row(page, 'bold').getByTestId('shortcut-change').click();
  await page.keyboard.press('Escape');
  await expect(keys(page, 'bold')).toHaveText('⌘B');
  expect(await overrides(page)).toEqual({});
  // Escape while recording does not close the Preferences window.
  await expect(page.locator('body')).not.toHaveAttribute('data-prefs-closed', /.*/);

  await row(page, 'bold').getByTestId('shortcut-change').click();
  await page.keyboard.press('Delete');
  await expect(keys(page, 'bold')).toHaveText('None');
  expect(await overrides(page)).toEqual({ bold: null });
});

test('E5.10-4 combinations without a modifier and the reserved ones are refused with a message', async ({
  page,
}) => {
  await openShortcuts(page);
  await row(page, 'bold').getByTestId('shortcut-change').click();
  await page.keyboard.press('b');
  await expect(page.getByTestId('shortcut-refusal')).toContainText('needs');
  await page.keyboard.press('Shift+b');
  await expect(page.getByTestId('shortcut-refusal')).toContainText('needs');
  for (const [combo, shown] of [
    ['Meta+Q', '⌘Q'],
    ['Meta+H', '⌘H'],
    ['Alt+Meta+H', '⌥⌘H'],
    ['Meta+M', '⌘M'],
    ['Meta+Tab', '⌘Tab'],
    ['Meta+Space', '⌘␣'],
    ['Control+Meta+Q', '⌃⌘Q'],
    ['Meta+Comma', '⌘,'],
  ] as const) {
    await page.keyboard.press(combo);
    await expect(page.getByTestId('shortcut-refusal')).toContainText(`${shown} is reserved`);
  }
  expect(await overrides(page)).toEqual({});
  // A function key needs no modifier.
  await page.keyboard.press('F6');
  await expect(keys(page, 'bold')).toHaveText('F6');
  expect(await overrides(page)).toEqual({ bold: 'F6' });
});

test('E5.10-5 a used combination offers Replace or Cancel', async ({ page }) => {
  await openShortcuts(page);
  await record(page, 'italic', 'Meta+K');
  await expect(page.getByTestId('shortcut-conflict')).toContainText('used by Link');
  await page.getByTestId('shortcut-conflict-cancel').click();
  await expect(keys(page, 'italic')).toHaveText('⌘I');
  await expect(keys(page, 'link')).toHaveText('⌘K');
  expect(await overrides(page)).toEqual({});

  await record(page, 'italic', 'Meta+K');
  await page.getByTestId('shortcut-replace').click();
  await expect(keys(page, 'italic')).toHaveText('⌘K');
  await expect(keys(page, 'link')).toHaveText('None');
  expect(await overrides(page)).toEqual({ italic: '⌘K', link: null });
});

test('E5.10-6 an editing key can be changed and conflicts with a menu command', async ({
  page,
}) => {
  await openShortcuts(page);
  await record(page, 'editor:Mod-d', 'Control+Alt+J');
  await expect(keys(page, 'editor:Mod-d')).toHaveText('⌃⌥J');
  expect(await overrides(page)).toEqual({ 'editor:Mod-d': '⌃⌥J' });
  await record(page, 'editor:Mod-a', 'Meta+B');
  await expect(page.getByTestId('shortcut-conflict')).toContainText('used by Bold');
});

test('E5.10-7 Reset restores one row, Reset all every row', async ({ page }) => {
  await openShortcuts(page, { bold: '⌥⌘J', italic: null, 'editor:Mod-d': '⌃⌥J' });
  await expect(keys(page, 'bold')).toHaveText('⌥⌘J');
  await expect(row(page, 'italic').getByTestId('shortcut-changed')).toBeVisible();
  await row(page, 'bold').getByTestId('shortcut-reset').click();
  await expect(keys(page, 'bold')).toHaveText('⌘B');
  expect(await overrides(page)).toEqual({ italic: null, 'editor:Mod-d': '⌃⌥J' });
  await page.getByTestId('shortcuts-reset-all').click();
  await expect(page.getByTestId('shortcut-changed')).toHaveCount(0);
  expect(await overrides(page)).toEqual({});
});

test('E5.10-8 Cancel in Preferences puts the shortcuts back', async ({ page }) => {
  await openShortcuts(page);
  await record(page, 'bold', 'Alt+Meta+J');
  await page.getByTestId('prefs-cancel').click();
  await expect.poll(async () => overrides(page)).toEqual({});
});

test('E5.10-9 the palette shows the changed shortcut, and a change from another window arrives live', async ({
  page,
}) => {
  await seedMock(page, {
    files: { [DOC]: '# Note\n\nbody\n' },
    launch: { openPath: DOC, view: 'editor' },
    settings: { shortcuts: { 'save-as': '⌥⌘J', find: null } },
  });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');
  await expect(page.getByTestId('document-name')).toBeVisible();
  await menu(page, 'command-palette');
  const rowOf = (name: string) => page.getByTestId('picker-row').filter({ hasText: name }).first();
  await expect(rowOf('Save As…')).toContainText('⌥⌘J');
  await expect(rowOf('Save As…')).not.toContainText('⇧⌘S');
  await expect(rowOf('Quick Open…')).toContainText('⇧⌘O');
  await expect(rowOf('Find…')).not.toContainText('⌘F');
  // A change from another window arrives live.
  await page.evaluate(() =>
    window.__WRITEDOWN_MOCK__?.settingsChanged({ shortcuts: { 'save-as': '⌃⌘J' } }),
  );
  await expect(rowOf('Save As…')).toContainText('⌃⌘J');
});

test('E5.10-10 an editing command takes the new key and the old key no longer works', async ({
  page,
}) => {
  await seedMock(page, {
    files: { [DOC]: 'one\ntwo\nthree\n' },
    launch: { openPath: DOC, view: 'editor' },
    settings: { shortcuts: { 'editor:Alt-ArrowDown': '⌃⌥J' } },
  });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');
  const text = () => editor(page).evaluate((el) => (el as HTMLElement).innerText);
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+Home');
  // The default key moves nothing now.
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(text).toMatch(/^one\ntwo\nthree/);
  await page.keyboard.press('Control+Alt+j');
  await expect.poll(text).toMatch(/^two\none\nthree/);
  // Changing it live, as from Preferences, takes effect without reloading.
  await page.evaluate(() =>
    window.__WRITEDOWN_MOCK__?.settingsChanged({ shortcuts: { 'editor:Alt-ArrowDown': null } }),
  );
  await page.keyboard.press('Control+Alt+j');
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(text).toMatch(/^two\none\nthree/);
});

test('E5.10-11 control: without a change the default key moves the line', async ({ page }) => {
  await seedMock(page, {
    files: { [DOC]: 'one\ntwo\nthree\n' },
    launch: { openPath: DOC, view: 'editor' },
  });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.press('Alt+ArrowDown');
  await expect
    .poll(() => editor(page).evaluate((el) => (el as HTMLElement).innerText))
    .toMatch(/^two\none\nthree/);
});
