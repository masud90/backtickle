/** The update check: a banner in the main window when GitHub has a newer release. */
import { expect, type Page, test } from '@playwright/test';
import type { MockSeed } from '../../src/lib/platform-mock';
import { seedMock } from './helpers';

async function open(page: Page, seed: MockSeed) {
  await seedMock(page, { launch: { welcome: true }, ...seed });
  await page.goto('/');
}

const change = (page: Page, patch: unknown) =>
  page.evaluate((p) => window.__BACKTICKLE_MOCK__?.settingsChanged(p as never), patch);

test('a newer release shows a banner whose Download opens the release page', async ({ page }) => {
  await open(page, { latestRelease: 'v9.0.0' });
  const banner = page.getByTestId('banner-update');
  await expect(banner).toContainText('Backtickle 9.0.0 is available.');
  await banner.getByRole('button', { name: 'Download' }).click();
  await expect(banner).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => window.__BACKTICKLE_MOCK__?.externalUrls))
    .toEqual(['https://github.com/masud90/backtickle/releases/tag/v9.0.0']);
});

test('Dismiss hides the banner, and turning the setting off hides it too', async ({ page }) => {
  await open(page, { latestRelease: 'v9.0.0' });
  const banner = page.getByTestId('banner-update');
  await banner.getByRole('button', { name: 'Dismiss' }).click();
  await expect(banner).toBeHidden();

  await open(page, { latestRelease: 'v9.0.0' });
  await expect(banner).toBeVisible();
  await change(page, { checkForUpdates: false });
  await expect(banner).toBeHidden();
});

test('no banner with the setting off or nothing newer', async ({ page }) => {
  await open(page, { latestRelease: 'v9.0.0', settings: { checkForUpdates: false } });
  await expect(page.getByTestId('welcome')).toBeVisible();
  await expect(page.getByTestId('banner-update')).toHaveCount(0);

  await open(page, { latestRelease: null });
  await expect(page.getByTestId('welcome')).toBeVisible();
  await expect(page.getByTestId('banner-update')).toHaveCount(0);
});
