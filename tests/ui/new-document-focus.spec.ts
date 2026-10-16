/** A new document takes the keyboard: typing goes into it without a click first. */
import { expect, test } from '@playwright/test';
import { editor, HOME, menu, seedMock } from './helpers';

const NOTE = `${HOME}/Documents/note.md`;

test('New from the welcome screen puts the caret in the editor', async ({ page }) => {
  await seedMock(page, { launch: { welcome: true } });
  await page.goto('/');
  await page.getByRole('button', { name: 'New', exact: true }).first().click();

  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('Hello');
  await expect(editor(page)).toHaveText('Hello');
});

test('New from the menu, with a document open, puts the caret in the new editor', async ({
  page,
}) => {
  await seedMock(page, {
    files: { [NOTE]: '# Note\n' },
    launch: { openPath: NOTE, view: 'preview' },
  });
  await page.goto('/');
  await expect(page.getByTestId('document-name')).toHaveText('note.md');

  await menu(page, 'new');

  await expect(page.getByTestId('document-name')).toHaveText(/Untitled/);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('Typed at once');
  await expect(editor(page)).toHaveText('Typed at once');
});
