/**
 * Helpers of the Phase 3 acceptance tests (WP3.8a1). They drive the app only through the mock
 * platform's seed and control object, roles and test ids.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, FIXTURES } from '../acceptance2/common';

export { mockRead, selectionOf, selectText } from '../acceptance/support';
export {
  blocks,
  DOCS,
  editor,
  editorText,
  expect,
  FIXTURES,
  fixture,
  HOME,
  launch,
  menu,
  preview,
  previewReady,
  setSelection,
  setView,
  squash,
  watchRequests,
} from '../acceptance2/common';

export const MOCK_HOME = '/Users/mock';
export const FOLDER = `${MOCK_HOME}/folder`;
export const inFolder = (relative: string) => `${FOLDER}/${relative}`;

/**
 * The fixture folder `tests/fixtures/folder` as mock files under `FOLDER`: every file on disk,
 * hidden and ignored ones included, so that the app's own filters are what is tested.
 */
export function folderSeed(): Record<string, string> {
  const root = join(FIXTURES, 'folder');
  const files: Record<string, string> = {};
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else if (entry.name.endsWith('.png')) files[inFolder(rel)] = 'png placeholder\n';
      else files[inFolder(rel)] = readFileSync(join(dir, entry.name), 'utf8');
    }
  };
  walk(root, '');
  return files;
}

/** Reads a property of the mock control object inside the page. */
export function mock<T>(
  page: Page,
  read: (control: NonNullable<Window['__WRITEDOWN_MOCK__']>) => T,
): Promise<T> {
  return page.evaluate(`(${read.toString()})(window.__WRITEDOWN_MOCK__)`) as Promise<T>;
}

/** Waits for the first rendered block of the preview. */
export async function waitForPreview(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="preview"] .wd-block').first()).toBeAttached({
    timeout: 60_000,
  });
}
