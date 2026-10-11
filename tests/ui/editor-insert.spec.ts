/**
 * The toolbar Insert menu. No flavor has Insert commands yet, so the test injects a
 * test module for CommonMark through the seam in `src/editor/flavors`, then switches to it.
 */
import { expect, type Page, test } from '@playwright/test';
import { editor, HOME, menu, seedMock } from './helpers';

const NOTE = `${HOME}/note.md`;

async function open(page: Page) {
  await seedMock(page, {
    files: { [NOTE]: '# Note\n\nBody text here.\n' },
    launch: { openPath: NOTE, view: 'split' },
  });
  await page.goto('/');
  await expect(page.getByTestId('document-name')).toHaveText('note.md');
}

async function injectInserts(page: Page) {
  await page.evaluate(async () => {
    const flavors = await import(/* @vite-ignore */ '/src/editor/flavors/index.ts'.toString());
    const inserts = await import(/* @vite-ignore */ '/src/editor/inserts.ts'.toString());
    flavors.overrideFlavorEditor('commonmark', {
      syntax: [],
      inserts: [
        {
          id: 'wrap',
          label: 'Wrap',
          icon: 'add-box',
          run: (view: never) => inserts.wrapSelection(view, '<<', '>>', 'here'),
        },
        {
          id: 'block',
          label: 'Block',
          icon: 'add-box',
          run: (view: never) => inserts.insertBlock(view, '::: note\n:::', { from: 4, to: 8 }),
        },
      ],
    });
  });
}

async function chooseCommonMark(page: Page) {
  await page.getByTestId('flavor-pill').click();
  await page.getByRole('menuitemradio', { name: /CommonMark/ }).click();
}

test.describe('Insert menu', () => {
  test('is absent while the flavor has no insert commands', async ({ page }) => {
    await open(page);
    await expect(page.getByTestId('tool-heading')).toBeVisible();
    await expect(page.getByTestId('tool-insert')).toHaveCount(0);
  });

  test('shows after the Table button, runs a command as one undo step and returns the focus', async ({
    page,
  }) => {
    await open(page);
    await injectInserts(page);
    await chooseCommonMark(page);
    const trigger = page.getByTestId('tool-insert');
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveText('Insert');
    const order = await page
      .getByTestId('toolbar')
      .locator('button[data-testid^="tool-"]')
      .evaluateAll((buttons) => buttons.map((b) => b.getAttribute('data-testid')));
    expect(order.at(-1)).toBe('tool-insert');
    expect(order.at(-2)).toBe('tool-table');

    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await trigger.click();
    await expect(page.getByTestId('insert-menu')).toBeVisible();
    // The first entry has the focus; the arrow keys move; Enter runs.
    await page.keyboard.press('Enter');
    await expect(editor(page)).toContainText('<<here>>');
    await expect(page.getByTestId('insert-menu')).toHaveCount(0);
    await expect(editor(page)).toBeFocused();

    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor(page)).not.toContainText('<<here>>');
  });

  test('is keyboard reachable: arrow keys, Escape returns to the button', async ({ page }) => {
    await open(page);
    await injectInserts(page);
    await chooseCommonMark(page);
    const trigger = page.getByTestId('tool-insert');
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Wrap' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Block' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('insert-menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('is disabled in Preview view and back in Split', async ({ page }) => {
    await open(page);
    await injectInserts(page);
    await chooseCommonMark(page);
    await menu(page, 'view-preview');
    await expect(page.getByTestId('tool-insert')).toBeDisabled();
    await menu(page, 'view-split');
    await expect(page.getByTestId('tool-insert')).toBeEnabled();
  });
});
