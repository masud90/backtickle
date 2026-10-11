/**
 * The navigation part of the main window: the toolbar (A11 by
 * the toolbar path, A23), the outline sidebar (A24), sync scroll (A25), the sidebar toggle and
 * width (A26), the cursor block highlight, and the pane headers. Keyboard use and axe are in
 * shell-keyboard.spec.ts.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import type { MockSeed } from '../../src/lib/platform-mock';
import { editor, fixture, HOME, menu, preview, seedMock } from './helpers';

const NOTE = `${HOME}/note.md`;
const LONG = `${HOME}/long.md`;
const OTHER = `${HOME}/other.md`;
const root = new URL('../..', import.meta.url).pathname;

const OUTLINE_LINES = [
  '# Alpha',
  'intro text',
  '',
  '## Beta',
  'beta text',
  '',
  '### Gamma',
  '```bash',
  '# not a heading',
  '```',
  '#### Delta',
  'delta text',
  '',
  '## Epsilon',
  'epsilon text',
];
const OUTLINE_DOC = `${OUTLINE_LINES.join('\n')}\n`;

/** A document with many sections, and the 0-based line of each `##` heading. */
function longDocument(sections: number): { text: string; lines: number[]; total: number } {
  const out: string[] = ['# Long document', ''];
  const lines: number[] = [];
  for (let i = 1; i <= sections; i++) {
    lines.push(out.length);
    out.push(`## Section ${i}`, '');
    for (let p = 1; p <= 5; p++) {
      out.push(`Paragraph ${p} of section ${i}. The quick brown fox jumps over the lazy dog.`, '');
    }
  }
  return { text: `${out.join('\n')}\n`, lines, total: out.length };
}

const LONG_DOC = longDocument(40);

async function open(
  page: Page,
  options: {
    files?: NonNullable<MockSeed['files']>;
    path?: string;
    view?: 'editor' | 'split' | 'preview';
    seed?: MockSeed;
  } = {},
) {
  const path = options.path ?? NOTE;
  await seedMock(page, {
    ...options.seed,
    files: {
      [NOTE]: '# Note\n\nBody text here.\n',
      [LONG]: LONG_DOC.text,
      [OTHER]: '# Other\n\n## Other child\n',
      ...options.files,
      ...options.seed?.files,
    },
    launch: { openPath: path, view: options.view ?? 'split' },
  });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');
  await expect(page.getByTestId('document-name')).toHaveText(path.split('/').pop() ?? '');
}

const settings = (page: Page) => page.evaluate(() => window.__WRITEDOWN_MOCK__?.settings);
const items = (page: Page) => page.getByTestId('outline-item');
const current = (page: Page) =>
  page.locator('[data-testid="outline-item"][aria-current="location"]');
const editorText = (page: Page) => page.getByTestId('editor').innerText();

/** How far below the top of the editor the gutter number of a line is; null when not drawn. */
const editorLineOffset = (page: Page, line: number) =>
  page.evaluate((n) => {
    const scroller = document.querySelector('.cm-scroller');
    const gutter = [...document.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].find(
      (element) => element.textContent === String(n + 1),
    );
    if (!scroller || !gutter) return null;
    return gutter.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  }, line);

/** How far below the top of the preview the heading of the block at a line is; null if absent. */
const previewHeadingOffset = (page: Page, line: number) =>
  page.evaluate((n) => {
    const scroller = document.querySelector('[data-testid="preview-scroll"]');
    const block = document.querySelector(`.wd-block[data-line="${n}"]`);
    if (!scroller || !block) return null;
    const heading = block.querySelector('h1, h2, h3, h4, h5, h6') ?? block;
    return heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  }, line);

/** Scrolls the editor, as a person would, until the line is at its top edge. */
async function scrollEditorTo(page: Page, line: number, total: number) {
  await page.evaluate(
    async ({ n, count }) => {
      const scroller = document.querySelector<HTMLElement>('.cm-scroller');
      if (!scroller) throw new Error('no editor');
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const numbers = () =>
        [...document.querySelectorAll('.cm-lineNumbers .cm-gutterElement')]
          .map((element) => ({ element, n: Number(element.textContent) }))
          // The first gutter element is a hidden spacer as wide as the largest number.
          .filter((entry) => entry.n > 0 && entry.element.getBoundingClientRect().height > 0);
      for (let i = 0; i < 60; i++) {
        const shown = numbers();
        const gutter = shown.find((entry) => entry.n === n + 1);
        if (gutter) {
          const delta =
            gutter.element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
          if (Math.abs(delta) < 2) return;
          scroller.scrollTop += delta;
        } else if (shown.length > 1) {
          // The line is not drawn: move by the number of lines still to go, at the pixels per
          // line of what is drawn.
          const first = shown[0];
          const last = shown[shown.length - 1];
          if (!first || !last) continue;
          const perLine = scroller.clientHeight / Math.max(1, last.n - first.n);
          scroller.scrollTop += (n + 1 - first.n) * perLine;
        } else {
          scroller.scrollTop = (n / count) * scroller.scrollHeight;
        }
        await frame();
        await frame();
      }
      throw new Error(`could not scroll the editor to line ${n}`);
    },
    { n: line, count: total },
  );
}

/** Scrolls the preview, as a person would, until the block of a line is at its top edge. */
async function scrollPreviewTo(page: Page, line: number) {
  await page.evaluate(async (n) => {
    const scroller = document.querySelector<HTMLElement>('[data-testid="preview-scroll"]');
    if (!scroller) throw new Error('no preview');
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    for (let i = 0; i < 20; i++) {
      const block = document.querySelector(`.wd-block[data-line="${n}"]`);
      if (!block) throw new Error(`no block at line ${n}`);
      const delta = block.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      if (Math.abs(delta) < 2) return;
      scroller.scrollTop += delta;
      await frame();
    }
  }, line);
}

const quiet = (page: Page, frames = 4) =>
  page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) await new Promise((r) => requestAnimationFrame(r));
  }, frames);

// ---- A11: formatting from the toolbar --------------------------------------------------------------

test.describe('A11 toolbar formatting', () => {
  const BUTTONS: Array<[testId: string, action: string]> = [
    ['tool-bold', 'bold'],
    ['tool-italic', 'italic'],
    ['tool-strikethrough', 'strikethrough'],
    ['tool-code', 'code'],
    ['tool-quote', 'quote'],
    ['tool-rule', 'rule'],
    ['tool-bullet-list', 'bullet-list'],
    ['tool-numbered-list', 'numbered-list'],
    ['tool-task-list', 'task-list'],
    ['tool-link', 'link'],
    ['tool-image', 'image'],
    ['tool-code-block', 'code-block'],
    ['tool-table', 'table'],
  ];

  test('A11 every toolbar button gives the text of its menu action, and one Undo takes it back', async ({
    page,
  }) => {
    await open(page);
    for (const [testId, action] of BUTTONS) {
      await editor(page).click();
      await page.keyboard.press('ControlOrMeta+A');
      const before = await editorText(page);

      await page.getByTestId(testId).click();
      await expect.poll(() => editorText(page), { message: testId }).not.toBe(before);
      const viaToolbar = await editorText(page);

      await menu(page, 'undo');
      await expect.poll(() => editorText(page), { message: `undo ${testId}` }).toBe(before);

      await menu(page, action);
      await expect.poll(() => editorText(page), { message: `menu ${action}` }).toBe(viaToolbar);
      await menu(page, 'undo');
      await expect.poll(() => editorText(page)).toBe(before);
    }
  });

  test('A11 the Heading menu sets the level of the line, as the menu actions do', async ({
    page,
  }) => {
    await open(page);
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+Home');

    await page.getByTestId('tool-heading').click();
    await expect(page.getByTestId('heading-menu')).toBeVisible();
    await page.getByRole('menuitem', { name: /^Heading 2/ }).click();
    await expect(page.getByTestId('heading-menu')).toHaveCount(0);
    await expect(editor(page)).toContainText('## Note');

    await page.getByTestId('tool-heading').click();
    await page.getByRole('menuitem', { name: /^Paragraph/ }).click();
    await expect(editor(page)).not.toContainText('## Note');
    await expect(editor(page)).toContainText('Note');
  });

  test('A11 the Heading menu closes with Escape and an outside click', async ({ page }) => {
    await open(page);
    await page.getByTestId('tool-heading').click();
    await expect(page.getByTestId('heading-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('heading-menu')).toHaveCount(0);
    await expect(page.getByTestId('tool-heading')).toBeFocused();

    await page.getByTestId('tool-heading').click();
    await expect(page.getByTestId('heading-menu')).toBeVisible();
    await page.getByTestId('preview').click();
    await expect(page.getByTestId('heading-menu')).toHaveCount(0);
  });

  test('A11 buttons have names and tooltips with the shortcut', async ({ page }) => {
    await open(page);
    await expect(page.getByTestId('tool-bold')).toHaveAttribute('aria-label', 'Bold');
    await expect(page.getByTestId('tool-bold')).toHaveAttribute('title', 'Bold (⌘B)');
    await expect(page.getByTestId('tool-strikethrough')).toHaveAttribute('title', /⇧⌘X/);
    await expect(page.getByTestId('view-preview')).toHaveAttribute('title', 'Preview (⌘3)');
    await expect(page.getByTestId('toggle-sidebar')).toHaveAttribute('title', /⌃⌘S/);
    await expect(page.getByTestId('open-preferences')).toHaveAttribute('title', 'Preferences (⌘,)');
    await expect(page.getByRole('toolbar', { name: 'Formatting and view' })).toBeVisible();
  });

  test('A11 the Preferences button asks for the Preferences window', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => window.__WRITEDOWN_MOCK__?.preferencesOpened)).toBe(0);
    await page.getByTestId('open-preferences').click();
    await expect
      .poll(() => page.evaluate(() => window.__WRITEDOWN_MOCK__?.preferencesOpened))
      .toBe(1);
  });

  test('A11 the toolbar sits above the banners', async ({ page }) => {
    await open(page, {
      path: `${HOME}/legacy.md`,
      files: {
        [`${HOME}/legacy.md`]: { text: '# Old\n', legacyEncoding: 'windows-1252' },
      },
    });
    const toolbar = await page.getByTestId('toolbar').boundingBox();
    const banner = await page.getByTestId('banner-legacy').boundingBox();
    expect(toolbar).not.toBeNull();
    expect(banner).not.toBeNull();
    if (!toolbar || !banner) return;
    expect(banner.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height - 1);
  });
});

// ---- A23: the view control ------------------------------------------------------------------------

test.describe('A23 view control', () => {
  test('A23 the segmented control reflects the view and switches it', async ({ page }) => {
    await open(page);
    const radio = (name: string) => page.getByRole('radio', { name, exact: true });
    await expect(radio('Split')).toBeChecked();

    await radio('Preview').click();
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'preview');
    await expect(radio('Preview')).toBeChecked();
    await expect(radio('Split')).not.toBeChecked();

    await radio('Editor').click();
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'editor');
    await expect(radio('Editor')).toBeChecked();

    // A menu action moves the control too.
    await menu(page, 'view-split');
    await expect(radio('Split')).toBeChecked();
  });

  test('A23 formatting is disabled in Preview, the rest of the toolbar is not', async ({
    page,
  }) => {
    await open(page, { view: 'preview' });
    for (const testId of ['tool-bold', 'tool-heading', 'tool-table', 'tool-task-list']) {
      await expect(page.getByTestId(testId)).toBeDisabled();
    }
    await expect(page.getByTestId('toggle-sidebar')).toBeEnabled();
    await expect(page.getByTestId('sync-scroll')).toBeEnabled();
    await expect(page.getByTestId('open-preferences')).toBeEnabled();

    await page.getByRole('radio', { name: 'Split', exact: true }).click();
    await expect(page.getByTestId('tool-bold')).toBeEnabled();
    await expect(page.getByTestId('tool-heading')).toBeEnabled();
  });

  test('A23 without a document the view control and formatting are disabled', async ({ page }) => {
    await seedMock(page, {});
    await page.goto('/');
    await expect(page.getByTestId('welcome')).toBeVisible();
    await expect(page.getByTestId('tool-bold')).toBeDisabled();
    await expect(page.getByTestId('view-split')).toBeDisabled();
    await expect(page.getByTestId('sync-scroll')).toBeDisabled();
    await expect(page.getByTestId('toggle-sidebar')).toBeEnabled();
  });

  test('A23 the arrow keys move through the control and choose a view', async ({ page }) => {
    await open(page);
    await page.getByRole('radio', { name: 'Split', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'preview');
    await expect(page.getByTestId('view-preview')).toBeFocused();
    await page.keyboard.press('ArrowRight'); // wraps
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'editor');
    await page.keyboard.press('End');
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'preview');
  });
});

// ---- the sync scroll pill and the pane headers -----------------------------------------------------

test.describe('sync scroll control and pane headers', () => {
  test('the pill shows the on and off states and stores the setting', async ({ page }) => {
    await open(page);
    const pill = page.getByTestId('sync-scroll');
    await expect(pill).toHaveAttribute('aria-checked', 'true');
    await expect(pill).toContainText('Sync Scroll Active');
    await expect(page.getByTestId('synced-viewport')).toBeVisible();
    await expect(page.getByTestId('status-sync')).toContainText('On');

    await pill.click();
    await expect(pill).toHaveAttribute('aria-checked', 'false');
    await expect(pill).toContainText('Sync Scroll Off');
    await expect(page.getByTestId('synced-viewport')).toHaveCount(0);
    await expect(page.getByTestId('status-sync')).toContainText('Off');
    await expect.poll(async () => (await settings(page))?.view.syncScroll).toBe(false);

    await menu(page, 'toggle-sync-scroll');
    await expect(pill).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => (await settings(page))?.view.syncScroll).toBe(true);
  });

  test('the editor header names the encoding, the font and the tab size', async ({ page }) => {
    await open(page);
    const header = page.getByTestId('editor-header');
    await expect(header).toContainText('MARKDOWN SOURCE');
    await expect(page.getByTestId('editor-encoding')).toHaveText('UTF-8');
    await expect(page.getByTestId('editor-font-info')).toContainText('Font: JetBrains Mono (13px)');
    await expect(page.getByTestId('editor-font-info')).toContainText('Tab: 2 Spaces');
    await expect(page.getByTestId('preview-header')).toContainText('LIVE PREVIEW');
  });

  test('the editor header follows the settings and the zoom', async ({ page }) => {
    await open(page, { seed: { settings: { editor: { fontSize: 15, tabSize: 4 } } } });
    await expect(page.getByTestId('editor-font-info')).toContainText('(15px)');
    await expect(page.getByTestId('editor-font-info')).toContainText('Tab: 4 Spaces');
    await menu(page, 'zoom-in');
    await expect(page.getByTestId('editor-font-info')).toContainText('(16.5px)');
  });

  test('the editor header shows the encoding of the document', async ({ page }) => {
    await open(page, {
      path: `${HOME}/bom.md`,
      files: { [`${HOME}/bom.md`]: { text: '# Bom\n', encoding: 'utf-8-bom' } },
    });
    await expect(page.getByTestId('editor-encoding')).toHaveText('UTF-8 with BOM');
  });
});

// ---- A24: the outline -----------------------------------------------------------------------------

test.describe('A24 outline', () => {
  const openOutline = (page: Page, view: 'editor' | 'split' | 'preview' = 'split') =>
    open(page, { files: { [NOTE]: OUTLINE_DOC }, view });

  test('A24 lists the headings with level badges and the section count, not # in code', async ({
    page,
  }) => {
    await openOutline(page);
    await expect(items(page)).toHaveCount(5);
    await expect(page.getByTestId('outline-count')).toHaveText('5 Sections');
    await expect(items(page)).toContainText(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon']);
    await expect(page.getByTestId('outline-list')).not.toContainText('not a heading');
    const levels = await items(page).evaluateAll((nodes) =>
      nodes.map((node) => [node.getAttribute('data-level'), node.firstElementChild?.textContent]),
    );
    expect(levels).toEqual([
      ['1', 'H1'],
      ['2', 'H2'],
      ['3', 'H3'],
      ['4', 'H4'],
      ['2', 'H2'],
    ]);
    // Indented by level.
    const pads = await items(page).evaluateAll((nodes) =>
      nodes.map((node) => Number.parseFloat(getComputedStyle(node).paddingLeft)),
    );
    expect(pads[1]).toBeGreaterThan(pads[0] ?? 0);
    expect(pads[2]).toBeGreaterThan(pads[1] ?? 0);
    expect(pads[4]).toBe(pads[1]);
    await expect(page.getByRole('navigation', { name: 'Document outline' })).toBeVisible();
  });

  test('A24 the badges use the level colors: H1 primary, H2 secondary, H3 and below neutral', async ({
    page,
  }) => {
    await openOutline(page);
    await expect(items(page)).toHaveCount(5);
    const classes = await items(page).evaluateAll((nodes) =>
      nodes.map((node) => node.firstElementChild?.className ?? ''),
    );
    expect(classes[0]).toContain('bg-primary'); // H1, and the current section (the caret is on line 1)
    expect(classes[1]).toContain('bg-secondary-fixed');
    expect(classes[2]).toContain('bg-surface-container-highest');
    expect(classes[3]).toContain('bg-surface-container-highest');
  });

  test('A24 follows the caret in the editor', async ({ page }) => {
    await openOutline(page);
    await expect(current(page)).toContainText('Alpha');

    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    for (let i = 0; i < OUTLINE_LINES.indexOf('delta text'); i++)
      await page.keyboard.press('ArrowDown');
    await expect(current(page)).toContainText('Delta');
    // The caret in the code block belongs to Gamma.
    await page.keyboard.press('ControlOrMeta+Home');
    for (let i = 0; i < OUTLINE_LINES.indexOf('# not a heading'); i++) {
      await page.keyboard.press('ArrowDown');
    }
    await expect(current(page)).toContainText('Gamma');
    await page.keyboard.press('ControlOrMeta+End');
    await expect(current(page)).toContainText('Epsilon');
  });

  test('A24 follows what is at the top of the preview in Preview view', async ({ page }) => {
    await open(page, { path: LONG, view: 'preview' });
    await expect(items(page)).toHaveCount(41);
    await expect(current(page)).toContainText('Long document');

    await scrollPreviewTo(page, LONG_DOC.lines[19] as number);
    await expect(current(page)).toContainText('Section 20');
    await scrollPreviewTo(page, LONG_DOC.lines[3] as number);
    await expect(current(page)).toContainText('Section 4');
  });

  test('A24 a click scrolls both panes to the heading and puts the caret there', async ({
    page,
  }) => {
    await open(page, { path: LONG });
    await expect(items(page)).toHaveCount(41);
    const line = LONG_DOC.lines[24] as number;

    await items(page).filter({ hasText: 'Section 25' }).click();

    await expect
      .poll(async () => Math.abs((await previewHeadingOffset(page, line)) ?? 999))
      .toBeLessThanOrEqual(24);
    await expect
      .poll(async () => Math.abs((await editorLineOffset(page, line)) ?? 999))
      .toBeLessThanOrEqual(24);
    await expect(page.getByTestId('status-position')).toHaveText(`Ln ${line + 1}, Col 1`);
    await expect(current(page)).toContainText('Section 25');
  });

  test('A24 a click scrolls both panes with sync scroll off too', async ({ page }) => {
    await open(page, { path: LONG });
    await page.getByTestId('sync-scroll').click();
    await expect(page.getByTestId('sync-scroll')).toHaveAttribute('aria-checked', 'false');
    const line = LONG_DOC.lines[30] as number;

    await items(page).filter({ hasText: 'Section 31' }).click();

    await expect
      .poll(async () => Math.abs((await previewHeadingOffset(page, line)) ?? 999))
      .toBeLessThanOrEqual(24);
    await expect
      .poll(async () => Math.abs((await editorLineOffset(page, line)) ?? 999))
      .toBeLessThanOrEqual(24);
  });

  test('A24 a click in Preview view scrolls the preview, and the editor is there later', async ({
    page,
  }) => {
    await open(page, { path: LONG, view: 'preview' });
    const line = LONG_DOC.lines[14] as number;
    await items(page).filter({ hasText: 'Section 15' }).click();
    await expect
      .poll(async () => Math.abs((await previewHeadingOffset(page, line)) ?? 999))
      .toBeLessThanOrEqual(24);
    await expect(current(page)).toContainText('Section 15');

    await menu(page, 'view-editor');
    await expect
      .poll(async () => Math.abs((await editorLineOffset(page, line)) ?? 999))
      .toBeLessThanOrEqual(24);
  });

  test('A24 the depth filter hides the deeper levels', async ({ page }) => {
    await openOutline(page);
    const depth = (name: string) => page.getByRole('radio', { name, exact: true });
    await expect(depth('All')).toBeChecked();

    await depth('2').click();
    await expect(items(page)).toContainText(['Alpha', 'Beta', 'Epsilon']);
    await expect(items(page)).toHaveCount(3);
    await expect(page.getByTestId('outline-count')).toHaveText('3 of 5 Sections');

    await depth('1').click();
    await expect(items(page)).toHaveCount(1);

    await depth('3').click();
    await expect(items(page)).toHaveCount(4);

    await depth('All').click();
    await expect(items(page)).toHaveCount(5);
    await expect(page.getByTestId('outline-count')).toHaveText('5 Sections');
  });

  test('A24 with the filter on, a hidden section is shown by its parent', async ({ page }) => {
    await openOutline(page);
    await page.getByRole('radio', { name: '2', exact: true }).click();
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    for (let i = 0; i < OUTLINE_LINES.indexOf('delta text'); i++)
      await page.keyboard.press('ArrowDown');
    await expect(current(page)).toContainText('Beta'); // Delta is hidden; Beta is the shown parent
  });

  test('A24 the outline follows edits, and a tab switch', async ({ page }) => {
    await openOutline(page);
    await expect(items(page)).toHaveCount(5);

    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('\n## Zeta\n');
    await expect(items(page)).toHaveCount(6);
    await expect(items(page).last()).toContainText('Zeta');
    await expect(page.getByTestId('outline-count')).toHaveText('6 Sections');

    await menu(page, 'new');
    await expect(page.getByTestId('outline-empty')).toBeVisible();
    await page.getByTestId('tab-strip').getByRole('tab', { name: 'note.md' }).click();
    await expect(items(page)).toHaveCount(6);
  });

  test('A24 the outline of another document replaces it on a tab switch', async ({ page }) => {
    await open(page, { files: { [NOTE]: OUTLINE_DOC }, seed: { openDialog: [OTHER] } });
    await expect(items(page)).toHaveCount(5);
    await menu(page, 'open');
    await expect(items(page)).toHaveCount(2);
    await expect(items(page).first()).toContainText('Other');
    await page.getByTestId('tab-strip').getByRole('tab', { name: 'note.md' }).click();
    await expect(items(page)).toHaveCount(5);
  });

  test('A24 the empty states: no document, and no headings', async ({ page }) => {
    await seedMock(page, {});
    await page.goto('/');
    await expect(page.getByTestId('outline-no-document')).toContainText('No Active Document');
    await page.getByTestId('outline-open-guide').click();
    await expect(page.getByTestId('document-name')).toHaveText('Markdown Guide');
    await expect(items(page).first()).toBeVisible();

    await menu(page, 'new');
    await expect(page.getByTestId('outline-empty')).toBeVisible();
  });
});

// ---- A25: sync scroll -----------------------------------------------------------------------------

test.describe('A25 sync scroll', () => {
  test('A25 scrolling the editor to a heading brings that heading to the top of the preview', async ({
    page,
  }) => {
    await open(page, { path: LONG });
    await expect(items(page)).toHaveCount(41);
    for (const index of [9, 24, 38]) {
      const line = LONG_DOC.lines[index] as number;
      await quiet(page, 20);
      await scrollEditorTo(page, line, LONG_DOC.total);
      await expect
        .poll(async () => Math.abs((await previewHeadingOffset(page, line)) ?? 999), {
          message: `Section ${index + 1}`,
        })
        .toBeLessThanOrEqual(24);
    }
  });

  test('A25 scrolling the preview to a heading brings its line to the top of the editor', async ({
    page,
  }) => {
    await open(page, { path: LONG });
    await expect(items(page)).toHaveCount(41);
    for (const index of [30, 12, 36]) {
      const line = LONG_DOC.lines[index] as number;
      await quiet(page, 20);
      await scrollPreviewTo(page, line);
      await expect
        .poll(async () => Math.abs((await editorLineOffset(page, line)) ?? 999), {
          message: `Section ${index + 1}`,
        })
        .toBeLessThanOrEqual(24);
    }
  });

  test('A25 the two panes reach the end together', async ({ page }) => {
    await open(page, { path: LONG });
    await expect(items(page)).toHaveCount(41);
    await page.getByTestId('preview-scroll').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const sc = document.querySelector('.cm-scroller');
          return sc ? sc.scrollHeight - sc.clientHeight - sc.scrollTop : 999;
        }),
      )
      .toBeLessThanOrEqual(2);
  });

  test('A25 with sync off neither pane follows the other', async ({ page }) => {
    await open(page, { path: LONG });
    await expect(items(page)).toHaveCount(41);
    await page.getByTestId('sync-scroll').click();
    await expect(page.getByTestId('sync-scroll')).toHaveAttribute('aria-checked', 'false');

    const line = LONG_DOC.lines[20] as number;
    await scrollEditorTo(page, line, LONG_DOC.total);
    await quiet(page);
    expect(await page.getByTestId('preview-scroll').evaluate((el) => el.scrollTop)).toBe(0);

    await scrollPreviewTo(page, LONG_DOC.lines[35] as number);
    await quiet(page);
    expect(Math.abs((await editorLineOffset(page, line)) ?? 999)).toBeLessThanOrEqual(24);
  });

  test('A25 turning sync on brings the preview to the editor', async ({ page }) => {
    await open(page, { path: LONG });
    await expect(items(page)).toHaveCount(41);
    await page.getByTestId('sync-scroll').click();
    const line = LONG_DOC.lines[18] as number;
    await scrollEditorTo(page, line, LONG_DOC.total);
    await quiet(page);

    await page.getByTestId('sync-scroll').click();
    await expect
      .poll(async () => Math.abs((await previewHeadingOffset(page, line)) ?? 999))
      .toBeLessThanOrEqual(24);
  });

  test('A25 does not feed back: after a follow both panes stay where they are', async ({
    page,
  }) => {
    await open(page, { path: LONG });
    await expect(items(page)).toHaveCount(41);
    const line = LONG_DOC.lines[22] as number;
    await scrollEditorTo(page, line, LONG_DOC.total);
    await expect
      .poll(async () => Math.abs((await previewHeadingOffset(page, line)) ?? 999))
      .toBeLessThanOrEqual(24);

    const positions = () =>
      page.evaluate(() => [
        document.querySelector('.cm-scroller')?.scrollTop ?? -1,
        document.querySelector('[data-testid="preview-scroll"]')?.scrollTop ?? -1,
      ]);
    const first = await positions();
    await quiet(page, 20);
    expect(await positions()).toEqual(first);
  });

  for (const [size, label] of [
    ['100k', '100 KiB'],
    ['1m', '1 MiB (large document mode, far blocks are estimates)'],
  ] as const) {
    test(`A25 works on the ${label} generated document`, async ({ page }) => {
      test.setTimeout(180_000);
      execFileSync(process.execPath, ['scripts/gen-large-doc.mjs', '--size', size], {
        cwd: root,
        stdio: 'pipe',
      });
      const text = readFileSync(`${root}tests/fixtures/generated/large-${size}.md`, 'utf8');
      const lines = text.split('\n');
      const headings: number[] = [];
      let fenced = false;
      lines.forEach((source, index) => {
        if (source.startsWith('```')) fenced = !fenced;
        if (!fenced && /^## /.test(source)) headings.push(index);
      });
      expect(headings.length).toBeGreaterThan(20);
      await open(page, { path: LONG, files: { [LONG]: text } });
      await expect(items(page).first()).toBeVisible();

      for (const index of [
        Math.floor(headings.length / 3),
        Math.floor((headings.length * 5) / 6),
      ]) {
        const line = headings[index] as number;
        await quiet(page, 20);
        await scrollEditorTo(page, line, lines.length);
        await expect
          .poll(async () => Math.abs((await previewHeadingOffset(page, line)) ?? 999), {
            message: `editor to preview, heading ${index}`,
          })
          .toBeLessThanOrEqual(24);
      }
      for (const index of [Math.floor(headings.length / 2), Math.floor(headings.length / 5)]) {
        const line = headings[index] as number;
        await quiet(page, 20); // the pane that led has been quiet for longer than the follow window
        await scrollPreviewTo(page, line);
        await expect
          .poll(async () => Math.abs((await editorLineOffset(page, line)) ?? 999), {
            message: `preview to editor, heading ${index}`,
          })
          .toBeLessThanOrEqual(24);
      }
    });
  }
});

// ---- the cursor block ------------------------------------------------------------------------------

test.describe('cursor block highlight', () => {
  const marked = (page: Page) => preview(page).locator('.is-cursor-block');

  test('the block under the caret is marked in Split view, whichever way the caret moves', async ({
    page,
  }) => {
    await open(page, { files: { [NOTE]: OUTLINE_DOC } });
    await expect(marked(page)).toHaveCount(1);
    await expect(marked(page)).toContainText('Alpha');

    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    for (let i = 0; i < OUTLINE_LINES.indexOf('beta text'); i++)
      await page.keyboard.press('ArrowDown');
    await expect(marked(page)).toHaveCount(1);
    await expect(marked(page)).toContainText('beta text');
  });

  test('the mark is cleared in Preview view and comes back in Editor and Split', async ({
    page,
  }) => {
    await open(page, { files: { [NOTE]: OUTLINE_DOC } });
    await expect(marked(page)).toHaveCount(1);
    await menu(page, 'view-preview');
    await expect(marked(page)).toHaveCount(0);
    await menu(page, 'view-split');
    await expect(marked(page)).toHaveCount(1);
  });

  test('the mark works with sync scroll off', async ({ page }) => {
    await open(page, { files: { [NOTE]: OUTLINE_DOC } });
    await page.getByTestId('sync-scroll').click();
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('ArrowUp'); // the last line of the file is empty
    await expect(marked(page)).toContainText('epsilon text');
  });

  test('the frontmatter block never shows it', async ({ page }) => {
    await open(page, { files: { [NOTE]: fixture('wireframe-sample.md') } });
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    const frontmatterBlock = preview(page).locator('.wd-block:has(> header.wd-frontmatter)');
    await expect(frontmatterBlock).toHaveClass(/is-cursor-block/);
    const bgColor = await frontmatterBlock.evaluate(
      (el) => window.getComputedStyle(el).backgroundColor,
    );
    const boxShadow = await frontmatterBlock.evaluate(
      (el) => window.getComputedStyle(el).boxShadow,
    );
    expect(bgColor).toBe('rgba(0, 0, 0, 0)');
    expect(boxShadow).toBe('none');
  });
});

// ---- A26: the sidebar -----------------------------------------------------------------------------

test.describe('A26 sidebar', () => {
  test('A26 the menu action and the toolbar button toggle the sidebar and store it', async ({
    page,
  }) => {
    await open(page);
    await expect(page.getByTestId('sidebar')).toBeVisible();

    await menu(page, 'toggle-sidebar');
    await expect(page.getByTestId('sidebar')).toHaveCount(0);
    await expect.poll(async () => (await settings(page))?.view.sidebarVisible).toBe(false);
    await expect(page.getByTestId('toggle-sidebar')).toHaveAttribute('aria-pressed', 'false');

    await page.getByTestId('toggle-sidebar').click();
    await expect(page.getByTestId('sidebar')).toBeVisible();
    await expect.poll(async () => (await settings(page))?.view.sidebarVisible).toBe(true);
    await expect(page.getByTestId('toggle-sidebar')).toHaveAttribute('aria-pressed', 'true');
  });

  test('A26 a hidden sidebar stays hidden from the stored setting, on the welcome screen too', async ({
    page,
  }) => {
    await seedMock(page, { settings: { view: { sidebarVisible: false } } });
    await page.goto('/');
    await expect(page.getByTestId('welcome')).toBeVisible();
    await expect(page.getByTestId('sidebar')).toHaveCount(0);
  });

  test('A26 dragging the handle resizes the sidebar between 180 and 480 px and stores the width', async ({
    page,
  }) => {
    await open(page);
    const sidebar = page.getByTestId('sidebar');
    const width = async () => (await sidebar.boundingBox())?.width ?? 0;
    expect(await width()).toBe(240);

    const handle = await page.getByTestId('sidebar-resize').boundingBox();
    expect(handle).not.toBeNull();
    if (!handle) return;
    const y = handle.y + handle.height / 2;
    const x = handle.x + handle.width / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 100, y, { steps: 5 });
    await expect.poll(width).toBeGreaterThan(330);
    await page.mouse.move(x + 900, y, { steps: 5 });
    await expect.poll(width).toBe(480);
    await page.mouse.move(x - 400, y, { steps: 5 });
    await expect.poll(width).toBe(180);
    await page.mouse.move(x + 60, y, { steps: 5 });
    await page.mouse.up();

    const final = await width();
    expect(final).toBeGreaterThan(280);
    expect(final).toBeLessThan(320);
    await expect
      .poll(async () => (await settings(page))?.view.sidebarWidth)
      .toBe(Math.round(final));
  });

  test('A26 the arrow keys resize the handle, Enter resets, and a double click resets', async ({
    page,
  }) => {
    await open(page);
    const handle = page.getByTestId('sidebar-resize');
    const width = async () => (await page.getByTestId('sidebar').boundingBox())?.width ?? 0;
    await handle.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect.poll(width).toBe(272);
    await expect(handle).toHaveAttribute('aria-valuenow', '272');
    await expect.poll(async () => (await settings(page))?.view.sidebarWidth).toBe(272);
    await page.keyboard.press('Enter');
    await expect.poll(width).toBe(240);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(width).toBe(224);
    await handle.dblclick();
    await expect.poll(width).toBe(240);
  });

  test('A26 the stored width is used at the start, within the limits', async ({ page }) => {
    await open(page, { seed: { settings: { view: { sidebarWidth: 360 } } } });
    expect((await page.getByTestId('sidebar').boundingBox())?.width).toBe(360);
  });
});
