/**
 * Phase 4 acceptance D21 and D22. Run with WD_UI_PORT=1487.
 */
import { expect, test } from '@playwright/test';
import { change, preview, seedMock } from './support';
import { contrastOf } from './wcag';

const CODE = [
  '# Code',
  '',
  '```js',
  '// a comment',
  "const greeting = 'hello';",
  'function add(a, b) { return a + b; } // 42',
  'if (greeting) { add(1, 2); }',
  '```',
  '',
  '```json',
  '{ "key": [1, true, null], "other": "text" }',
  '```',
  '',
  '```python',
  'def f(x):',
  '    return x * 2  # double',
  '```',
  '',
].join('\n');

for (const scheme of ['light', 'dark'] as const) {
  for (const cards of ['light', 'dark'] as const) {
    test(`D21 ${cards} code cards: every code token has at least 4.5:1 (${scheme} theme)`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await seedMock(page, {
        files: { '/Users/mock/c.md': CODE },
        launch: { openPath: '/Users/mock/c.md', view: 'preview' },
        settings: { preview: { codeCards: cards } },
      });
      await page.goto('/');
      const cardsLocator = preview(page).locator('.code-card');
      await expect(cardsLocator).toHaveCount(3);
      await expect(preview(page).locator('.code-card pre code span').first()).toBeAttached();
      const samples = await preview(page).evaluate((root) => {
        const out: Array<{ text: string; color: string; bg: string }> = [];
        for (const card of root.querySelectorAll('.code-card')) {
          const pre = card.querySelector('pre') as HTMLElement;
          // The card face: the first non-transparent background from the code element upward.
          const face = (start: Element): string => {
            let el: Element | null = start;
            while (el) {
              const bg = getComputedStyle(el).backgroundColor;
              if (!/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg;
              el = el.parentElement;
            }
            return 'rgb(255, 255, 255)';
          };
          const bg = face(pre);
          for (const el of pre.querySelectorAll('code, code span')) {
            if (!(el.textContent ?? '').trim()) continue;
            out.push({
              text: (el.textContent ?? '').trim().slice(0, 20),
              color: getComputedStyle(el).color,
              bg,
            });
          }
        }
        return out;
      });
      expect(samples.length).toBeGreaterThan(10);
      const distinct = new Set(samples.map((s) => s.color));
      expect(distinct.size).toBeGreaterThan(2);
      for (const s of samples) {
        expect(
          contrastOf(s.color, s.bg),
          `"${s.text}" ${s.color} on ${s.bg}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      if (cards === 'light') {
        // The card is light in both themes: its face has a high luminance.
        expect(contrastOf('rgb(0, 0, 0)', samples[0]?.bg ?? '')).toBeGreaterThan(10);
      }
    });
  }
}

test('D22 a setting change re-renders each open document once and keeps the scroll position', async ({
  page,
}) => {
  const long = (tag: string) =>
    Array.from({ length: 260 }, (_, i) => `Line ${i} ${tag} #t${i}\n`).join('\n');
  await seedMock(page, {
    files: { '/Users/mock/a.md': long('alpha'), '/Users/mock/b.md': long('beta') },
    launch: { openPath: '/Users/mock/a.md', view: 'preview' },
  });
  await page.goto('/');
  await expect(preview(page).locator('p').first()).toContainText('alpha');
  // A second tab, opened as the shell does on a file open.
  await page.evaluate(() => window.__WRITEDOWN_MOCK__?.openFiles(['/Users/mock/b.md']));
  await expect(page.getByTestId('document-name')).toHaveText('b.md');
  await page.getByTestId('tab').first().click();
  await expect(page.getByTestId('document-name')).toHaveText('a.md');
  const scroller = page.getByTestId('preview-scroll');
  await scroller.evaluate((el) => {
    el.scrollTop = 3000;
  });
  const before = await scroller.evaluate((el) => el.scrollTop);
  expect(before).toBeGreaterThan(1000);
  // Count batches of DOM changes in the preview from now on.
  await preview(page).evaluate((root) => {
    const w = window as unknown as { __d22: number };
    w.__d22 = 0;
    new MutationObserver((records) => {
      if (records.some((r) => r.addedNodes.length > 0 || r.removedNodes.length > 0)) w.__d22 += 1;
    }).observe(root, { childList: true, subtree: true });
  });
  await change(page, { preview: { hashtagPills: true } });
  await expect(preview(page).locator('span.tag').first()).toBeVisible();
  await page.waitForTimeout(700);
  const batches = await page.evaluate(() => (window as unknown as { __d22: number }).__d22);
  expect(batches).toBe(1);
  const after = await scroller.evaluate((el) => el.scrollTop);
  expect(Math.abs(after - before)).toBeLessThan(40);
  // The other tab shows the pills too when it becomes active, without a second change.
  await page.getByTestId('tab').nth(1).click();
  await expect(page.getByTestId('document-name')).toHaveText('b.md');
  await expect(preview(page).locator('span.tag').first()).toBeVisible();
});
