/**
 * The malicious corpus in real WebKit: it is rendered by the preview and nothing may run.
 * `window.__XSS_SENTINEL__` is what every payload tries to set. Run with WD_UI_PORT=1433.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const CORPUS = readFileSync(new URL('../fixtures/xss/corpus.md', import.meta.url), 'utf8');

for (const flavor of ['gfm', 'commonmark'] as const) {
  test(`the corpus executes nothing and leaves nothing dangerous (${flavor})`, async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });
    const navigations: string[] = [];
    page.on('framenavigated', (frame) => navigations.push(frame.url()));

    await page.goto('/tests/harness/preview.html');
    await page.waitForFunction(() => window.__harness !== undefined);
    await page.evaluate(
      async ({ text, flavor }) => {
        await window.__harness.mount({ text, flavor });
        await window.__harness.settled();
      },
      { text: CORPUS, flavor },
    );
    await page.waitForTimeout(500); // time for a stray handler or image to fire

    expect(await page.evaluate(() => window.__XSS_SENTINEL__)).toBeUndefined();
    expect(dialogs).toEqual([]);
    expect(navigations.filter((url) => !url.includes('/tests/harness/preview.html'))).toEqual([]);

    const preview = page.getByTestId('preview');
    await expect(preview.locator('h2').first()).toBeVisible();
    await expect(
      preview.locator(
        'script, iframe, object, embed, form, input, button, textarea, select, style, meta, base, link, template, dialog',
      ),
    ).toHaveCount(0);
    await expect(preview.locator('[style]')).toHaveCount(0);
    expect(
      await preview.evaluate(
        (root) =>
          Array.from(root.querySelectorAll('*')).filter((el) =>
            Array.from(el.attributes).some((a) => /^on/i.test(a.name)),
          ).length,
      ),
    ).toBe(0);
    expect(
      await preview.evaluate(
        (root) =>
          Array.from(root.querySelectorAll('*')).filter((el) =>
            Array.from(el.attributes).some((a) =>
              /^(javascript|vbscript):|^data:text\/html/i.test(a.value.trim()),
            ),
          ).length,
      ),
    ).toBe(0);
    // The page itself is intact: nothing covered or removed it.
    await expect(page.getByTestId('scroll')).toBeVisible();
  });
}
