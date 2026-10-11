/** WP5.2 acceptance: the setting, the menu item, the palette. */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { editor, HOME, menu, seedMock } from '../helpers';
import { openPrefs } from '../prefs-helpers';
import { offCenter } from '../typewriter-support';

const DOC = `${HOME}/long.md`;
const TEXT = `${Array.from({ length: 300 }, (_, i) => `Line ${i + 1}`).join('\n')}\n`;

async function open(page: import('@playwright/test').Page, typewriter?: boolean) {
  await seedMock(page, {
    files: { [DOC]: TEXT },
    launch: { openPath: DOC, view: 'editor' },
    settings: typewriter === undefined ? {} : { editor: { typewriter } },
  });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');
  await expect(editor(page)).toBeVisible();
}

const down = async (page: import('@playwright/test').Page, n: number) => {
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+Home');
  for (let i = 0; i < n; i++) await page.keyboard.press('ArrowDown');
};

test.describe('E5.2 typewriter scrolling', () => {
  test('E5.2-1 the default is off and is listed in the defaults fixture', async ({ page }) => {
    const defaults = JSON.parse(
      readFileSync(new URL('../../fixtures/settings-defaults.json', import.meta.url), 'utf8'),
    );
    expect(defaults.editor.typewriter).toBe(false);
    await open(page);
    await down(page, 12);
    expect(await page.locator('.cm-scroller').evaluate((el) => el.scrollTop)).toBe(0);
  });

  test('E5.2-2 View > Typewriter Scrolling toggles it and reports the checkmark', async ({
    page,
  }) => {
    await open(page);
    await menu(page, 'toggle-typewriter');
    await down(page, 80);
    await expect.poll(async () => (await offCenter(page)).off).toBeLessThan(23);
    await menu(page, 'toggle-typewriter');
    await page.locator('.cm-scroller').evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.keyboard.press('ControlOrMeta+Home');
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown');
    expect(await page.locator('.cm-scroller').evaluate((el) => el.scrollTop)).toBe(0);
  });

  test('E5.2-3 the palette lists Typewriter Scrolling and runs it', async ({ page }) => {
    await open(page);
    await menu(page, 'command-palette');
    await page.getByTestId('picker-input').fill('typewriter');
    await expect(page.getByTestId('picker')).toContainText('Typewriter Scrolling');
    await page.keyboard.press('Enter');
    await down(page, 80);
    await expect.poll(async () => (await offCenter(page)).off).toBeLessThan(23);
  });

  test('E5.2-4 Preferences lists the setting in Editor with its description', async ({ page }) => {
    await openPrefs(page);
    await page.getByTestId('category-editor').click();
    await expect(page.getByText('Typewriter scrolling').first()).toBeVisible();
    await expect(
      page.getByText('Keep the line you are typing on in the middle of the editor').first(),
    ).toBeVisible();
  });
});
