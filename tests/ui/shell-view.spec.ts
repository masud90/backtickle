/**
 * Views, zoom, appearance and the other settings of the main window, plus the Markdown guide and the settings stored by the shell.
 */
import { expect, type Page, test } from '@playwright/test';
import type { MockSeed } from '../../src/lib/platform-mock';
import { editor, guideText, HOME, menu, preview, seedMock, tabs } from './helpers';

const NOTE = `${HOME}/note.md`;
const LONG = `${HOME}/long.md`;
const LONG_TEXT = `# Long\n\n${Array.from({ length: 120 }, (_, i) => `Paragraph ${i + 1} with some words.`).join('\n\n')}\n`;

async function open(
  page: Page,
  seed: MockSeed = {},
  view: 'split' | 'editor' | 'preview' = 'split',
) {
  await seedMock(page, {
    ...seed,
    files: { [NOTE]: '# Note\n\nBody text here.\n', [LONG]: LONG_TEXT, ...seed.files },
    launch: { openPath: NOTE, view },
  });
  await page.goto('/');
  await expect(page.getByTestId('document-name')).toHaveText('note.md');
}

const menuState = (page: Page) => page.evaluate(() => window.__WRITEDOWN_MOCK__?.menuStates.at(-1));
const settings = (page: Page) => page.evaluate(() => window.__WRITEDOWN_MOCK__?.settings);
const previewPane = (page: Page) => page.getByRole('region', { name: 'Preview' });
const editorPane = (page: Page) => page.getByRole('region', { name: 'Markdown source' });

test.describe('A23 view modes', () => {
  test('A23 the view menu actions switch between Editor, Split and Preview', async ({ page }) => {
    await open(page);
    await expect(editorPane(page)).toBeVisible();
    await expect(previewPane(page)).toBeVisible();
    await expect(page.getByTestId('splitter')).toBeVisible();

    await menu(page, 'view-preview');
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'preview');
    await expect(editorPane(page)).toBeHidden();
    await expect(previewPane(page)).toBeVisible();
    await expect(page.getByTestId('splitter')).toHaveCount(0);

    await menu(page, 'view-editor');
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'editor');
    await expect(editorPane(page)).toBeVisible();
    await expect(previewPane(page)).toBeHidden();

    await menu(page, 'view-split');
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'split');
    await expect(editorPane(page)).toBeVisible();
    await expect(previewPane(page)).toBeVisible();
  });

  test('A23 the menu state follows: formatting is disabled in Preview', async ({ page }) => {
    await open(page);
    await expect.poll(() => menuState(page)).toMatchObject({ viewMode: 'split', canFormat: true });

    await menu(page, 'view-preview');
    await expect
      .poll(() => menuState(page))
      .toMatchObject({ viewMode: 'preview', canFormat: false, hasDocument: true });

    await menu(page, 'view-editor');
    await expect.poll(() => menuState(page)).toMatchObject({ viewMode: 'editor', canFormat: true });
  });

  test('A23 a formatting action in Preview view changes nothing', async ({ page }) => {
    await open(page, {}, 'preview');

    await menu(page, 'bold');
    await menu(page, 'heading-2');
    await menu(page, 'view-split');

    await expect(editor(page)).toContainText('# Note');
    await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  });

  test('A23 a formatting action in Split view formats the editor, and one Undo takes it back', async ({
    page,
  }) => {
    await open(page);
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('word');
    await page.keyboard.press('Shift+ControlOrMeta+ArrowLeft');

    await menu(page, 'bold');
    await expect(editor(page)).toContainText('**word**');

    await menu(page, 'undo');
    await expect(editor(page)).not.toContainText('**word**');
  });

  test('A23 the view is kept per tab', async ({ page }) => {
    await open(page, { openDialog: [LONG] }, 'preview');
    await menu(page, 'open');
    await expect(tabs(page)).toHaveText(['note.md', 'long.md']);
    // long.md opens in Preview (the setting); put it in Split, and note.md stays in Preview.
    await menu(page, 'view-split');
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'split');

    await tabs(page).first().click();
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'preview');

    await tabs(page).nth(1).click();
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'split');
  });

  test('A23 the editor keeps its text and history while it is out of sight', async ({ page }) => {
    await open(page);
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('KEEP-ME');

    await menu(page, 'view-preview');
    await expect(preview(page)).toContainText('KEEP-ME');
    await menu(page, 'view-editor');

    await expect(editor(page)).toContainText('KEEP-ME');
    await menu(page, 'undo');
    await expect(editor(page)).not.toContainText('KEEP-ME');
  });

  test('A23 Editor view does not render the preview; Preview catches up when shown', async ({
    page,
  }) => {
    await open(page);
    await menu(page, 'view-editor');
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('hidden words here');
    // The status bar still counts: the preview analyzes the text without rendering it.
    await expect(page.getByTestId('status-words')).toHaveText('Words: 7');
    await expect(preview(page)).not.toContainText('hidden words here');

    await menu(page, 'view-preview');

    await expect(preview(page)).toContainText('hidden words here');
  });

  test('A23 the scroll positions of both panes come back after a tab switch and a view switch', async ({
    page,
  }) => {
    await open(page, { openDialog: [LONG] }, 'split');
    await menu(page, 'open');
    await menu(page, 'view-split');
    await expect(page.getByTestId('document-name')).toHaveText('long.md');
    // With sync scroll on the panes move together; this test keeps them apart.
    await menu(page, 'toggle-sync-scroll');
    await expect(page.getByTestId('sync-scroll')).toHaveAttribute('aria-checked', 'false');
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    const scroller = page.locator('.cm-scroller');
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(500);
    const editorTop = await scroller.evaluate((el) => el.scrollTop);
    await page.getByTestId('preview-scroll').evaluate((el) => {
      el.scrollTop = 600;
    });

    await tabs(page).first().click();
    await expect(page.getByTestId('document-name')).toHaveText('note.md');
    await tabs(page).nth(1).click();
    await expect(page.getByTestId('document-name')).toHaveText('long.md');

    await expect
      .poll(() => page.getByTestId('preview-scroll').evaluate((el) => el.scrollTop))
      .toBeGreaterThan(550);
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(editorTop - 100);
  });
});

test.describe('A27 zoom', () => {
  const editorFont = (page: Page) =>
    page.locator('.cm-scroller').evaluate((el) => {
      const style = getComputedStyle(el);
      return `${style.fontSize} / ${style.lineHeight}`;
    });
  const paragraphFont = (page: Page) =>
    preview(page)
      .locator('p')
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize);

  test('A27 Zoom In, Zoom Out and Actual Size change the editor and the preview text', async ({
    page,
  }) => {
    await open(page);
    expect(await editorFont(page)).toBe('13px / 22px');
    expect(await paragraphFont(page)).toBe('15px');

    await menu(page, 'zoom-in');
    await expect.poll(() => editorFont(page)).toBe('14.3px / 24px');
    await expect.poll(() => paragraphFont(page)).toBe('16.5px');
    await expect(page.getByTestId('zoom-value')).toHaveText('110%');

    await menu(page, 'zoom-out');
    await menu(page, 'zoom-out');
    await expect.poll(() => paragraphFont(page)).toBe('13.5px');
    await expect(page.getByTestId('zoom-value')).toHaveText('90%');

    await menu(page, 'zoom-reset');
    await expect.poll(() => editorFont(page)).toBe('13px / 22px');
    await expect.poll(() => paragraphFont(page)).toBe('15px');
    await expect(page.getByTestId('zoom-value')).toHaveText('100%');
  });

  test('A27 the zoom is stored in the settings', async ({ page }) => {
    await open(page);

    await menu(page, 'zoom-in');
    await menu(page, 'zoom-in');

    await expect.poll(async () => (await settings(page))?.view.zoom).toBe(1.2);
    await menu(page, 'zoom-reset');
    await expect.poll(async () => (await settings(page))?.view.zoom).toBe(1);
  });

  test('A27 the zoom slider goes from 50 to 200 percent in steps of 10', async ({ page }) => {
    await open(page);
    const slider = page.getByTestId('zoom-slider');
    await expect(slider).toHaveAttribute('min', '50');
    await expect(slider).toHaveAttribute('max', '200');
    await expect(slider).toHaveAttribute('step', '10');

    await slider.fill('150');

    await expect(page.getByTestId('zoom-value')).toHaveText('150%');
    await expect.poll(() => paragraphFont(page)).toBe('22.5px');
    await expect.poll(async () => (await settings(page))?.view.zoom).toBe(1.5);
  });

  test('A27 the zoom stops at 50 and 200 percent', async ({ page }) => {
    await open(page);
    for (let i = 0; i < 8; i++) await menu(page, 'zoom-out');
    await expect(page.getByTestId('zoom-value')).toHaveText('50%');
    for (let i = 0; i < 20; i++) await menu(page, 'zoom-in');

    await expect(page.getByTestId('zoom-value')).toHaveText('200%');
  });

  test('A27 the chrome does not scale', async ({ page }) => {
    await open(page);
    const titleBar = page.getByTestId('title-bar');
    const before = await titleBar.boundingBox();

    await menu(page, 'zoom-in');
    await expect(page.getByTestId('zoom-value')).toHaveText('110%');

    expect((await titleBar.boundingBox())?.height).toBe(before?.height);
    await expect(page.getByTestId('status-bar')).toHaveCSS('font-size', '11px');
  });

  test('A27 a zoom stored in the settings is applied at startup', async ({ page }) => {
    await open(page, { settings: { view: { zoom: 1.5 } } });

    await expect.poll(() => editorFont(page)).toBe('19.5px / 33px');
    await expect(page.getByTestId('zoom-value')).toHaveText('150%');
  });

  test('A27 a settings change from another window is followed', async ({ page }) => {
    await open(page);

    await page.evaluate(() => window.__WRITEDOWN_MOCK__?.settingsChanged({ view: { zoom: 0.5 } }));

    await expect(page.getByTestId('zoom-value')).toHaveText('50%');
    await expect.poll(() => paragraphFont(page)).toBe('7.5px');
  });
});

test.describe('A28 appearance', () => {
  const onSurface = (page: Page) =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--wd-on-surface').trim(),
    );
  const LIGHT = '#1b1b1d';
  const DARK = '#e4e2e4';

  test('A28 system appearance follows the dark media query', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page);

    expect(await onSurface(page)).toBe(DARK);
    await page.emulateMedia({ colorScheme: 'light' });
    expect(await onSurface(page)).toBe(LIGHT);
  });

  test('A28 appearance "dark" gives the dark palette in a light system', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await open(page, { settings: { appearance: 'dark' } });

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await onSurface(page)).toBe(DARK);
  });

  test('A28 appearance "light" overrides a dark system', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page, { settings: { appearance: 'light' } });

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await onSurface(page)).toBe(LIGHT);
  });

  test('A28 a change of the appearance setting is followed at once, in the editor too', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await open(page);
    const background = () =>
      page.locator('.cm-editor').evaluate((el) => getComputedStyle(el).backgroundColor);
    const light = await background();

    await page.evaluate(() => window.__WRITEDOWN_MOCK__?.settingsChanged({ appearance: 'dark' }));
    await expect.poll(() => onSurface(page)).toBe(DARK);
    await expect.poll(background).not.toBe(light);

    await page.evaluate(() => window.__WRITEDOWN_MOCK__?.settingsChanged({ appearance: 'system' }));
    await expect.poll(() => onSurface(page)).toBe(LIGHT);
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });
});

test.describe('the Markdown guide', () => {
  test('Help > Markdown Guide opens the GFM guide as an untitled document in Preview', async ({
    page,
  }) => {
    await seedMock(page, { launch: { welcome: true }, saveDialog: `${HOME}/guide-copy.md` });
    await page.goto('/');

    await menu(page, 'markdown-guide');

    await expect(page.getByTestId('document-name')).toHaveText('Markdown Guide');
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'preview');
    const firstHeading = guideText('gfm')
      .split('\n')
      .find((line) => /^# /.test(line));
    await expect(preview(page).getByRole('heading', { level: 1 }).first()).toBeVisible();
    expect(firstHeading).toBeTruthy();
    await expect(page.getByTestId('save-status')).toHaveText('Not saved');
    await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

    // Asking again activates the same tab.
    await menu(page, 'new');
    await menu(page, 'markdown-guide');
    await expect(page.getByTestId('document-name')).toHaveText('Markdown Guide');
    await expect(tabs(page)).toHaveCount(2);
  });

  test('the guide can be edited, and saving goes through Save As', async ({ page }) => {
    await seedMock(page, { launch: { welcome: true }, saveDialog: `${HOME}/guide-copy.md` });
    await page.goto('/');
    await menu(page, 'markdown-guide');
    await menu(page, 'view-split');
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('edited');
    await expect(page.getByTestId('dirty-dot')).toBeVisible();

    await menu(page, 'save');

    await expect(page.getByTestId('document-name')).toHaveText('guide-copy.md');
    const dialogs = await page.evaluate(() => window.__WRITEDOWN_MOCK__?.saveDialogs);
    expect(dialogs?.length).toBe(1);
  });
});

test.describe('settings the shell stores', () => {
  test('the sidebar and sync scroll toggles are stored and shown', async ({ page }) => {
    await open(page);
    await expect(page.getByTestId('status-sync')).toHaveText('Sync Scroll: On');

    await menu(page, 'toggle-sync-scroll');
    await expect(page.getByTestId('status-sync')).toHaveText('Sync Scroll: Off');
    await expect.poll(async () => (await settings(page))?.view.syncScroll).toBe(false);
    await expect.poll(() => menuState(page)).toMatchObject({ syncScroll: false });

    await menu(page, 'toggle-sidebar');
    await expect.poll(async () => (await settings(page))?.view.sidebarVisible).toBe(false);
    await expect.poll(() => menuState(page)).toMatchObject({ sidebarVisible: false });
    await menu(page, 'toggle-sidebar');
    await expect.poll(async () => (await settings(page))?.view.sidebarVisible).toBe(true);
  });

  test('the splitter ratio is stored in the settings', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 });
    await open(page);
    const splitter = page.getByTestId('splitter');
    const box = await splitter.boundingBox();
    if (!box) throw new Error('no splitter');
    const y = box.y + box.height / 2;

    await page.mouse.move(box.x + 3, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 3 + 150, y, { steps: 5 });
    await page.mouse.up();

    await expect.poll(async () => (await settings(page))?.view.splitRatio).toBeGreaterThan(0.55);
  });

  test('the new documents setting decides the view of New, the existing documents setting that of files', async ({
    page,
  }) => {
    await open(page, { settings: { openNewIn: 'editor', openExistingIn: 'editor' } });
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'split'); // --view wins

    await menu(page, 'new');
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'editor');
  });

  test('the menu state without a document says so', async ({ page }) => {
    await seedMock(page, { launch: { welcome: true } });
    await page.goto('/');

    await expect
      .poll(() => menuState(page))
      .toEqual({
        hasDocument: false,
        canSave: false,
        canFormat: false,
        viewMode: null,
        sidebarVisible: true,
        syncScroll: true,
        typewriter: false,
        tabCount: 0,
        hasPath: false,
        canExportDocx: false,
        canExactPreview: false,
        exactPreview: false,
        canRender: false,
      });
    await expect
      .poll(() => page.evaluate(() => window.__WRITEDOWN_MOCK__?.windowTitles.at(-1)))
      .toBe('Writedown');
  });
});
