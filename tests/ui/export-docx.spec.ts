/**
 * Word export. Run with WD_UI_PORT=1470.
 */
import { expect, type Page, test } from '@playwright/test';
import { HOME, menu, seedMock } from './helpers';

const OUT = `${HOME}/docs/out.docx`;
const PANDOC = { path: '/mock/pandoc', version: '3.8.3' };
const BODY = '# Title one\n\nSome text.\n';

async function open(
  page: Page,
  name: string,
  text: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const doc = `${HOME}/docs/${name}`;
  await seedMock(page, {
    files: { [doc]: text },
    saveDialog: OUT,
    pandoc: PANDOC,
    launch: { openPath: doc, view: 'preview' },
    ...extra,
  });
  await page.goto('/');
  await expect(page.getByTestId('preview').locator('h1').first()).toBeVisible();
}

const requests = (page: Page) =>
  page.evaluate(() => window.__BACKTICKLE_MOCK__?.docxRequests ?? []);

test.describe('Word export', () => {
  test('C31: the menu item is disabled without Pandoc and the action says why', async ({
    page,
  }) => {
    await open(page, 'a.md', BODY, { pandoc: null });
    await expect
      .poll(() => page.evaluate(() => window.__BACKTICKLE_MOCK__?.menuStates.at(-1)?.canExportDocx))
      .toBe(false);
    await menu(page, 'export-docx');
    await expect(page.getByRole('alert')).toContainText('Pandoc was not found');
    expect(await requests(page)).toEqual([]);
  });

  const ROUTES: [string, string, string][] = [
    ['a.md', 'gfm+tex_math_dollars', BODY],
    ['a.qmd', 'markdown', '---\ntitle: Q\n---\n\n# Quarto\n'],
    ['a.mmd', 'markdown_mmd', '# MMD\n'],
    ['a.mdx', 'html', '# MDX heading\n\nText.\n'],
  ];
  for (const [name, route, text] of ROUTES) {
    test(`C31: ${name} uses the route ${route}`, async ({ page }) => {
      await open(page, name, text);
      await menu(page, 'export-docx');
      await expect.poll(async () => (await requests(page)).length).toBe(1);
      const [request] = await requests(page);
      if (!request) throw new Error('no request');
      expect(request.from).toBe(route);
      expect(request.outPath).toBe(OUT);
      expect(request.docPath).toBe(`${HOME}/docs/${name}`);
      expect(request.citeproc).toBe(false);
      if (route === 'html') expect(request.input).toContain('<h1');
      else expect(request.input).toBe(text);
    });
  }

  test('C31: Obsidian and CommonMark routes', async ({ page }) => {
    await open(page, 'a.md', BODY, { settings: { defaultFlavor: 'obsidian' } });
    await menu(page, 'export-docx');
    await expect.poll(async () => (await requests(page)).length).toBe(1);
    expect((await requests(page))[0]?.from).toBe('html');
  });

  test('C31: citeproc is asked for when the document has a bibliography', async ({ page }) => {
    await open(page, 'a.qmd', '---\nbibliography: refs.bib\n---\n\n# Q\n\nSee [@key].\n');
    await menu(page, 'export-docx');
    await expect.poll(async () => (await requests(page)).length).toBe(1);
    expect((await requests(page))[0]?.citeproc).toBe(true);
  });

  test('C31: a Pandoc error reaches the banner', async ({ page }) => {
    await open(page, 'a.md', BODY, { exportDocx: { error: 'pandoc: bad input' } });
    await menu(page, 'export-docx');
    await expect(page.getByRole('alert')).toContainText('pandoc: bad input');
  });

  test('C31: "Exporting…" shows while Pandoc runs', async ({ page }) => {
    await open(page, 'a.md', BODY, { exportDocx: { hold: true } });
    await menu(page, 'export-docx');
    await expect(page.getByTestId('save-status')).toHaveText('Exporting…');
    await page.evaluate(() => window.__BACKTICKLE_MOCK__?.finishDocx());
    await expect(page.getByTestId('save-status')).not.toHaveText('Exporting…');
  });
});
