import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import type { MockSeed } from '../../src/lib/platform-mock';
import { editor, fixture, HOME, menu, preview, seedMock } from './helpers';

/** Replaces the answers of the mock's dialogs while the page runs. */
async function seedAnswers(page: Page, answers: Record<string, unknown>) {
  await page.evaluate((value) => window.__WRITEDOWN_MOCK__?.setAnswers(value as never), answers);
}

const SAMPLE_BYTES = readFileSync(
  new URL('../fixtures/perf/wireframe-sample-phase0.md', import.meta.url),
).length;
const SAMPLE = fixture('perf/wireframe-sample-phase0.md');
const SAMPLE_PATH = `${HOME}/Documents/Product_Spec.md`;

const SAMPLE_TITLE = 'Quantum Flow: Architecture & API Specifications';

/** The Phase 0 sample opened from the command line in Split view, as the measurement harness does. */
function sampleSeed(launch: Record<string, unknown> = {}): MockSeed {
  return {
    files: {
      [SAMPLE_PATH]: SAMPLE,
      '/Users/me/Notes/plan.md': '# Plan\n\nBody text here',
    },
    launch: { openPath: SAMPLE_PATH, view: 'split', ...launch },
  };
}

async function openSampleAndWait(page: Page, launch: Record<string, unknown> = {}) {
  await seedMock(page, sampleSeed(launch));
  await page.goto('/');
  await expect(preview(page).getByRole('heading', { level: 1, name: SAMPLE_TITLE })).toBeVisible();
}

test.describe('the sample document', () => {
  test('shows the wireframe sample rendered in the preview and as source in the editor', async ({
    page,
  }) => {
    await openSampleAndWait(page);

    await expect(page.getByTestId('document-name')).toHaveText('Product_Spec.md');
    await expect(editor(page)).toContainText('# Quantum Flow: Architecture & API Specifications');
    await expect(preview(page).getByRole('heading', { level: 2 })).toHaveCount(3);
    await expect(
      preview(page).getByRole('heading', { level: 3, name: 'Sprint Implementation Roadmap' }),
    ).toBeVisible();
    await expect(preview(page).locator('table')).toBeVisible();
    await expect(
      preview(page).locator('.code-card[data-lang="typescript"] pre code'),
    ).toContainText('QuantumStreamPacket');
    await expect(preview(page).locator('.task-checkbox')).toHaveCount(4);
    await expect(preview(page).locator('.task-checkbox[aria-checked="true"]')).toHaveCount(2);
  });

  test('typing in the editor updates the preview', async ({ page }) => {
    await openSampleAndWait(page);

    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('## Typed heading');

    await expect(
      preview(page).getByRole('heading', { level: 2, name: 'Typed heading' }),
    ).toBeVisible();
    // The rest of the preview is still there.
    await expect(
      preview(page).getByRole('heading', { level: 1, name: SAMPLE_TITLE }),
    ).toBeVisible();
  });

  test('updates keep the DOM nodes of blocks that did not change', async ({ page }) => {
    await openSampleAndWait(page);
    await page.evaluate(() => {
      const h1 = document.querySelector('[data-testid="preview"] h1');
      (window as unknown as { __h1: Element | null }).__h1 = h1;
    });

    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('Appended paragraph');
    await expect(preview(page).getByText('Appended paragraph')).toBeVisible();

    const sameNode = await page.evaluate(
      () =>
        (window as unknown as { __h1: Element | null }).__h1 ===
        document.querySelector('[data-testid="preview"] h1'),
    );
    expect(sameNode).toBe(true);
  });

  test('Cmd+Z and Shift+Cmd+Z undo and redo typing', async ({ page }) => {
    await openSampleAndWait(page);

    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('UNDO-ME');
    await expect(editor(page)).toContainText('UNDO-ME');

    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor(page)).not.toContainText('UNDO-ME');

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(editor(page)).toContainText('UNDO-ME');
  });

  test('edit commands from the application menu reach the editor (undo, redo)', async ({
    page,
  }) => {
    await openSampleAndWait(page);

    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('MENU-UNDO');
    await expect(editor(page)).toContainText('MENU-UNDO');

    await menu(page, 'undo');
    await expect(editor(page)).not.toContainText('MENU-UNDO');
    await expect(preview(page)).not.toContainText('MENU-UNDO');

    await menu(page, 'redo');
    await expect(editor(page)).toContainText('MENU-UNDO');
  });

  test('the editor has line numbers, an active line and the spell checker switched on', async ({
    page,
  }) => {
    await openSampleAndWait(page);

    await expect(page.locator('.cm-lineNumbers')).toBeVisible();
    await expect(page.locator('.cm-activeLine')).toHaveCount(1);
    await expect(editor(page)).toHaveAttribute('spellcheck', 'true');
  });

  test('soft wrap: a long line wraps instead of scrolling sideways', async ({ page }) => {
    await seedMock(page, {
      files: { '/long.md': `# Long\n\n${'word '.repeat(300)}\n` },
      launch: { openPath: '/long.md' },
    });
    await page.goto('/');
    await expect(preview(page).getByRole('heading', { name: 'Long' })).toBeVisible();

    const scroller = page.locator('.cm-scroller');
    const overflow = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('opening files', () => {
  test('Open shows the file from the dialog: name, source, preview and status numbers', async ({
    page,
  }) => {
    await openSampleAndWait(page);
    await seedAnswers(page, { openDialog: ['/Users/me/Notes/plan.md'] });

    await menu(page, 'open');

    await expect(page.getByTestId('document-name')).toHaveText('plan.md');
    await expect(preview(page).getByRole('heading', { level: 1, name: 'Plan' })).toBeVisible();
    await menu(page, 'view-split'); // existing files open in Preview
    await expect(editor(page)).toContainText('Body text here');
    // Prose words: "Plan", "Body", "text", "here".
    await expect(page.getByTestId('status-words')).toHaveText('Words: 4');
    await expect(page.getByTestId('status-position')).toHaveText('Ln 1, Col 1');
  });

  test('a file opened with Open starts with a fresh undo history', async ({ page }) => {
    await openSampleAndWait(page);
    await seedAnswers(page, { openDialog: ['/Users/me/Notes/plan.md'] });
    await menu(page, 'open');
    await expect(page.getByTestId('document-name')).toHaveText('plan.md');
    await menu(page, 'view-split');

    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+z'); // nothing to undo in the new document

    await expect(editor(page)).toContainText('# Plan');
    await expect(preview(page).getByRole('heading', { level: 1, name: 'Plan' })).toBeVisible();
  });

  test('cancelling the dialog keeps the current document', async ({ page }) => {
    await openSampleAndWait(page);
    await seedAnswers(page, { openDialog: [] });

    await menu(page, 'open');

    await expect(page.getByTestId('document-name')).toHaveText('Product_Spec.md');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('a file that cannot be read shows a message and keeps the current document', async ({
    page,
  }) => {
    await openSampleAndWait(page);
    await seedAnswers(page, { openDialog: ['/gone.md'] });

    await menu(page, 'open');

    await expect(page.getByRole('alert')).toContainText('The file was not found');
    await expect(page.getByTestId('document-name')).toHaveText('Product_Spec.md');
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('--open: the file given at launch is shown at startup', async ({ page }) => {
    await seedMock(page, {
      files: { '/work/spec.md': '# From the command line\n\ntext' },
      launch: { openPath: '/work/spec.md' },
    });
    await page.goto('/');

    await expect(page.getByTestId('document-name')).toHaveText('spec.md');
    await expect(
      preview(page).getByRole('heading', { name: 'From the command line' }),
    ).toBeVisible();
  });
});

test.describe('no document open (--welcome)', () => {
  test('shows the welcome screen instead of the panes, and Open File brings the panes in', async ({
    page,
  }) => {
    await seedMock(page, {
      files: { '/c.md': '# C doc' },
      openDialog: ['/c.md'],
      launch: { welcome: true },
    });
    await page.goto('/');

    await expect(page.getByTestId('welcome')).toContainText('Welcome to Writedown');
    await expect(page.getByTestId('workspace')).toHaveCount(0);
    await expect(page.locator('.cm-editor')).toHaveCount(0);
    await expect(page.getByTestId('document-name')).toHaveCount(0);
    await expect(page.getByTestId('status-bar')).toHaveText('');

    await page.getByTestId('welcome-open').click();

    await expect(page.getByTestId('workspace')).toBeVisible();
    await expect(page.getByTestId('welcome')).toHaveCount(0);
    await expect(preview(page).getByRole('heading', { name: 'C doc' })).toBeVisible();
  });
});

test.describe('window chrome', () => {
  test('has the mock dimensions: 44px title bar, 28px pane headers, 6px splitter, 24px status bar', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 820 });
    await openSampleAndWait(page);

    const height = async (testId: string) => (await page.getByTestId(testId).boundingBox())?.height;
    expect(await height('title-bar')).toBe(44);
    expect(await height('status-bar')).toBe(24);
    expect((await page.getByTestId('splitter-line').boundingBox())?.width).toBe(6);
    expect((await page.getByTestId('splitter').boundingBox())?.width).toBe(24);

    const paneHeaders = page.locator('[data-testid="workspace"] section > div:first-child');
    await expect(paneHeaders).toHaveCount(2);
    for (const header of await paneHeaders.all()) {
      expect((await header.boundingBox())?.height).toBe(28);
    }
    await expect(paneHeaders.nth(0)).toContainText('MARKDOWN SOURCE');
    await expect(paneHeaders.nth(1)).toContainText('LIVE PREVIEW');
  });

  test('the title bar is a drag region and its text cannot be selected', async ({ page }) => {
    await openSampleAndWait(page);

    const header = page.getByTestId('title-bar');
    await expect(header).toHaveAttribute('data-tauri-drag-region', 'deep');
    for (const testId of ['title-bar', 'status-bar', 'splitter']) {
      const userSelect = await page.getByTestId(testId).evaluate((el) => {
        const style = getComputedStyle(el);
        return style.userSelect || style.getPropertyValue('-webkit-user-select');
      });
      expect(userSelect, `${testId} user-select`).toBe('none');
    }
    await expect(
      page.locator('[data-testid="workspace"] section > div:first-child').first(),
    ).toHaveCSS('user-select', 'none');
  });

  test('the app title is centered on the window and the document name follows New', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 820 });
    await openSampleAndWait(page);

    const title = await page.getByTestId('app-title').boundingBox();
    const open = await page.getByTestId('new-button').boundingBox();
    const name = await page.getByTestId('document-name').boundingBox();
    expect(title).not.toBeNull();
    if (!title || !open || !name) return;
    expect(Math.abs(title.x + title.width / 2 - 640)).toBeLessThanOrEqual(1);
    expect(open.x).toBeGreaterThanOrEqual(84); // clear of the traffic lights
    expect(name.x).toBeGreaterThan(open.x + open.width);
  });

  test('the window itself does not scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 400 });
    await openSampleAndWait(page);

    const overflow = await page.evaluate(() => ({
      x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }));
    expect(overflow).toEqual({ x: 0, y: 0 });
  });
});

test.describe('splitter', () => {
  const widths = async (page: Page) => ({
    editor:
      (await page.locator('[aria-label="Markdown source"]').first().boundingBox())?.width ?? 0,
    preview: (await page.getByRole('region', { name: 'Preview' }).boundingBox())?.width ?? 0,
  });

  test('starts at 50/50, drags, and resets with a double click', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 });
    await openSampleAndWait(page);

    const start = await widths(page);
    expect(Math.abs(start.editor - start.preview)).toBeLessThanOrEqual(1);

    const splitter = (await page.getByTestId('splitter').boundingBox()) as NonNullable<
      Awaited<ReturnType<ReturnType<Page['getByTestId']>['boundingBox']>>
    >;
    const y = splitter.y + splitter.height / 2;
    await page.mouse.move(splitter.x + 3, y);
    await page.mouse.down();
    await page.mouse.move(splitter.x + 3 + 150, y, { steps: 5 });
    await page.mouse.up();

    const dragged = await widths(page);
    expect(dragged.editor).toBeGreaterThan(start.editor + 100);
    expect(dragged.preview).toBeLessThan(start.preview - 100);

    await page.getByTestId('splitter').dblclick();
    const reset = await widths(page);
    expect(Math.abs(reset.editor - reset.preview)).toBeLessThanOrEqual(1);
  });

  test('neither pane can be dragged below its minimum width', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 });
    await openSampleAndWait(page);
    const splitter = (await page.getByTestId('splitter').boundingBox()) as NonNullable<
      Awaited<ReturnType<ReturnType<Page['getByTestId']>['boundingBox']>>
    >;
    const y = splitter.y + splitter.height / 2;

    await page.mouse.move(splitter.x + 3, y);
    await page.mouse.down();
    await page.mouse.move(2, y, { steps: 5 });
    await page.mouse.up();

    expect((await widths(page)).editor).toBeGreaterThanOrEqual(239);
  });

  test('arrow keys move the splitter and Enter resets it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 });
    await openSampleAndWait(page);
    const before = await widths(page);

    await page.getByTestId('splitter').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const moved = await widths(page);
    expect(moved.editor).toBeGreaterThan(before.editor + 40);

    await page.keyboard.press('Enter');
    const reset = await widths(page);
    expect(Math.abs(reset.editor - reset.preview)).toBeLessThanOrEqual(1);
  });
});

test.describe('status bar', () => {
  test('shows line, column and a prose word count that follow the editing', async ({ page }) => {
    await openSampleAndWait(page);
    await expect(page.getByTestId('status-position')).toHaveText('Ln 1, Col 1');
    await expect(page.getByTestId('status-words')).toContainText('Words: ');

    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await expect(page.getByTestId('status-position')).toHaveText('Ln 32, Col 1');

    const count = async () =>
      Number((await page.getByTestId('status-words').innerText()).replace(/\D/g, ''));
    const before = await count();
    await page.keyboard.type('three new words');
    await expect(page.getByTestId('status-position')).toHaveText('Ln 32, Col 16');
    await expect.poll(count).toBe(before + 3);
  });
});

test.describe('security', () => {
  test('script and event handlers in the document run nothing and are removed from the preview', async ({
    page,
  }) => {
    const hostile = [
      '# Hostile',
      '',
      '<script>window.__pwned = "script"</script>',
      '',
      '<img src="x" onerror="window.__pwned = \'onerror\'">',
      '',
      '<a href="javascript:window.__pwned = \'link\'" id="evil">evil link</a>',
      '',
      '<style>body { display: none !important }</style>',
      '',
      '<form action="https://example.com"><input type="text"><button>Go</button></form>',
    ].join('\n');
    await seedMock(page, {
      files: { '/hostile.md': hostile },
      launch: { openPath: '/hostile.md' },
    });
    await page.goto('/');
    await expect(preview(page).getByRole('heading', { name: 'Hostile' })).toBeVisible();

    await expect(
      preview(page).locator('script, style, form, button, input[type="text"]'),
    ).toHaveCount(0);
    await expect(preview(page).locator('[onerror], [onclick], [onload]')).toHaveCount(0);
    await expect(preview(page).locator('a[href^="javascript:"]')).toHaveCount(0);
    await page.waitForTimeout(300); // give a stray handler time to fire
    expect(
      await page.evaluate(() => (window as unknown as { __pwned?: string }).__pwned),
    ).toBeUndefined();
    await expect(page.getByTestId('title-bar')).toBeVisible(); // the app is not hidden by injected CSS
  });

  test('clicking a link in the preview does not navigate the window', async ({ page }) => {
    await seedMock(page, {
      files: {
        '/links.md': '# Links\n\n[Example](https://example.com/page) and https://example.org/',
      },
      launch: { openPath: '/links.md' },
    });
    await page.goto('/');
    await expect(preview(page).getByRole('link', { name: 'Example', exact: true })).toBeVisible();
    const before = page.url();

    await preview(page).getByRole('link', { name: 'Example', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.__WRITEDOWN_MOCK__?.externalUrls))
      .toEqual(['https://example.com/page']);

    expect(page.url()).toBe(before);
    await expect(preview(page).getByRole('heading', { name: 'Links' })).toBeVisible();
  });

  test('the page works with Object.prototype frozen, as Tauri freezePrototype does', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.freeze(Object.prototype);
    });
    await openSampleAndWait(page);

    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('## Frozen but fine');

    await expect(
      preview(page).getByRole('heading', { level: 2, name: 'Frozen but fine' }),
    ).toBeVisible();
  });
});

test.describe('measurement hooks', () => {
  test('reports the four startup marks in order when perf is on', async ({ page }) => {
    await openSampleAndWait(page, { perf: true });

    await expect
      .poll(() => page.evaluate(() => (window.__WRITEDOWN_MOCK_MARKS__ ?? []).map((m) => m.name)))
      .toEqual(['frontend-init', 'doc-loaded', 'first-preview-painted', 'ready']);

    const times = await page.evaluate(() =>
      (window.__WRITEDOWN_MOCK_MARKS__ ?? []).map((m) => m.ms),
    );
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  test('sends only frontend-init when perf is off', async ({ page }) => {
    await openSampleAndWait(page);
    await page.waitForTimeout(300);

    const names = await page.evaluate(() =>
      (window.__WRITEDOWN_MOCK_MARKS__ ?? []).map((m) => m.name),
    );
    expect(names).toEqual(['frontend-init']);
  });

  test('welcome: reports frontend-init and ready only', async ({ page }) => {
    await seedMock(page, { launch: { perf: true, welcome: true } });
    await page.goto('/');

    await expect
      .poll(() => page.evaluate(() => (window.__WRITEDOWN_MOCK_MARKS__ ?? []).map((m) => m.name)))
      .toEqual(['frontend-init', 'ready']);
  });

  test('a hidden page holds the preview back until it is visible, and the harness is told', async ({
    page,
  }) => {
    // A locked screen or a covered window makes the page "hidden". Nothing is rendered for a
    // hidden preview, and a measurement taken like that is not valid: the marks say so.
    await page.addInitScript(() => {
      let state = 'hidden';
      Object.defineProperty(document, 'visibilityState', { get: () => state, configurable: true });
      (window as unknown as { __setVisibility: (next: string) => void }).__setVisibility = (
        next,
      ) => {
        state = next;
        document.dispatchEvent(new Event('visibilitychange'));
      };
    });
    await seedMock(page, sampleSeed({ perf: true }));
    await page.goto('/');

    await expect(editor(page)).toContainText('# Quantum Flow');
    await page.waitForTimeout(500);
    await expect(preview(page).locator('h1')).toHaveCount(0);
    const early = await page.evaluate(() =>
      (window.__WRITEDOWN_MOCK_MARKS__ ?? []).map((m) => m.name),
    );
    expect(early).toEqual(['frontend-init', 'page-hidden', 'doc-loaded']);

    await page.evaluate(() =>
      (window as unknown as { __setVisibility: (next: string) => void }).__setVisibility('visible'),
    );

    await expect(
      preview(page).getByRole('heading', { level: 1, name: SAMPLE_TITLE }),
    ).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => (window.__WRITEDOWN_MOCK_MARKS__ ?? []).map((m) => m.name)))
      .toEqual([
        'frontend-init',
        'page-hidden',
        'doc-loaded',
        'page-visible',
        'first-preview-painted',
        'ready',
      ]);
  });

  test('typing benchmark: 60 insertions, one report with render and end-to-end times', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await seedMock(page, sampleSeed({ perf: true, bench: true }));
    await page.goto('/');

    await expect
      .poll(() => page.evaluate(() => window.__WRITEDOWN_MOCK_BENCH__ !== undefined), {
        timeout: 40_000,
        intervals: [500],
      })
      .toBe(true);

    const report = await page.evaluate(() => window.__WRITEDOWN_MOCK_BENCH__);
    expect(report?.renderMs).toHaveLength(60);
    expect(report?.e2eMs).toHaveLength(60);
    expect(report?.docBytes).toBe(SAMPLE_BYTES);
    // The end-to-end time contains the 120 ms debounce, two animation frames and the render.
    for (const ms of report?.e2eMs ?? []) {
      expect(ms).toBeGreaterThanOrEqual(120);
      expect(ms).toBeLessThan(2000);
    }
    for (const ms of report?.renderMs ?? []) {
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThan(500);
    }
    // 60 typed characters landed in the middle of the document, as one run of x characters.
    await expect(editor(page)).toContainText('x'.repeat(60));
  });
});
