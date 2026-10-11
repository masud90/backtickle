/**
 * Default app button against the mock: the General row in
 * Preferences shows the current default app for Markdown, the button is disabled when Writedown
 * is the default, and a refused change shows its message. Run with WD_UI_PORT=1502.
 */
import { expect, test } from '@playwright/test';
import { openPrefs, settingsNow } from '../prefs-helpers';

const row = (page: import('@playwright/test').Page) =>
  page.getByTestId('setting-default-markdown-app');
const status = (page: import('@playwright/test').Page) => page.getByTestId('default-app-status');
const button = (page: import('@playwright/test').Page) => page.getByTestId('make-default-app');

test('the row names the current default app and offers the change', async ({ page }) => {
  await openPrefs(page, { defaultApp: { isWritedown: false, appName: 'Typora' } });
  await expect(row(page)).toBeVisible();
  await expect(row(page).getByText('Default app for Markdown files')).toBeVisible();
  await expect(status(page)).toHaveText('Currently Typora');
  await expect(button(page)).toBeEnabled();
  await expect(button(page)).toHaveText('Make Writedown the default');
});

test('the button is disabled when Writedown is already the default', async ({ page }) => {
  await openPrefs(page, { defaultApp: { isWritedown: true, appName: 'Writedown' } });
  await expect(status(page)).toHaveText('Writedown is the default');
  await expect(button(page)).toBeDisabled();
});

test('a row with no default app says so and offers the change', async ({ page }) => {
  await openPrefs(page, { defaultApp: { isWritedown: false, appName: null } });
  await expect(status(page)).toHaveText('No default app is set');
  await expect(button(page)).toBeEnabled();
});

test('making Writedown the default updates the row to the new state', async ({ page }) => {
  await openPrefs(page, { defaultApp: { isWritedown: false, appName: 'Typora' } });
  await button(page).click();
  await expect(status(page)).toHaveText('Writedown is the default');
  await expect(button(page)).toBeDisabled();
  await expect(page.getByTestId('default-app-message')).toHaveCount(0);
});

test('a change the system refuses shows the message and leaves the row as it was', async ({
  page,
}) => {
  await openPrefs(page, {
    defaultApp: { isWritedown: false, appName: 'Typora' },
    makeDefaultError: 'macOS did not change the default app.',
  });
  await button(page).click();
  await expect(page.getByTestId('default-app-message')).toHaveText(
    'macOS did not change the default app.',
  );
  await expect(page.getByTestId('default-app-message')).toHaveAttribute('role', 'alert');
  await expect(status(page)).toHaveText('Currently Typora');
  await expect(button(page)).toBeEnabled();
});

test('the row lives in General and changes no setting', async ({ page }) => {
  await openPrefs(page, { defaultApp: { isWritedown: false, appName: 'Typora' } });
  const before = await settingsNow(page);
  await expect(row(page)).toBeVisible();
  await button(page).click();
  await expect(status(page)).toHaveText('Writedown is the default');
  expect(await settingsNow(page)).toEqual(before);
});
