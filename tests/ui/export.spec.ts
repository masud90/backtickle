/**
 * Export HTML, Print and Copy as HTML. Run with
 * WD_UI_PORT=1469.
 */
import { expect, type Page, test } from '@playwright/test';
import { fixture, HOME, menu, seedMock } from './helpers';

const DOC = `${HOME}/docs/report.md`;
const OUT = `${HOME}/docs/report.html`;

const SOURCE = `---
title: Quarterly report
---

# Heading one

A paragraph with **bold** text.

- [x] done
- [ ] open

\`\`\`js
const a = 1;
\`\`\`

![pic](pic.png)

Second paragraph to select.
`;

async function open(page: Page, text: string, extra: Record<string, unknown> = {}): Promise<void> {
  await seedMock(page, {
    files: { [DOC]: text },
    existing: [`${HOME}/docs/pic.png`],
    saveDialog: OUT,
    launch: { openPath: DOC, view: 'preview' },
    ...extra,
  });
  await page.goto('/');
  await expect(page.getByTestId('preview').locator('h1').first()).toBeVisible();
}

const exported = (page: Page) =>
  page.evaluate(() => window.__WRITEDOWN_MOCK__?.exports.at(-1)?.contents ?? null);

test.describe('Export HTML', () => {
  test('C27: a self-contained page with the title, every block, no app controls, light theme', async ({
    page,
  }) => {
    await open(page, SOURCE);
    await menu(page, 'export-html');
    await expect.poll(() => exported(page)).not.toBeNull();
    const html = (await exported(page)) as string;

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>Quarterly report</title>');
    expect(html).toContain('data-theme="light"');
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).not.toMatch(
      /<script|<link |data-line=|data-end-line=|<button|<input|<iframe|<form/,
    );
    expect(html).toContain('☑');
    expect(html).toContain('☐');
    expect(html).toContain('const');
    const saved = await page.evaluate(() => window.__WRITEDOWN_MOCK__?.saveDialogs.at(-1));
    expect(saved?.suggestedName).toBe('report.html');
    expect(saved?.directory).toBe(`${HOME}/docs`);
  });

  test('C27: the exported page opens as a document in light colors under a dark system', async ({
    page,
    browser,
  }) => {
    await open(page, SOURCE);
    await menu(page, 'export-html');
    await expect.poll(() => exported(page)).not.toBeNull();
    const html = (await exported(page)) as string;

    const context = await browser.newContext({ colorScheme: 'dark' });
    const view = await context.newPage();
    await view.setContent(html);
    const colors = await view.evaluate(() => ({
      body: getComputedStyle(document.body).backgroundColor,
      text: getComputedStyle(document.querySelector('h1') as Element).color,
    }));
    await context.close();
    // --wd-surface-container-lowest is #ffffff and --wd-on-surface is #1b1b1d.
    expect(colors.body).toBe('rgb(255, 255, 255)');
    expect(colors.text).toBe('rgb(27, 27, 29)');
  });

  test('C27: the 5 MiB document has every heading in the export', async ({ page }) => {
    test.setTimeout(180_000);
    const text = fixture('generated/large-5m.md');
    let fenced = false;
    let headings = 0;
    for (const line of text.split('\n')) {
      if (/^\s{0,3}(```|~~~)/.test(line)) fenced = !fenced;
      else if (!fenced && /^#{1,6} /.test(line)) headings++;
    }
    await open(page, text);
    await menu(page, 'export-html');
    await expect.poll(() => exported(page), { timeout: 150_000 }).not.toBeNull();
    const html = (await exported(page)) as string;

    expect(html.match(/<h[1-6][ >]/g)?.length).toBe(headings);
    expect(html).not.toContain('data-line=');
  });

  test('a cancelled save dialog writes nothing', async ({ page }) => {
    await open(page, SOURCE, { saveDialog: null });
    await menu(page, 'export-html');
    await page.waitForTimeout(300);
    expect(await exported(page)).toBeNull();
  });
});

test.describe('Print', () => {
  test('C29: the print root holds the whole document, chrome is hidden in print media, the root goes after the panel', async ({
    page,
  }) => {
    await open(page, SOURCE);
    await menu(page, 'print');
    await expect.poll(() => page.evaluate(() => window.__WRITEDOWN_MOCK__?.prints)).toBe(1);
    const atPrint = await page.evaluate(() => window.__WRITEDOWN_MOCK__?.printRoots[0] ?? '');
    expect(atPrint).toContain('Heading one');
    expect(atPrint).toContain('Second paragraph to select.');
    expect(atPrint).not.toContain('data-line=');

    await page.emulateMedia({ media: 'print' });
    const styles = await page.evaluate(() => ({
      root: getComputedStyle(document.getElementById('wd-print-root') as Element).display,
      app: getComputedStyle(document.getElementById('app') as Element).display,
      text: getComputedStyle(document.querySelector('#wd-print-root h1') as Element).color,
    }));
    expect(styles.root).toBe('block');
    expect(styles.app).toBe('none');
    expect(styles.text).toBe('rgb(27, 27, 29)');
    await page.emulateMedia({ media: 'screen' });
    expect(
      await page.evaluate(
        () => getComputedStyle(document.getElementById('wd-print-root') as Element).display,
      ),
    ).toBe('none');

    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(page.locator('#wd-print-root')).toHaveCount(0);
  });
});

test.describe('Copy as HTML', () => {
  test('C30: without a selection the whole document, as text and as HTML', async ({ page }) => {
    await open(page, SOURCE);
    await menu(page, 'copy-html');
    await expect
      .poll(() => page.evaluate(() => window.__WRITEDOWN_MOCK__?.clipboardWrites.length))
      .toBe(1);
    const write = await page.evaluate(() => window.__WRITEDOWN_MOCK__?.clipboardWrites[0]);
    expect(write?.html).toBe(write?.text);
    expect(write?.html).toContain('<h1');
    expect(write?.html).toContain('Second paragraph to select.');
    expect(write?.html).not.toMatch(/data-line=|<button|<input/);
  });

  test('C30: with a selection only the selected part', async ({ page }) => {
    await open(page, SOURCE);
    await page.evaluate(() => {
      const target = [...document.querySelectorAll('[data-testid=preview] p')].find((p) =>
        p.textContent?.startsWith('Second paragraph'),
      ) as Element;
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await menu(page, 'copy-html');
    await expect
      .poll(() => page.evaluate(() => window.__WRITEDOWN_MOCK__?.clipboardWrites.length))
      .toBe(1);
    const write = await page.evaluate(() => window.__WRITEDOWN_MOCK__?.clipboardWrites[0]);
    expect(write?.html).toBe('Second paragraph to select.');
    expect(write?.text).toBe(write?.html);
  });
});
