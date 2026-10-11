/**
 * Shared helpers for the WP1.6 acceptance tests. Everything here drives the page through its
 * public surface: the mock platform seed and control object, roles, labels and data-testids.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect as baseExpect, type Locator, type Page } from '@playwright/test';

// Same per-test timeout as playwright.config.ts; expect keeps Playwright's default timeout.
export const expect = baseExpect;
export const TEST_TIMEOUT = 60_000;

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(HERE, '..', '..', 'fixtures');
export const REPO = join(HERE, '..', '..', '..');

/** A fixture file as text (UTF-8). */
export function fixture(relative: string): string {
  return readFileSync(join(FIXTURES, relative), 'utf8');
}

/** A fixture file as a data URL. */
export function fixtureDataUrl(relative: string, mime: string): string {
  return `data:${mime};base64,${readFileSync(join(FIXTURES, relative)).toString('base64')}`;
}

/** The built-in GFM guide, as the app bundles it. */
export function gfmGuide(): string {
  return readFileSync(join(REPO, 'src', 'content', 'guides', 'gfm.md'), 'utf8');
}

type Seed = Record<string, unknown>;

export interface LaunchOptions {
  /** The seed of the mock platform (files, recents, settings, answers...). */
  seed?: Seed;
  /** Shorthand for `seed.launch.openPath` plus `seed.launch.view`. */
  open?: string;
  view?: 'editor' | 'split' | 'preview';
  viewport?: { width: number; height: number };
  /** Without this the page waits for the welcome screen, or a document when `open` is set. */
  waitFor?: 'welcome' | 'document' | 'none';
}

/** Loads the app on the mock platform with the given seed, and waits until it is ready. */
export async function launch(page: Page, options: LaunchOptions = {}): Promise<void> {
  const seed: Seed = { ...(options.seed ?? {}) };
  if (options.open) {
    seed.launch = {
      ...((seed.launch as object | undefined) ?? {}),
      openPath: options.open,
      ...(options.view ? { view: options.view } : {}),
    };
  }
  if (options.viewport) await page.setViewportSize(options.viewport);
  await page.addInitScript((s) => {
    (window as unknown as { __WRITEDOWN_MOCK_SEED__: unknown }).__WRITEDOWN_MOCK_SEED__ = s;
  }, seed);
  await page.goto('/');
  const waitFor = options.waitFor ?? (options.open ? 'document' : 'welcome');
  if (waitFor === 'welcome') await expect(page.getByTestId('welcome')).toBeVisible();
  if (waitFor === 'document') await expect(page.getByTestId('document-name')).toBeVisible();
}

/** Calls a function on the mock control object inside the page. */
export async function mockCall(page: Page, name: string, ...args: unknown[]): Promise<void> {
  await page.evaluate(
    ([method, rest]) => {
      const control = (window as unknown as { __WRITEDOWN_MOCK__: Record<string, unknown> })
        .__WRITEDOWN_MOCK__;
      (control[method as string] as (...a: unknown[]) => void)(...(rest as unknown[]));
    },
    [name, args] as const,
  );
}

export const menu = (page: Page, action: string) => mockCall(page, 'menuAction', action);
export const openFiles = (page: Page, paths: string[]) => mockCall(page, 'openFiles', paths);
export const setAnswers = (page: Page, answers: Seed) => mockCall(page, 'setAnswers', answers);

/** A JSON-safe read of a property of the mock control object (arrays are copied). */
export async function mockRead<T>(page: Page, property: string): Promise<T> {
  return page.evaluate((key) => {
    const control = (window as unknown as { __WRITEDOWN_MOCK__: Record<string, unknown> })
      .__WRITEDOWN_MOCK__;
    return JSON.parse(JSON.stringify(control[key])) as unknown;
  }, property) as Promise<T>;
}

export interface SavedCall {
  path: string;
  text: string;
  format: { encoding: string; lineEnding: string };
  options: {
    expectedModifiedMs: number | null;
    overwriteExternalChange?: boolean;
    allowLossy?: boolean;
  };
  result: { path: string; bytes: number; modifiedMs: number };
}
export const saves = (page: Page) => mockRead<SavedCall[]>(page, 'saves');

export interface MockSettings {
  appearance: string;
  defaultFlavor: string;
  view: {
    sidebarVisible: boolean;
    sidebarWidth: number;
    splitRatio: number;
    syncScroll: boolean;
    zoom: number;
  };
  [key: string]: unknown;
}
export const settingsOf = (page: Page) => mockRead<MockSettings>(page, 'settings');

/** The file as the mock holds it "on disk". */
export async function diskFile(page: Page, path: string) {
  return page.evaluate((p) => {
    const file = (
      window as unknown as { __WRITEDOWN_MOCK__: { file(p: string): unknown } }
    ).__WRITEDOWN_MOCK__.file(p);
    return file ? (JSON.parse(JSON.stringify(file)) as Record<string, unknown>) : undefined;
  }, path);
}

// ---- the editor -------------------------------------------------------------------------------

export const editor = (page: Page): Locator => page.locator('[data-testid="editor"] .cm-content');

type CmContent = HTMLElement & {
  cmTile?: {
    view?: {
      state: {
        doc: { toString(): string; length: number };
        selection: { main: { anchor: number; head: number; from: number; to: number } };
        sliceDoc(from: number, to: number): string;
      };
      dispatch(spec: unknown): void;
      focus(): void;
    };
  };
};

/** The full source in the editor (read from the CodeMirror document, not from rendered lines). */
export async function editorText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const content = document.querySelector(
      '[data-testid="editor"] .cm-content',
    ) as CmContent | null;
    const view = content?.cmTile?.view;
    if (view) return view.state.doc.toString();
    // Fallback: rendered lines (complete for short documents).
    return Array.from(document.querySelectorAll('[data-testid="editor"] .cm-line'))
      .map((line) => line.textContent ?? '')
      .join('\n');
  });
}

/** Puts a selection in the editor (offsets in the document) and the focus with it. */
export async function setSelection(page: Page, anchor: number, head = anchor): Promise<void> {
  await page.waitForFunction(
    () =>
      !!(document.querySelector('[data-testid="editor"] .cm-content') as CmContent | null)?.cmTile
        ?.view,
  );
  await page.evaluate(
    ([a, h]) => {
      const content = document.querySelector(
        '[data-testid="editor"] .cm-content',
      ) as CmContent | null;
      const view = content?.cmTile?.view;
      if (!view) throw new Error('no editor view');
      view.focus();
      view.dispatch({ selection: { anchor: a, head: h } });
    },
    [anchor, head] as const,
  );
}

/** Selects the nth occurrence of a string in the document. Returns its start offset. */
export async function selectText(page: Page, needle: string, nth = 0): Promise<number> {
  await page.waitForFunction(
    () =>
      !!(document.querySelector('[data-testid="editor"] .cm-content') as CmContent | null)?.cmTile
        ?.view,
  );
  return page.evaluate(
    ([text, index]) => {
      const content = document.querySelector(
        '[data-testid="editor"] .cm-content',
      ) as CmContent | null;
      const view = content?.cmTile?.view;
      if (!view) throw new Error('no editor view');
      const doc = view.state.doc.toString();
      let from = -1;
      for (let i = 0; i <= (index as number); i++) from = doc.indexOf(text as string, from + 1);
      if (from < 0) throw new Error(`text not found: ${text}`);
      view.focus();
      view.dispatch({ selection: { anchor: from, head: from + (text as string).length } });
      return from;
    },
    [needle, nth] as const,
  );
}

/** The current selection of the editor: offsets and the selected text. */
export async function selectionOf(
  page: Page,
): Promise<{ anchor: number; head: number; from: number; to: number; text: string }> {
  return page.evaluate(() => {
    const content = document.querySelector(
      '[data-testid="editor"] .cm-content',
    ) as CmContent | null;
    const state = content?.cmTile?.view?.state;
    if (!state) throw new Error('no editor view');
    const { anchor, head, from, to } = state.selection.main;
    return { anchor, head, from, to, text: state.sliceDoc(from, to) };
  });
}

/** Moves the caret to the end of the document and types real keys there. */
export async function typeAtEnd(page: Page, text: string): Promise<void> {
  const length = (await editorText(page)).length;
  await setSelection(page, length);
  await page.keyboard.type(text);
}

// ---- the preview ------------------------------------------------------------------------------

export const preview = (page: Page): Locator => page.getByTestId('preview');
export const blocks = (page: Page): Locator => page.locator('[data-testid="preview"] .wd-block');

/** Waits until the preview has rendered at least one block. */
export async function previewReady(page: Page): Promise<void> {
  await expect(blocks(page).first()).toBeAttached();
}

/** Opens a path through the Finder or Dock event and waits for its tab. */
export async function openAndWait(page: Page, path: string, name: string): Promise<void> {
  await openFiles(page, [path]);
  await expect(page.getByTestId('document-name')).toContainText(name);
}

export async function setView(page: Page, view: 'editor' | 'split' | 'preview'): Promise<void> {
  await menu(page, `view-${view}`);
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', view);
}

/** The name of the selected tab (when the tab strip shows) or of the document on show. */
export const activeName = (page: Page) => page.getByTestId('document-name');

/** True when the document on show has the dirty dot. */
export const dirtyDot = (page: Page) => page.getByTestId('dirty-dot');
