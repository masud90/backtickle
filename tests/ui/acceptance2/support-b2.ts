/**
 * Helpers for the Phase 2 acceptance tests B19 to B34 (WP2.7a2). Builds on `common.ts` (and so on
 * the Phase 1 `support.ts`); nothing here reads the app's output to decide what is expected.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { vaultSeed as baseVaultSeed, FIXTURES, launch, VAULT_ROOT } from './common';

export * from './common';

/** A real PNG (the vault fixture's diagram) as a data URL: the 1x1 GIF of `common.ts` does not decode. */
export const DIAGRAM_PNG = `data:image/png;base64,${readFileSync(
  join(FIXTURES, 'flavors', 'obsidian', 'vault', 'attachments', 'diagram.png'),
).toString('base64')}`;

/** The fixture vault as a mock seed whose images decode. */
export function vaultSeed() {
  const seed = baseVaultSeed();
  for (const key of Object.keys(seed.images)) seed.images[key] = DIAGRAM_PNG;
  return seed;
}

/** The built-in guide of a flavor, as the app bundles it. */
export function guideOf(flavor: string): string {
  return readFileSync(
    join(FIXTURES, '..', '..', 'src', 'content', 'guides', `${flavor}.md`),
    'utf8',
  );
}

/** A vault made of the given notes (paths relative to the vault root), as a mock seed. */
export function customVault(
  notes: Record<string, string>,
  extra: { images?: Record<string, string>; existing?: string[] } = {},
  root = VAULT_ROOT,
) {
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(notes)) files[`${root}/${rel}`] = text;
  const images: Record<string, string> = {};
  for (const [rel, data] of Object.entries(extra.images ?? {})) images[`${root}/${rel}`] = data;
  return {
    files,
    images,
    existing: (extra.existing ?? []).map((rel) => `${root}/${rel}`),
    vault: { root },
    vaults: [root],
  };
}

/** Opens a note of a custom vault in the preview (or another view). */
export async function openNote(
  page: Page,
  notes: Record<string, string>,
  open: string,
  view: 'editor' | 'split' | 'preview' = 'preview',
  extra: { images?: Record<string, string>; existing?: string[] } = {},
): Promise<void> {
  await launch(page, { seed: customVault(notes, extra), open: `${VAULT_ROOT}/${open}`, view });
  await page.locator('[data-testid="preview"] .wd-block').first().waitFor({ state: 'attached' });
}

/** Scroll offset of an element of the preview below the top of the preview scroller (px). */
export const previewOffset = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(`[data-testid="preview"] ${sel}`) as HTMLElement;
    const s = document.querySelector('[data-testid="preview-scroll"]') as HTMLElement;
    return el.getBoundingClientRect().top - s.getBoundingClientRect().top;
  }, selector);

type CmView = {
  state: { doc: { toString(): string; length: number } };
  dispatch(spec: unknown): void;
  focus(): void;
};

/** Inserts text into the CodeMirror document at an offset (one transaction, like a paste). */
export async function insertAt(page: Page, at: number, text: string): Promise<void> {
  await page.evaluate(
    ([pos, value]) => {
      const content = document.querySelector('[data-testid="editor"] .cm-content') as
        | (HTMLElement & { cmTile?: { view?: CmView } })
        | null;
      const view = content?.cmTile?.view;
      if (!view) throw new Error('no editor view');
      view.dispatch({ changes: { from: pos as number, insert: value as string } });
    },
    [at, text] as const,
  );
}

/** Replaces `from..to` of the CodeMirror document. */
export async function replaceRange(
  page: Page,
  from: number,
  to: number,
  text: string,
): Promise<void> {
  await page.evaluate(
    ([a, b, value]) => {
      const content = document.querySelector('[data-testid="editor"] .cm-content') as
        | (HTMLElement & { cmTile?: { view?: CmView } })
        | null;
      const view = content?.cmTile?.view;
      if (!view) throw new Error('no editor view');
      view.dispatch({ changes: { from: a as number, to: b as number, insert: value as string } });
    },
    [from, to, text] as const,
  );
}
