/** WP5.11 acceptance: exact preview through Pandoc, on the mock. Run with WD_UI_PORT=1501. */
import { expect, type Page, test } from '@playwright/test';
import { HOME, menu, seedMock } from '../helpers';

const PANDOC = { path: '/mock/pandoc', version: '3.8.3' };

async function open(
  page: Page,
  name: string,
  text: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const doc = `${HOME}/docs/${name}`;
  await seedMock(page, {
    files: { [doc]: text },
    pandoc: PANDOC,
    launch: { openPath: doc, view: 'split' },
    ...extra,
  });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');
  await expect(page.getByTestId('preview').locator('h1').first()).toBeVisible();
}

const state = (page: Page) =>
  page.evaluate(() => {
    const m = window.__WRITEDOWN_MOCK__?.menuStates.at(-1);
    return { can: m?.canExactPreview, on: m?.exactPreview };
  });
const requests = (page: Page) =>
  page.evaluate(() => window.__WRITEDOWN_MOCK__?.pandocPreviewRequests ?? []);

test.describe('E5.11 exact preview (Pandoc)', () => {
  test('E5.11-1 View menu toggles it; status bar says Pandoc preview; request is fixed', async ({
    page,
  }) => {
    await open(page, 'a.md', '# Title\n\nText.\n', {
      pandocPreview: { html: '<h1 id="title">Pandoc title</h1>' },
    });
    await expect(page.getByTestId('status-pandoc-preview')).toHaveCount(0);
    await expect.poll(() => state(page)).toEqual({ can: true, on: false });
    await menu(page, 'toggle-exact-preview');
    await expect(page.getByTestId('status-pandoc-preview')).toHaveText('Pandoc preview');
    await expect(page.getByTestId('pandoc-preview-content')).toContainText('Pandoc title');
    await expect(page.getByTestId('preview')).toBeHidden();
    const [first] = await requests(page);
    expect(first).toMatchObject({ from: 'gfm', citeproc: false });
    await expect.poll(() => state(page)).toEqual({ can: true, on: true });
    await menu(page, 'toggle-exact-preview');
    await expect(page.getByTestId('pandoc-preview')).toHaveCount(0);
    await expect(page.getByTestId('preview')).toBeVisible();
    await expect(page.getByTestId('status-pandoc-preview')).toHaveCount(0);
  });

  test('E5.11-2 the palette lists and runs it', async ({ page }) => {
    await open(page, 'a.md', '# T\n');
    await menu(page, 'command-palette');
    await page.getByTestId('picker-input').fill('exact preview');
    await expect(page.getByTestId('picker')).toContainText('Exact Preview (Pandoc)');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('pandoc-preview')).toBeVisible();
  });

  test('E5.11-3 not available for MDX, Obsidian, or without Pandoc', async ({ page }) => {
    await open(page, 'a.mdx', '# MDX\n');
    await expect.poll(() => state(page)).toEqual({ can: false, on: false });
    await menu(page, 'toggle-exact-preview');
    await expect(page.getByTestId('pandoc-preview')).toHaveCount(0);
    expect(await requests(page)).toEqual([]);
  });

  test('E5.11-3b Obsidian: the item is disabled', async ({ page }) => {
    await open(page, 'a.md', '# T\n\n[[Note]]\n');
    await menu(page, 'command-palette');
    await page.getByTestId('picker-input').fill('obsidian');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('status-flavor')).toContainText('Obsidian');
    await expect.poll(() => state(page)).toEqual({ can: false, on: false });
  });

  test('E5.11-3c without Pandoc the item is disabled', async ({ page }) => {
    await open(page, 'b.md', '# T\n', { pandoc: null });
    await expect.poll(() => state(page)).toEqual({ can: false, on: false });
  });

  test('E5.11-4 an edit is rendered after 800 ms and a run in progress is cancelled', async ({
    page,
  }) => {
    await open(page, 'a.md', '# T\n', { pandocPreview: { hold: true } });
    await menu(page, 'toggle-exact-preview');
    await expect.poll(async () => (await requests(page)).length).toBe(1);
    await page.getByTestId('editor').click();
    await page.keyboard.type('x');
    await expect
      .poll(() => page.evaluate(() => window.__WRITEDOWN_MOCK__?.pandocPreviewCancels))
      .toBe(1);
    expect(await requests(page)).toHaveLength(1);
    await page.evaluate(() =>
      window.__WRITEDOWN_MOCK__?.setPandocPreview({ html: '<p>fresh</p>' }),
    );
    await page.waitForTimeout(500);
    expect(await requests(page)).toHaveLength(1);
    await expect.poll(async () => (await requests(page)).length).toBe(2);
    await expect(page.getByTestId('pandoc-preview-content')).toContainText('fresh');
  });

  test('E5.11-5 an error shows a banner over the last good render', async ({ page }) => {
    await open(page, 'a.md', '# T\n', { pandocPreview: { html: '<p>good render</p>' } });
    await menu(page, 'toggle-exact-preview');
    await expect(page.getByTestId('pandoc-preview-content')).toContainText('good render');
    await page.evaluate(() =>
      window.__WRITEDOWN_MOCK__?.setPandocPreview({ error: 'Error at line 3' }),
    );
    await page.getByTestId('editor').click();
    await page.keyboard.type('y');
    await expect(page.getByTestId('pandoc-preview-error')).toHaveText('Error at line 3');
    await expect(page.getByTestId('pandoc-preview-content')).toContainText('good render');
  });

  test('E5.11-6 Pandoc HTML is sanitized: script and onerror never reach the DOM', async ({
    page,
  }) => {
    await open(page, 'a.md', '# T\n', {
      pandocPreview: {
        html: '<p>safe</p><script>window.__pwned=1</script><img src="x" onerror="window.__pwned=2"><p onclick="window.__pwned=3" style="color:red">c</p>',
      },
    });
    await menu(page, 'toggle-exact-preview');
    const content = page.getByTestId('pandoc-preview-content');
    await expect(content).toContainText('safe');
    expect(await content.locator('script').count()).toBe(0);
    expect(await content.locator('[onerror], [onclick], [style]').count()).toBe(0);
    expect(
      await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
    ).toBeUndefined();
  });
});
