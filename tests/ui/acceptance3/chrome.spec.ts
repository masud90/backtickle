/**
 * Phase 3 acceptance C34 (lazy chunks), C35 (menu items through the mock) and C36 (axe) for
 * WP3.8a2. Mock platform, real WebKit, against the Vite dev server where every module is its own
 * request. Run with
 * WD_UI_PORT=1472.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import type { MockSeed } from '../../../src/lib/platform-mock';
import { editor, HOME, menu, preview, seedMock } from '../helpers';

const ROOT = `${HOME}/acc3`;
const DOC = `${ROOT}/doc.md`;
const PLAIN =
  '# Plain\n\nText with a [link](https://example.org) and `code`.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n';

function tree(): Record<string, string> {
  return {
    [DOC]: PLAIN,
    [`${ROOT}/alpha.md`]: '# Alpha\n\nlantern\n',
    [`${ROOT}/sub/beta.md`]: '# Beta\n\nlantern\n',
    [`${ROOT}/sub/deep/gamma.md`]: '# Gamma\n',
  };
}

async function start(page: Page, seed: MockSeed) {
  await seedMock(page, seed);
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');
}

const watchRequests = (page: Page) => {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  return urls;
};

// ---- C34 ---------------------------------------------------------------------------------------

/** Dev-server paths of the Phase 3 chunks. */
const CHUNKS: Record<string, RegExp> = {
  'paste converter': /\/src\/editor\/paste\/convert|\/\.vite\/deps\/hast-util-(to-mdast|from-dom)/,
  export: /\/src\/export\//,
  palette: /\/src\/shell\/palette\//,
  'Quick Open': /\/src\/shell\/quickopen\//,
  search: /\/src\/shell\/search\//,
  Files: /\/src\/shell\/files\//,
  'preview find': /\/src\/preview\/find\//,
};

const loaded = (urls: string[], pattern: RegExp) => urls.filter((url) => pattern.test(url));

test.describe('C34 lazy chunks', () => {
  test('C34 the welcome screen loads no Phase 3 chunk', async ({ page }) => {
    const urls = watchRequests(page);
    await start(page, { launch: { welcome: true } });
    await expect(page.getByTestId('welcome')).toBeVisible();
    await page.waitForTimeout(1500);
    for (const [name, pattern] of Object.entries(CHUNKS)) {
      expect(loaded(urls, pattern), name).toEqual([]);
    }
  });

  test('C34 a GFM document in Split loads no Phase 3 chunk until a feature is used', async ({
    page,
  }) => {
    const urls = watchRequests(page);
    await start(page, { files: tree(), launch: { openPath: DOC, view: 'split' } });
    await expect(preview(page).locator('h1')).toHaveText('Plain');
    await expect(editor(page)).toBeVisible();
    await page.waitForTimeout(1500);
    for (const [name, pattern] of Object.entries(CHUNKS)) {
      expect(loaded(urls, pattern), name).toEqual([]);
    }
  });

  const USES: Array<[string, string, RegExp, 'split' | 'preview']> = [
    ['palette', 'command-palette', CHUNKS.palette as RegExp, 'split'],
    ['Quick Open', 'quick-open', CHUNKS['Quick Open'] as RegExp, 'split'],
    ['search', 'search-folder', CHUNKS.search as RegExp, 'split'],
    ['Files', 'open-folder', CHUNKS.Files as RegExp, 'split'],
    ['export', 'export-html', CHUNKS.export as RegExp, 'split'],
    ['preview find', 'find', CHUNKS['preview find'] as RegExp, 'preview'],
  ];
  for (const [name, action, pattern, view] of USES) {
    test(`C34 ${name} loads when it is first used, and only its own chunks`, async ({ page }) => {
      const urls = watchRequests(page);
      await start(page, {
        files: tree(),
        folderDialog: ROOT,
        saveDialog: `${ROOT}/out.html`,
        launch: { openPath: DOC, view },
      });
      await expect(preview(page).locator('h1')).toHaveText('Plain');
      await page.waitForTimeout(800);
      await menu(page, action);
      await expect.poll(() => loaded(urls, pattern).length, { timeout: 15_000 }).toBeGreaterThan(0);
      // Using one feature does not load the paste converter.
      expect(loaded(urls, CHUNKS['paste converter'] as RegExp)).toEqual([]);
    });
  }

  test('C34 the paste converter loads on the first rich paste', async ({ page }) => {
    const urls = watchRequests(page);
    await start(page, { files: tree(), launch: { openPath: DOC, view: 'split' } });
    await expect(editor(page)).toBeVisible();
    await page.waitForTimeout(800);
    expect(loaded(urls, CHUNKS['paste converter'] as RegExp)).toEqual([]);
    await editor(page).click();
    await page.evaluate(() => {
      const target = document.querySelector('[data-testid="editor"] .cm-content') as HTMLElement;
      const data = new DataTransfer();
      data.setData('text/plain', 'Bold and plain');
      data.setData('text/html', '<p><b>Bold</b> and plain</p>');
      target.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    });
    await expect
      .poll(() => loaded(urls, CHUNKS['paste converter'] as RegExp).length, { timeout: 15_000 })
      .toBeGreaterThan(0);
  });
});

// ---- C35 ---------------------------------------------------------------------------------------

const lastState = (page: Page) =>
  page.evaluate(() => {
    const states = window.__WRITEDOWN_MOCK__?.menuStates ?? [];
    return states[states.length - 1] ?? null;
  });

test.describe('C35 menu state and actions through the mock', () => {
  test('C35 hasPath follows the document, canExportDocx is false without Pandoc', async ({
    page,
  }) => {
    await start(page, {
      files: tree(),
      pandoc: null,
      launch: { openPath: DOC, view: 'split' },
    });
    await expect(preview(page).locator('h1')).toHaveText('Plain');
    await expect.poll(async () => (await lastState(page))?.hasPath).toBe(true);
    expect((await lastState(page))?.canExportDocx).toBe(false);
    await menu(page, 'new');
    await expect.poll(async () => (await lastState(page))?.hasPath).toBe(false);
    expect((await lastState(page))?.canExportDocx).toBe(false);
    await menu(page, 'close-tab');
    await expect.poll(async () => (await lastState(page))?.hasPath).toBe(true);
  });

  test('C35 canExportDocx is true when Pandoc was found at startup', async ({ page }) => {
    // Pandoc is looked up once when the window starts, so it is seeded, not scripted later.
    await start(page, {
      files: tree(),
      pandoc: { path: '/mock/pandoc', version: '3.8.3' },
      launch: { openPath: DOC, view: 'split' },
    });
    await expect(preview(page).locator('h1')).toHaveText('Plain');
    await expect.poll(async () => (await lastState(page))?.canExportDocx).toBe(true);
    await menu(page, 'new');
    await expect.poll(async () => (await lastState(page))?.hasPath).toBe(false);
    await expect.poll(async () => (await lastState(page))?.canExportDocx).toBe(true);
  });

  test('C35 canFormat is false in the preview view and true with the editor visible', async ({
    page,
  }) => {
    await start(page, { files: tree(), launch: { openPath: DOC, view: 'split' } });
    await expect(editor(page)).toBeVisible();
    await expect.poll(async () => (await lastState(page))?.canFormat).toBe(true);
    await menu(page, 'view-preview');
    await expect.poll(async () => (await lastState(page))?.canFormat).toBe(false);
  });

  test('C35 the palette shows the shortcuts of the new items', async ({ page }) => {
    await start(page, { files: tree(), launch: { openPath: DOC, view: 'split' } });
    await expect(editor(page)).toBeVisible();
    await menu(page, 'command-palette');
    await expect(page.getByTestId('picker')).toBeVisible();
    const row = (name: string) => page.getByTestId('picker-row').filter({ hasText: name }).first();
    const expected: Array<[string, string]> = [
      ['Open Folder…', '⌥⌘O'],
      ['Quick Open…', '⇧⌘O'],
      ['Search in Folder…', '⇧⌘F'],
      ['Print…', '⌘P'],
      ['Paste and Match Style', '⌥⇧⌘V'],
    ];
    for (const [name, shortcut] of expected) {
      await page.getByTestId('picker-input').fill(name);
      await expect(row(name), name).toContainText(shortcut);
    }
  });

  test('C35 every new menu action runs through the mock without an error', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text());
    });
    await start(page, {
      files: tree(),
      folderDialog: null,
      saveDialog: `${ROOT}/exported.html`,
      pandoc: { path: '/mock/pandoc', version: '3.8.3' },
      launch: { openPath: DOC, view: 'split' },
    });
    await expect(editor(page)).toBeVisible();
    for (const action of ['command-palette', 'quick-open']) {
      await menu(page, action);
      await expect(page.getByTestId('picker')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('picker')).toHaveCount(0);
    }
    await menu(page, 'search-folder');
    await expect(page.getByTestId('sidebar-tab-search')).toHaveAttribute('aria-selected', 'true');
    await menu(page, 'open-folder'); // the dialog answers "cancelled"
    await menu(page, 'export-html');
    await expect.poll(() => page.evaluate(() => window.__WRITEDOWN_MOCK__?.exports.length)).toBe(1);
    await menu(page, 'copy-html');
    await expect
      .poll(() => page.evaluate(() => window.__WRITEDOWN_MOCK__?.clipboardWrites.length))
      .toBe(1);
    await menu(page, 'print');
    await expect.poll(() => page.evaluate(() => window.__WRITEDOWN_MOCK__?.prints)).toBe(1);
    await menu(page, 'duplicate');
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window.__WRITEDOWN_MOCK__?.fileOps ?? []).some((op) => op.op === 'duplicate'),
        ),
      )
      .toBe(true);
    await menu(page, 'revert');
    await menu(page, 'paste-plain');
    await page.waitForTimeout(300);
    expect(problems).toEqual([]);
  });
});

// ---- C36 ---------------------------------------------------------------------------------------

async function seriousViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.impact} ${v.id}: ${v.help} (${v.nodes.length} nodes, first: ${v.nodes[0]?.target.join(' ')})`,
    );
}

const LANTERN = {
  files: [
    {
      path: `${ROOT}/alpha.md`,
      matches: [{ line: 3, text: 'lantern', ranges: [[0, 7]] as Array<[number, number]> }],
    },
    {
      path: `${ROOT}/sub/beta.md`,
      matches: [{ line: 3, text: 'a lantern here', ranges: [[2, 9]] as Array<[number, number]> }],
    },
  ],
};

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`C36 axe (${scheme})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
    });

    test(`C36 Files tab with an expanded folder and the context menu (${scheme})`, async ({
      page,
    }) => {
      await start(page, { files: tree(), launch: { welcome: true, folderPath: ROOT } });
      await page.getByTestId('sidebar-tab-files').click();
      await expect(page.getByTestId('files-tree')).toBeVisible();
      const sub = page.locator(`[data-testid="files-row"][data-path="${ROOT}/sub"]`);
      await sub.click();
      await expect(sub).toHaveAttribute('aria-expanded', 'true');
      await sub.click({ button: 'right' });
      await expect(page.getByRole('menu', { name: 'File actions' })).toBeVisible();
      expect(await seriousViolations(page), 'Files tab').toEqual([]);
    });

    test(`C36 Search with results (${scheme})`, async ({ page }) => {
      await start(page, {
        files: tree(),
        searchResults: { lantern: LANTERN },
        launch: { welcome: true, folderPath: ROOT },
      });
      await menu(page, 'search-folder');
      await page.getByTestId('search-input').fill('lantern');
      await expect(page.getByTestId('search-file')).toHaveCount(2);
      expect(await seriousViolations(page), 'Search tab').toEqual([]);
    });

    test(`C36 Quick Open (${scheme})`, async ({ page }) => {
      await start(page, { files: tree(), launch: { openPath: DOC, folderPath: ROOT } });
      await expect(page.getByTestId('document-name')).toBeVisible();
      await menu(page, 'quick-open');
      await expect(page.getByTestId('picker')).toBeVisible();
      await expect.poll(() => page.getByTestId('picker-row').count()).toBeGreaterThan(1);
      expect(await seriousViolations(page), 'Quick Open').toEqual([]);
    });

    test(`C36 command palette (${scheme})`, async ({ page }) => {
      await start(page, { files: tree(), launch: { openPath: DOC, view: 'split' } });
      await expect(page.getByTestId('document-name')).toBeVisible();
      await menu(page, 'command-palette');
      await expect(page.getByTestId('picker')).toBeVisible();
      await expect.poll(() => page.getByTestId('picker-row').count()).toBeGreaterThan(3);
      expect(await seriousViolations(page), 'palette').toEqual([]);
    });

    test(`C36 preview find bar (${scheme})`, async ({ page }) => {
      await start(page, { files: tree(), launch: { openPath: DOC, view: 'preview' } });
      await expect(preview(page).locator('h1')).toHaveText('Plain');
      await menu(page, 'find');
      await expect(page.getByTestId('preview-find')).toBeVisible();
      await page.getByTestId('preview-find-input').fill('plain');
      await expect(page.getByTestId('preview-find-count')).toContainText('of');
      expect(await seriousViolations(page), 'preview find').toEqual([]);
    });

    test(`C36 the external-change banner (${scheme})`, async ({ page }) => {
      await start(page, { files: tree(), launch: { openPath: DOC, view: 'split' } });
      await expect(editor(page)).toBeVisible();
      await editor(page).click();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.type(' edit');
      await page.evaluate((path) => {
        const m = window.__WRITEDOWN_MOCK__;
        m?.externallyModify(path, '# Changed elsewhere\n');
        m?.fileChanged([{ path, kind: 'modified', scope: 'document' }]);
      }, DOC);
      await expect(page.getByTestId('banner-external')).toBeVisible();
      expect(await seriousViolations(page), 'external-change banner').toEqual([]);
    });
  });
}
