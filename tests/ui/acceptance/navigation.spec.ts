/**
 * Acceptance cases A23 to A28: views, outline, sync scroll,
 * sidebar, zoom and appearance.
 */
import { type Page, test } from '@playwright/test';
import {
  editorText,
  expect,
  launch,
  menu,
  mockRead,
  openFiles,
  previewReady,
  setSelection,
  settingsOf,
  TEST_TIMEOUT,
} from './support';

test.setTimeout(TEST_TIMEOUT);

const DOCS = '/Users/mock/docs';

const SECTIONS: Array<[number, string]> = [
  [1, 'Alpha'],
  [2, 'Beta'],
  [3, 'Gamma'],
  [2, 'Delta'],
  [1, 'Epsilon'],
];

/** Five headings of levels 1, 2, 3, 2, 1 with long bodies; `#` lines inside code are not headings. */
function longDoc(): string {
  const lines: string[] = [];
  for (const [level, title] of SECTIONS) {
    lines.push(`${'#'.repeat(level)} ${title}`, '');
    for (let i = 1; i <= 25; i++) {
      lines.push(`Paragraph ${i} of ${title}. Some words to fill the line.`, '');
    }
    if (title === 'Beta') {
      lines.push('```bash', '# not a heading (fenced)', '```', '');
      lines.push('~~~', '## also not a heading (tilde fence)', '~~~', '');
      lines.push('    # not a heading (indented code)', '');
    }
  }
  return `${lines.join('\n')}\n`;
}

const lineOfHeading = (doc: string, title: string) =>
  doc.split('\n').findIndex((line) => new RegExp(`^#{1,6} ${title}$`).test(line));

const tabNamed = (page: Page, name: string) =>
  page.getByTestId('tab-strip').getByRole('tab', { name: new RegExp(name.replace(/\./g, '\\.')) });

// ---- A23 ---------------------------------------------------------------------------------------

test('A23 Views switch through menu actions; the toolbar reflects them; formatting is disabled in Preview; the view is kept per tab', async ({
  page,
}) => {
  const a = `${DOCS}/a.md`;
  const b = `${DOCS}/b.md`;
  await launch(page, { seed: { files: { [a]: '# A\n\nalpha\n', [b]: '# B\n\nbeta\n' } } });
  await openFiles(page, [a, b]);
  await expect(page.getByTestId('tab')).toHaveCount(2);
  const radio = (mode: string) => page.getByTestId(`view-${mode}`);
  const editorPane = page.locator('section[aria-label="Markdown source"]');
  const previewPane = page.locator('section[aria-label="Preview"]');

  // Both open in Preview: formatting is off, the editor pane is hidden.
  await expect(radio('preview')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('tool-bold')).toBeDisabled();
  await expect(editorPane).toBeHidden();
  await expect(previewPane).toBeVisible();

  // Tab b: Editor.
  await menu(page, 'view-editor');
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'editor');
  await expect(radio('editor')).toHaveAttribute('aria-checked', 'true');
  await expect(radio('preview')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('tool-bold')).toBeEnabled();
  await expect(editorPane).toBeVisible();
  await expect(previewPane).toBeHidden();
  const states = await mockRead<Array<{ viewMode: string | null; canFormat: boolean }>>(
    page,
    'menuStates',
  );
  expect(states.at(-1)).toMatchObject({ viewMode: 'editor', canFormat: true });

  // Tab a: Split (through the toolbar control).
  await tabNamed(page, 'a.md').click();
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'preview');
  await radio('split').click();
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'split');
  await expect(editorPane).toBeVisible();
  await expect(previewPane).toBeVisible();
  await expect(page.getByTestId('splitter')).toBeVisible();

  // The view is kept per tab.
  await tabNamed(page, 'b.md').click();
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'editor');
  await expect(radio('editor')).toHaveAttribute('aria-checked', 'true');
  await tabNamed(page, 'a.md').click();
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'split');
  await expect(radio('split')).toHaveAttribute('aria-checked', 'true');

  // Back to Preview: formatting is disabled and the menu state says so.
  await menu(page, 'view-preview');
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'preview');
  await expect(page.getByTestId('tool-bold')).toBeDisabled();
  await expect(page.getByTestId('tool-table')).toBeDisabled();
  await expect(page.getByTestId('tool-heading')).toBeDisabled();
  await expect
    .poll(
      async () =>
        (await mockRead<Array<{ canFormat: boolean }>>(page, 'menuStates')).at(-1)?.canFormat,
    )
    .toBe(false);
  const before = await editorText(page);
  await menu(page, 'bold');
  expect(await editorText(page)).toBe(before);
});

// ---- A24 ---------------------------------------------------------------------------------------

test('A24 Outline lists headings with badges and a section count, ignores # in code, follows the cursor, scrolls both panes on click, and filters by depth', async ({
  page,
}) => {
  const doc = longDoc();
  const path = `${DOCS}/long.md`;
  await launch(page, { seed: { files: { [path]: doc } }, open: path, view: 'split' });
  await previewReady(page);
  const items = page.getByTestId('outline-item');
  await expect(items).toHaveCount(5);
  await expect(items).toHaveText([/Alpha/, /Beta/, /Gamma/, /Delta/, /Epsilon/]);
  // Level badges H1, H2, H3 in order.
  const badges = await items.evaluateAll((els) =>
    els.map((el) => ({
      level: el.getAttribute('data-level'),
      badge: el.querySelector('span')?.textContent?.trim(),
    })),
  );
  expect(badges).toEqual([
    { level: '1', badge: 'H1' },
    { level: '2', badge: 'H2' },
    { level: '3', badge: 'H3' },
    { level: '2', badge: 'H2' },
    { level: '1', badge: 'H1' },
  ]);
  // Deeper levels are indented further.
  const padding = await items.evaluateAll((els) =>
    els.map((el) => Number.parseFloat(getComputedStyle(el).paddingLeft)),
  );
  expect(padding[1]).toBeGreaterThan(padding[0] as number);
  expect(padding[2]).toBeGreaterThan(padding[1] as number);
  expect(padding[3]).toBe(padding[1]);
  expect(padding[4]).toBe(padding[0]);
  // The section count shows the number of sections.
  await expect(page.getByTestId('outline-count')).toContainText('5');

  // The current section follows the cursor.
  const current = page.locator('[data-testid="outline-item"][aria-current="location"]');
  await setSelection(page, doc.indexOf('Paragraph 3 of Gamma'));
  await expect(current).toHaveCount(1);
  await expect(current).toContainText('Gamma');
  await setSelection(page, doc.indexOf('Paragraph 3 of Delta'));
  await expect(current).toContainText('Delta');
  await setSelection(page, doc.indexOf('Paragraph 2 of Alpha'));
  await expect(current).toContainText('Alpha');

  // A click scrolls both panes to the heading and puts the cursor there.
  const deltaLine = lineOfHeading(doc, 'Delta');
  await items.filter({ hasText: 'Delta' }).click();
  await expect(page.getByTestId('status-position')).toHaveText(`Ln ${deltaLine + 1}, Col 1`);
  const scroller = page.getByTestId('preview-scroll');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const h = document.querySelector('[data-testid="preview"] h2#delta') as HTMLElement;
        const s = document.querySelector('[data-testid="preview-scroll"]') as HTMLElement;
        return Math.round(h.getBoundingClientRect().top - s.getBoundingClientRect().top);
      }),
    )
    .toBeLessThanOrEqual(48);
  expect(
    await page.evaluate(() => {
      const h = document.querySelector('[data-testid="preview"] h2#delta') as HTMLElement;
      const s = document.querySelector('[data-testid="preview-scroll"]') as HTMLElement;
      return h.getBoundingClientRect().top - s.getBoundingClientRect().top;
    }),
  ).toBeGreaterThanOrEqual(-4);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  // The editor is scrolled too: the heading line is within the first lines of the viewport.
  await expect
    .poll(() =>
      page.evaluate((line) => {
        const content = document.querySelector(
          '[data-testid="editor"] .cm-content',
        ) as HTMLElement & {
          cmTile?: {
            view?: {
              state: { doc: { line(n: number): { from: number } } };
              lineBlockAt(p: number): { top: number };
              scrollDOM: HTMLElement;
            };
          };
        };
        const view = content.cmTile?.view;
        if (!view) return Number.NaN;
        return view.lineBlockAt(view.state.doc.line(line + 1).from).top - view.scrollDOM.scrollTop;
      }, deltaLine),
    )
    .toBeLessThanOrEqual(48);

  // The depth filter hides deeper levels.
  const depth = page.getByTestId('outline-depth');
  await depth.getByRole('radio', { name: '1' }).click();
  await expect(items).toHaveText([/Alpha/, /Epsilon/]);
  await depth.getByRole('radio', { name: '2' }).click();
  await expect(items).toHaveText([/Alpha/, /Beta/, /Delta/, /Epsilon/]);
  await depth.getByRole('radio', { name: '3' }).click();
  await expect(items).toHaveCount(5);
  await depth.getByRole('radio', { name: '1' }).click();
  await depth.getByRole('radio', { name: 'All' }).click();
  await expect(items).toHaveCount(5);
});

test('A24 In Preview the current section follows the scroll position', async ({ page }) => {
  const doc = longDoc();
  const path = `${DOCS}/long-preview.md`;
  await launch(page, { seed: { files: { [path]: doc } }, open: path, view: 'preview' });
  await previewReady(page);
  const current = page.locator('[data-testid="outline-item"][aria-current="location"]');
  await expect(current).toContainText('Alpha');
  await page.evaluate(() => {
    const h = document.querySelector('[data-testid="preview"] h2#delta') as HTMLElement;
    const s = document.querySelector('[data-testid="preview-scroll"]') as HTMLElement;
    s.scrollTop += h.getBoundingClientRect().top - s.getBoundingClientRect().top + 8;
  });
  await expect(current).toContainText('Delta');
});

// ---- A25 ---------------------------------------------------------------------------------------

/** Scrolls the editor so the heading line is at the top of the viewport. */
async function scrollEditorTo(page: Page, line: number) {
  await page.evaluate(async (n) => {
    const content = document.querySelector('[data-testid="editor"] .cm-content') as HTMLElement & {
      cmTile?: {
        view?: {
          state: { doc: { line(n: number): { from: number } } };
          lineBlockAt(p: number): { top: number };
          scrollDOM: HTMLElement;
        };
      };
    };
    const view = content.cmTile?.view;
    if (!view) throw new Error('no editor view');
    // CodeMirror estimates the height of lines it has not drawn, so the line moves once the
    // viewport is measured: scroll again until the line sits at the top of the viewport.
    for (let i = 0; i < 8; i++) {
      const top = view.lineBlockAt(view.state.doc.line(n + 1).from).top;
      if (Math.abs(top - view.scrollDOM.scrollTop) <= 1) break;
      view.scrollDOM.scrollTop = top;
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    }
  }, line);
}

const previewOffsetOf = (page: Page, id: string) =>
  page.evaluate((target) => {
    const h = document.querySelector(`[data-testid="preview"] #${target}`) as HTMLElement;
    const s = document.querySelector('[data-testid="preview-scroll"]') as HTMLElement;
    return h.getBoundingClientRect().top - s.getBoundingClientRect().top;
  }, id);

const editorOffsetOf = (page: Page, line: number) =>
  page.evaluate((n) => {
    const content = document.querySelector('[data-testid="editor"] .cm-content') as HTMLElement & {
      cmTile?: {
        view?: {
          state: { doc: { line(n: number): { from: number } } };
          lineBlockAt(p: number): { top: number };
          scrollDOM: HTMLElement;
        };
      };
    };
    const view = content.cmTile?.view;
    if (!view) return Number.NaN;
    return view.lineBlockAt(view.state.doc.line(n + 1).from).top - view.scrollDOM.scrollTop;
  }, line);

test('A25 Sync scroll: the editor leads the preview and the reverse; turning it off stops it', async ({
  page,
}) => {
  const doc = longDoc();
  const path = `${DOCS}/sync.md`;
  await launch(page, { seed: { files: { [path]: doc } }, open: path, view: 'split' });
  await previewReady(page);
  await expect(page.getByTestId('status-sync')).toHaveText(/Sync Scroll: On/);
  await expect(page.getByTestId('synced-viewport')).toBeVisible();
  const scroller = page.getByTestId('preview-scroll');
  const editorPane = page.locator('[data-testid="editor"]');

  // Editor to the Delta heading: the preview heading is within 24 px of its top.
  const deltaLine = lineOfHeading(doc, 'Delta');
  await editorPane.hover();
  await scrollEditorTo(page, deltaLine);
  await expect
    .poll(async () => Math.abs(await previewOffsetOf(page, 'delta')))
    .toBeLessThanOrEqual(24);

  // Preview to the Epsilon heading: the editor line is within 24 px of its top.
  const epsilonLine = lineOfHeading(doc, 'Epsilon');
  // A scroll of the other pane right after a follow is taken for its echo: let the follow settle.
  await page.waitForTimeout(800);
  await scroller.hover();
  await page.evaluate(() => {
    const h = document.querySelector('[data-testid="preview"] #epsilon') as HTMLElement;
    const s = document.querySelector('[data-testid="preview-scroll"]') as HTMLElement;
    s.scrollTop += h.getBoundingClientRect().top - s.getBoundingClientRect().top;
  });
  await expect
    .poll(async () => Math.abs(await editorOffsetOf(page, epsilonLine)))
    .toBeLessThanOrEqual(24);

  // Back to the top through the editor, so the next move is a visible change.
  await page.waitForTimeout(800);
  await editorPane.hover();
  await scrollEditorTo(page, 0);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeLessThan(24);

  // Turn it off: the status bar, the pill and the pane header say so, and scrolling stays local.
  await menu(page, 'toggle-sync-scroll');
  await expect(page.getByTestId('status-sync')).toHaveText(/Sync Scroll: Off/);
  await expect(page.getByTestId('sync-scroll')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('synced-viewport')).toHaveCount(0);
  await expect.poll(async () => (await settingsOf(page)).view.syncScroll).toBe(false);
  const previewTop = await scroller.evaluate((el) => el.scrollTop);
  await scrollEditorTo(page, deltaLine);
  await expect.poll(() => editorOffsetOf(page, deltaLine)).toBeLessThanOrEqual(2);
  // Let the scroll event, the animation frames and the 100 ms follow window of a leading pane pass.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 250))),
      ),
  );
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(previewTop);

  // The outline still scrolls both panes with sync off.
  await page.getByTestId('outline-item').filter({ hasText: 'Epsilon' }).click();
  await expect
    .poll(async () => Math.abs(await previewOffsetOf(page, 'epsilon')))
    .toBeLessThanOrEqual(48);
});

// ---- A26 ---------------------------------------------------------------------------------------

test('A26 The sidebar toggles with the menu action and its width persists through updateSettings', async ({
  page,
}) => {
  const path = `${DOCS}/side.md`;
  await launch(page, {
    seed: { files: { [path]: '# One\n\ntext\n\n## Two\n' } },
    open: path,
    view: 'split',
  });
  const sidebar = page.getByTestId('sidebar');
  await expect(sidebar).toBeVisible();
  await expect(page.getByTestId('toggle-sidebar')).toHaveAttribute('aria-pressed', 'true');
  expect((await sidebar.boundingBox())?.width).toBeCloseTo(240, 0);

  await menu(page, 'toggle-sidebar');
  await expect(sidebar).toHaveCount(0);
  await expect(page.getByTestId('toggle-sidebar')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await settingsOf(page)).view.sidebarVisible).toBe(false);
  const states = await mockRead<Array<{ sidebarVisible: boolean }>>(page, 'menuStates');
  expect(states.at(-1)?.sidebarVisible).toBe(false);
  await menu(page, 'toggle-sidebar');
  await expect(sidebar).toBeVisible();
  await expect.poll(async () => (await settingsOf(page)).view.sidebarVisible).toBe(true);
  // The toolbar button does the same.
  await page.getByTestId('toggle-sidebar').click();
  await expect(sidebar).toHaveCount(0);
  await page.getByTestId('toggle-sidebar').click();
  await expect(sidebar).toBeVisible();

  // Drag the resize handle: the width follows and is stored.
  const dragBy = async (dx: number) => {
    const handle = await page.getByTestId('sidebar-resize').boundingBox();
    if (!handle) throw new Error('no handle');
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y, { steps: 4 });
    await page.mouse.move(x + dx, y, { steps: 4 });
    await page.mouse.up();
  };
  await dragBy(100);
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBeGreaterThan(330);
  await expect.poll(async () => (await settingsOf(page)).view.sidebarWidth).toBeGreaterThan(330);
  const stored = (await settingsOf(page)).view.sidebarWidth;
  expect(stored).toBeLessThanOrEqual(350);
  // The range is 180 to 480.
  await dragBy(600);
  await expect.poll(async () => (await settingsOf(page)).view.sidebarWidth).toBe(480);
  await dragBy(-700);
  await expect.poll(async () => (await settingsOf(page)).view.sidebarWidth).toBe(180);
  // The stored width is used when the sidebar comes back.
  await menu(page, 'toggle-sidebar');
  await menu(page, 'toggle-sidebar');
  await expect(sidebar).toBeVisible();
  expect((await sidebar.boundingBox())?.width).toBeCloseTo(180, 0);
});

// ---- A27 ---------------------------------------------------------------------------------------

const fontSizes = (page: Page) =>
  page.evaluate(() => {
    const px = (el: Element | null) =>
      el ? Number.parseFloat(getComputedStyle(el).fontSize) : Number.NaN;
    return {
      editor: px(document.querySelector('[data-testid="editor"] .cm-content')),
      preview: px(document.querySelector('[data-testid="preview"] p')),
      status: px(document.querySelector('[data-testid="status-position"]')),
      title: px(document.querySelector('[data-testid="document-name"] span:nth-child(2)')),
      toolbar: px(document.querySelector('[data-testid="tool-heading"]')),
    };
  });

test('A27 Zoom in, out and reset change editor and preview text, not the chrome, and persist', async ({
  page,
}) => {
  const path = `${DOCS}/zoom.md`;
  await launch(page, {
    seed: { files: { [path]: '# Zoom\n\nA paragraph of text.\n' } },
    open: path,
    view: 'split',
  });
  await previewReady(page);
  await expect(page.getByTestId('zoom-value')).toHaveText('100%');
  const base = await fontSizes(page);
  expect(base.editor).toBeCloseTo(13, 1); // 13 px editor font from the spec
  expect(base.preview).toBeGreaterThan(10);

  const expectZoom = async (factor: number, label: string) => {
    await expect
      .poll(async () => (await fontSizes(page)).editor, { message: `${label}: editor` })
      .toBeCloseTo(base.editor * factor, 0);
    const now = await fontSizes(page);
    expect(now.preview, `${label}: preview`).toBeCloseTo(base.preview * factor, 0);
    // The chrome does not scale.
    expect(now.status, `${label}: status bar`).toBe(base.status);
    expect(now.toolbar, `${label}: toolbar`).toBe(base.toolbar);
    expect(now.title, `${label}: title bar`).toBe(base.title);
  };

  await menu(page, 'zoom-in');
  await expect.poll(async () => (await settingsOf(page)).view.zoom).toBeCloseTo(1.1, 5);
  await expect(page.getByTestId('zoom-value')).toHaveText('110%');
  await expect(page.getByTestId('zoom-slider')).toHaveValue('110');
  await expectZoom(1.1, 'zoom in');

  await menu(page, 'zoom-out');
  await menu(page, 'zoom-out');
  await expect.poll(async () => (await settingsOf(page)).view.zoom).toBeCloseTo(0.9, 5);
  await expect(page.getByTestId('zoom-value')).toHaveText('90%');
  await expectZoom(0.9, 'zoom out');

  await menu(page, 'zoom-reset');
  await expect.poll(async () => (await settingsOf(page)).view.zoom).toBe(1);
  await expect(page.getByTestId('zoom-value')).toHaveText('100%');
  await expectZoom(1, 'reset');

  // The slider spans 50 to 200 in steps of 10.
  const slider = page.getByTestId('zoom-slider');
  await expect(slider).toHaveAttribute('min', '50');
  await expect(slider).toHaveAttribute('max', '200');
  await expect(slider).toHaveAttribute('step', '10');
  await slider.fill('150');
  await expect.poll(async () => (await settingsOf(page)).view.zoom).toBeCloseTo(1.5, 5);
  await expect(page.getByTestId('zoom-value')).toHaveText('150%');
  await expectZoom(1.5, 'slider 150');
});

// ---- A28 ---------------------------------------------------------------------------------------

/** Luminance (0 dark, 1 light) of the window background and of the text color. */
const palette = (page: Page) =>
  page.evaluate(() => {
    const luminance = (css: string) => {
      const m = /rgba?\(([^)]+)\)/.exec(css);
      const parts = (m?.[1] ?? '0,0,0').split(/[ ,/]+/).map(Number);
      const [r, g, b] = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0].map((v) => v / 255);
      return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
    };
    const root = document.querySelector('#app > div') as HTMLElement;
    const style = getComputedStyle(root);
    return {
      background: luminance(style.backgroundColor),
      text: luminance(style.color),
      theme: document.documentElement.getAttribute('data-theme'),
    };
  });

const expectDark = async (page: Page, label: string) => {
  await expect
    .poll(async () => (await palette(page)).background, { message: `${label}: background` })
    .toBeLessThan(0.3);
  expect((await palette(page)).text, `${label}: text`).toBeGreaterThan(0.6);
};
const expectLight = async (page: Page, label: string) => {
  await expect
    .poll(async () => (await palette(page)).background, { message: `${label}: background` })
    .toBeGreaterThan(0.7);
  expect((await palette(page)).text, `${label}: text`).toBeLessThan(0.4);
};

test('A28 Appearance: system follows the macOS setting live; dark and light override it', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await launch(page, { seed: { settings: { appearance: 'system' } } });
  await expectDark(page, 'system with dark media');

  // System follows the media query live.
  await page.emulateMedia({ colorScheme: 'light' });
  await expectLight(page, 'system after switching to light media');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectDark(page, 'system after switching back to dark media');

  // appearance light overrides dark media.
  await page.evaluate(() =>
    (
      window as unknown as { __BACKTICKLE_MOCK__: { settingsChanged(p: unknown): void } }
    ).__BACKTICKLE_MOCK__.settingsChanged({
      appearance: 'light',
    }),
  );
  await expectLight(page, 'appearance light with dark media');
  expect((await palette(page)).theme).toBe('light');

  // appearance dark gives the dark palette with light media.
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() =>
    (
      window as unknown as { __BACKTICKLE_MOCK__: { settingsChanged(p: unknown): void } }
    ).__BACKTICKLE_MOCK__.settingsChanged({
      appearance: 'dark',
    }),
  );
  await expectDark(page, 'appearance dark with light media');
  expect((await palette(page)).theme).toBe('dark');
});

test('A28 Stored appearance settings apply at launch', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await launch(page, { seed: { settings: { appearance: 'dark' } } });
  await expectDark(page, 'launch with appearance dark and light media');
  await expect(page.getByTestId('welcome')).toBeVisible();
});

test('A28 The document views use the dark palette too', async ({ page }) => {
  const path = `${DOCS}/theme.md`;
  await launch(page, {
    seed: { settings: { appearance: 'dark' }, files: { [path]: '# Theme\n\nText with `code`.\n' } },
    open: path,
    view: 'split',
  });
  await previewReady(page);
  await expectDark(page, 'document with appearance dark');
  const surfaces = await page.evaluate(() => {
    const lum = (css: string) => {
      const m = /rgba?\(([^)]+)\)/.exec(css);
      const p = (m?.[1] ?? '0,0,0').split(/[ ,/]+/).map(Number);
      return (0.2126 * (p[0] ?? 0) + 0.7152 * (p[1] ?? 0) + 0.0722 * (p[2] ?? 0)) / 255;
    };
    const bg = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement;
      return lum(getComputedStyle(el).backgroundColor);
    };
    return {
      previewPane: bg('section[aria-label="Preview"]'),
      editorPane: bg('section[aria-label="Markdown source"]'),
      statusBar: bg('[data-testid="status-bar"]'),
    };
  });
  expect(surfaces.previewPane).toBeLessThan(0.3);
  expect(surfaces.editorPane).toBeLessThan(0.3);
  expect(surfaces.statusBar).toBeLessThan(0.3);
});
