/**
 * Obsidian in the real app (B19 to B22, B04): a wikilink click opens the nearer Plan.md,
 * an embed renders the note, a foldable callout toggles, and `[[` completes note names.
 * Run with WD_UI_PORT=1446.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { editor, preview, seedMock, tabs } from './helpers';

const DIR = join(process.cwd(), 'tests/fixtures/flavors/obsidian/vault');
const ROOT = '/Users/mock/Vault';

function seed() {
  const files: Record<string, string> = {};
  const images: Record<string, string> = {};
  const existing: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else if (rel.endsWith('.md')) files[`${ROOT}/${rel}`] = readFileSync(join(DIR, rel), 'utf8');
      else if (rel.endsWith('.png'))
        images[`${ROOT}/${rel}`] = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
      else existing.push(`${ROOT}/${rel}`);
    }
  };
  walk(DIR, '');
  return { files, images, existing };
}

test.beforeEach(async ({ page }) => {
  await seedMock(page, {
    ...seed(),
    vault: { root: ROOT },
    vaults: [ROOT],
    launch: { openPath: `${ROOT}/Home.md`, view: 'split' },
  });
  await page.goto('/');
  await expect(page.getByTestId('document-name')).toHaveText('Home.md');
  await expect(page.getByTestId('flavor-pill')).toContainText('Obsidian');
});

test('a wikilink click opens Projects/Plan.md, the nearer of the two', async ({ page }) => {
  const link = preview(page).locator('a.wikilink', { hasText: /^Plan$/ });
  await expect(link).toHaveAttribute('href', 'Projects/Plan.md');
  await link.click();
  await expect(tabs(page)).toHaveCount(2);
  await expect(page.getByTestId('document-name')).toHaveText('Plan.md');
  await expect(preview(page)).toContainText('This is the Projects/Plan.md file.');
});

test('an embedded note shows its content', async ({ page }) => {
  const embed = preview(page).locator('.embed[data-target="Note A"]').first();
  await expect(embed.locator('.embed-content h1')).toHaveText('Note A', { timeout: 10_000 });
  await expect(preview(page).locator('.embed-content [style]')).toHaveCount(0);
});

test('a foldable callout toggles', async ({ page }) => {
  const closed = preview(page).locator('details.callout[data-callout="warning"]');
  await closed.scrollIntoViewIfNeeded();
  await expect(closed).not.toHaveAttribute('open', '');
  await closed.locator('summary').click();
  await expect(closed).toHaveAttribute('open', '');
  await closed.locator('summary').click();
  await expect(closed).not.toHaveAttribute('open', '');
});

test('[[ completes note names from the vault', async ({ page }) => {
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n\n[[Cyc');
  const option = page.getByRole('option', { name: /Cycle A/ });
  await expect(option).toBeVisible();
  // CodeMirror ignores Enter for 75 ms after the list changes (interactionDelay).
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await expect(editor(page)).toContainText('[[Cycle A]]');
});
