/** Helpers of the Preferences window tests: the page runs on the mock platform. */
import type { Page } from '@playwright/test';
import type { MockSeed } from '../../src/lib/platform-mock';
import { seedMock } from './helpers';

export async function openPrefs(page: Page, seed: MockSeed = {}): Promise<void> {
  await seedMock(page, seed);
  await page.goto('/preferences.html');
  await page.getByTestId('category-general').waitFor();
  await page.getByTestId('setting-appearance').waitFor();
}

/** The settings the mock holds now. */
export const settingsNow = (page: Page) =>
  page.evaluate(() => JSON.parse(JSON.stringify(window.__BACKTICKLE_MOCK__?.settings)));

export function at(source: unknown, key: string): unknown {
  let value = source;
  for (const part of key.split('.')) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

export const row = (page: Page, key: string) => page.getByTestId(`setting-${key}`);
