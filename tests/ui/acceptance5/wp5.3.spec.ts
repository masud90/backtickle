/**
 * One-click PDF.
 * Run with WD_UI_PORT=1493.
 */
import { expect, type Page, test } from '@playwright/test';
import type { MockSeed } from '../../../src/lib/platform-mock';
import { HOME, menu, seedMock } from '../helpers';

const DOC = `${HOME}/docs/Guide.md`;
const OUT = `${HOME}/docs/Guide.pdf`;
const BODY = '# Guide title\n\nSome text.\n';

async function open(page: Page, extra: Partial<MockSeed> = {}): Promise<void> {
  await seedMock(page, {
    files: { [DOC]: BODY },
    saveDialog: OUT,
    launch: { openPath: DOC, view: 'preview' },
    ...extra,
  });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');
  await expect(page.getByTestId('preview').locator('h1').first()).toBeVisible();
}

const exportsOf = (page: Page) => page.evaluate(() => window.__WRITEDOWN_MOCK__?.pdfExports ?? []);
const dialogsOf = (page: Page) => page.evaluate(() => window.__WRITEDOWN_MOCK__?.saveDialogs ?? []);
const rootCount = (page: Page) => page.locator('#wd-print-root').count();

test.describe('One-click PDF', () => {
  test('E5.3-1: the menu action asks for a PDF path once and writes the print view to it', async ({
    page,
  }) => {
    await open(page);
    await menu(page, 'export-pdf');
    await expect.poll(async () => (await exportsOf(page)).length).toBe(1);
    const [written] = await exportsOf(page);
    expect(written?.path).toBe(OUT);
    expect(written?.root).toContain('Guide title');
    expect(written?.root).toContain('Some text.');
    expect(await dialogsOf(page)).toEqual([
      { suggestedName: 'Guide.pdf', directory: `${HOME}/docs`, kind: 'pdf' },
    ]);
    // The print panel is never used.
    expect(await page.evaluate(() => window.__WRITEDOWN_MOCK__?.prints)).toBe(0);
  });

  test('E5.3-2: the print root is gone after a successful export', async ({ page }) => {
    await open(page);
    await menu(page, 'export-pdf');
    await expect.poll(async () => (await exportsOf(page)).length).toBe(1);
    await expect.poll(() => rootCount(page)).toBe(0);
    await expect(page.locator('#wd-print-style')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('E5.3-3: a failure shows the message and removes the print root', async ({ page }) => {
    await open(page, { exportPdf: { error: 'The PDF could not be saved there.' } });
    await menu(page, 'export-pdf');
    await expect(page.getByRole('alert')).toContainText('The PDF could not be saved there.');
    expect((await exportsOf(page)).length).toBe(1);
    expect(await rootCount(page)).toBe(0);
    await expect(page.locator('#wd-print-style')).toHaveCount(0);
  });

  test('E5.3-4: cancelling the save dialog writes nothing', async ({ page }) => {
    await open(page, { saveDialog: null });
    await menu(page, 'export-pdf');
    await expect.poll(async () => (await dialogsOf(page)).length).toBe(1);
    expect(await exportsOf(page)).toEqual([]);
    expect(await rootCount(page)).toBe(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('E5.3-5: a path typed without .pdf gets the extension', async ({ page }) => {
    await open(page, { saveDialog: `${HOME}/docs/plain` });
    await menu(page, 'export-pdf');
    await expect.poll(async () => (await exportsOf(page)).length).toBe(1);
    expect((await exportsOf(page))[0]?.path).toBe(`${HOME}/docs/plain.pdf`);
  });

  test('E5.3-6: an untitled document can be exported', async ({ page }) => {
    await seedMock(page, { saveDialog: `${HOME}/Untitled.pdf`, launch: { welcome: true } });
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.goto('/');
    await expect(page.getByTestId('welcome')).toBeVisible();
    await menu(page, 'new');
    await expect(page.getByTestId('document-name')).toBeVisible();
    await menu(page, 'export-pdf');
    await expect.poll(async () => (await exportsOf(page)).length).toBe(1);
    const [dialog] = await dialogsOf(page);
    expect(dialog?.suggestedName).toBe('Untitled.pdf');
    expect(dialog?.directory).toBeNull();
    expect(dialog?.kind).toBe('pdf');
  });

  test('E5.3-7: the palette lists Export as PDF with its shortcut', async ({ page }) => {
    await open(page);
    await menu(page, 'command-palette');
    const row = page.getByTestId('picker-row').filter({ hasText: 'Export as PDF' }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('⌥⌘P');
    await page.getByTestId('picker-input').fill('export as pdf');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await exportsOf(page)).length).toBe(1);
  });

  test('E5.3-8: without a document the action is not in the palette', async ({ page }) => {
    await seedMock(page, { launch: { welcome: true } });
    await page.goto('/');
    await expect(page.getByTestId('welcome')).toBeVisible();
    await menu(page, 'command-palette');
    await expect.poll(() => page.getByTestId('picker-row').count()).toBeGreaterThan(3);
    await expect(page.getByTestId('picker-row').filter({ hasText: 'Export as PDF' })).toHaveCount(
      0,
    );
  });

  test('E5.3-9: Print still uses the print panel and keeps its root until the panel is over', async ({
    page,
  }) => {
    await open(page);
    await menu(page, 'print');
    await expect.poll(() => page.evaluate(() => window.__WRITEDOWN_MOCK__?.prints)).toBe(1);
    expect((await exportsOf(page)).length).toBe(0);
  });
});
