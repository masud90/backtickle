/** Shared helpers of the shell UI tests: seeding the mock platform and finding the main parts. */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { MockSeed } from '../../src/lib/platform-mock';

export const HOME = '/Users/mock';

/** The text of a file under tests/fixtures (or src/content), as UTF-8. */
export function fixture(relative: string): string {
  return readFileSync(new URL(`../fixtures/${relative}`, import.meta.url), 'utf8');
}

/** The text of a built-in guide. */
export function guideText(name: 'gfm' | 'commonmark'): string {
  return readFileSync(new URL(`../../src/content/guides/${name}.md`, import.meta.url), 'utf8');
}

/** Defines what the mock platform serves, before the page's scripts run. */
export async function seedMock(page: Page, seed: MockSeed): Promise<void> {
  await page.addInitScript((value) => {
    window.__BACKTICKLE_MOCK_SEED__ = value;
  }, seed);
}

/** The main parts of the window. */
export const editor = (page: Page) => page.getByRole('textbox', { name: 'Markdown source' });
export const preview = (page: Page) => page.getByTestId('preview');
export const tabs = (page: Page) => page.getByTestId('tab-strip').getByRole('tab');
export const statusText = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim());

/** Fires a menu action as the Rust side would. */
export async function menu(page: Page, action: string): Promise<void> {
  await page.evaluate(async (name) => {
    // The mock is created when the page starts; wait for it.
    for (let i = 0; i < 100 && !window.__BACKTICKLE_MOCK__; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    window.__BACKTICKLE_MOCK__?.menuAction(name as never);
  }, action);
}

/** Types into the editor at the end of the document. */
export async function typeAtEnd(page: Page, text: string): Promise<void> {
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(text);
}
