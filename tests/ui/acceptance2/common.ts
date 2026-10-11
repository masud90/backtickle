/**
 * Helpers shared by the Phase 2 acceptance tests (WP2.7a). Phase 1 helpers are re-exported from
 * `../acceptance/support`; this file adds fixtures by folder, the vault seed and console capture.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import {
  blocks,
  editor,
  editorText,
  expect,
  FIXTURES,
  fixture,
  launch,
  menu,
  openFiles,
  preview,
  previewReady,
  setSelection,
  setView,
} from '../acceptance/support';

export {
  blocks,
  editor,
  editorText,
  expect,
  FIXTURES,
  fixture,
  launch,
  menu,
  openFiles,
  preview,
  previewReady,
  setSelection,
  setView,
};

export const HOME = '/Users/mock';
export const DOCS = `${HOME}/docs`;

/** Text of an element, whitespace collapsed. */
export const squash = (value: string | null | undefined): string =>
  (value ?? '').replace(/\s+/g, ' ').trim();

/** Collects console errors and page errors from now on. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** Records the URLs of every request the page makes. */
export function watchRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  return urls;
}

const VAULT_FIXTURE = join(FIXTURES, 'flavors', 'obsidian', 'vault');
export const VAULT_ROOT = `${HOME}/Vault`;

/** The Obsidian fixture vault as a mock seed (notes as files, png as images, the rest as existing). */
export function vaultSeed(): {
  files: Record<string, string>;
  images: Record<string, string>;
  existing: string[];
  vault: { root: string };
  vaults: string[];
} {
  const files: Record<string, string> = {};
  const images: Record<string, string> = {};
  const existing: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else if (rel.endsWith('.md'))
        files[`${VAULT_ROOT}/${rel}`] = readFileSync(join(dir, entry.name), 'utf8');
      else if (rel.endsWith('.png'))
        images[`${VAULT_ROOT}/${rel}`] = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
      else existing.push(`${VAULT_ROOT}/${rel}`);
    }
  };
  walk(VAULT_FIXTURE, '');
  return { files, images, existing, vault: { root: VAULT_ROOT }, vaults: [VAULT_ROOT] };
}

/** The visible text of every matching node, whitespace collapsed. */
export async function texts(page: Page, selector: string): Promise<string[]> {
  return page
    .locator(`[data-testid="preview"] ${selector}`)
    .evaluateAll((nodes) => nodes.map((n) => (n.textContent ?? '').replace(/\s+/g, ' ').trim()));
}

/** Opens a document on the mock platform, optionally with the flavor chosen from the pill. */
export async function openDoc(options: {
  page: Page;
  path: string;
  text: string;
  extra?: Record<string, string>;
  images?: Record<string, string>;
  view?: 'editor' | 'split' | 'preview';
  pill?: RegExp;
  settings?: Record<string, unknown>;
}): Promise<void> {
  const { page } = options;
  const seed: Record<string, unknown> = {
    files: { [options.path]: options.text, ...(options.extra ?? {}) },
  };
  if (options.images) seed.images = options.images;
  if (options.settings) seed.settings = options.settings;
  await launch(page, { seed, open: options.path, view: options.view ?? 'preview' });
  if (options.pill) await choose(page, options.pill);
  await page.locator('[data-testid="preview"] .wd-block').first().waitFor({ state: 'attached' });
}

/** Chooses a flavor from the pill menu. */
export async function choose(page: Page, label: RegExp): Promise<void> {
  await page.getByTestId('flavor-pill').click();
  await page.getByTestId('flavor-menu').getByRole('menuitemradio', { name: label }).click();
}

/** The number shown as "Words: N" in the status bar. */
export async function wordsShown(page: Page): Promise<number> {
  const text = squash(await page.getByTestId('status-words').textContent());
  const match = /Words:\s*([\d,]+)/.exec(text);
  if (!match) throw new Error(`no word count in "${text}"`);
  return Number((match[1] as string).replace(/,/g, ''));
}

/** A tiny GIF as a data URL, for images that the mock must resolve. */
export const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
