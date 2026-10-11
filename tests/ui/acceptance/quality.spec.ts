/**
 * Acceptance cases A29 and A30: keyboard access and axe-core.
 * macOS WebKit skips buttons with plain Tab unless keyboard navigation is on and Option+Tab
 * moves to them, so the walk uses Option+Tab and also records what plain Tab reaches.
 */
import AxeBuilder from '@axe-core/playwright';
import { type Page, test } from '@playwright/test';
import {
  editorText,
  expect,
  fixture,
  launch,
  menu,
  mockRead,
  openFiles,
  previewReady,
  setSelection,
  settingsOf,
  setView,
  TEST_TIMEOUT,
} from './support';

test.setTimeout(TEST_TIMEOUT);

const DOCS = '/Users/mock/docs';

interface Stop {
  id: string;
  visible: boolean;
}

/** Describes the focused element: its test id, else role and label, else tag. */
async function focusedStop(page: Page): Promise<Stop> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { id: 'body', visible: true };
    const id =
      el.getAttribute('data-testid') ??
      (el.classList.contains('cm-content') ? 'editor-content' : null) ??
      `${el.tagName.toLowerCase()}[${el.getAttribute('role') ?? ''}|${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 20) ?? ''}]`;
    const style = getComputedStyle(el);
    const outline = style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0;
    const shadow = style.boxShadow !== 'none';
    const editorOrScroller = el.classList.contains('cm-content');
    return { id, visible: outline || shadow || editorOrScroller };
  });
}

/** Presses a key until the focus cycles back to where it started; returns every stop in order. */
async function walk(page: Page, key: string, limit = 120): Promise<Stop[]> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  const stops: Stop[] = [];
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press(key);
    const stop = await focusedStop(page);
    if (stops.length > 0 && stop.id === stops[0]?.id) break;
    stops.push(stop);
  }
  return stops;
}

const ids = (stops: Stop[]) => stops.map((s) => s.id);

function expectReached(label: string, stops: Stop[], required: string[]) {
  const reached = new Set(ids(stops));
  const missing = required.filter((id) => !reached.has(id));
  expect(
    missing,
    `${label}: not reachable by keyboard (reached: ${[...reached].join(', ')})`,
  ).toEqual([]);
}

function expectFocusVisible(label: string, stops: Stop[]) {
  const hidden = stops.filter((s) => !s.visible).map((s) => s.id);
  expect(hidden, `${label}: focused elements with no visible focus indicator`).toEqual([]);
}

const TOOLS = [
  'tool-bold',
  'tool-italic',
  'tool-strikethrough',
  'tool-code',
  'tool-heading',
  'tool-quote',
  'tool-rule',
  'tool-bullet-list',
  'tool-numbered-list',
  'tool-task-list',
  'tool-link',
  'tool-image',
  'tool-code-block',
  'tool-table',
];

test('A29 Welcome screen: every action is reachable with the keyboard, shows focus, and works with Return or Space', async ({
  page,
}) => {
  const recent = `${DOCS}/recent.md`;
  const other = `${DOCS}/other.md`;
  await launch(page, {
    seed: {
      files: { [recent]: '# recent\n', [other]: '# other\n' },
      recents: [recent],
      openDialog: [other],
    },
  });
  const stops = await walk(page, 'Alt+Tab');
  expectReached('welcome', stops, [
    'new-button',
    'flavor-pill',
    'toggle-sidebar',
    'open-preferences',
    'outline-open-guide',
    'welcome-new',
    'welcome-open',
    'clear-history',
    'recent-item',
  ]);
  expectFocusVisible('welcome', stops);
  // Plain Tab: whatever it reaches must be a subset of the full walk.
  const plain = await walk(page, 'Tab');
  for (const stop of plain) expect(ids(stops)).toContain(stop.id);

  // Return on New Document creates a document; Space on Open File opens through the dialog.
  await page.getByTestId('welcome-open').focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('document-name')).toContainText('other.md');
  await menu(page, 'close-tab');
  await expect(page.getByTestId('welcome')).toBeVisible();
  await page.getByTestId('welcome-new').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('document-name')).toContainText('Untitled');
  await menu(page, 'close-tab');
  // A recent document opens with Return.
  // Opening other.md put it first in the recents: pick recent.md by name.
  await page.getByTestId('recent-item').filter({ hasText: 'recent.md' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('document-name')).toContainText('recent.md');
});

test('A29 Document window: toolbar, flavor menu, tabs and outline are reachable and work with the keyboard', async ({
  page,
}) => {
  const a = `${DOCS}/a.md`;
  const b = `${DOCS}/b.md`;
  await launch(page, {
    seed: { files: { [a]: '# A one\n\n## A two\n\ntext\n', [b]: '# B\n' } },
  });
  await openFiles(page, [a, b]);
  await expect(page.getByTestId('tab')).toHaveCount(2);
  await page.getByTestId('tab-strip').getByRole('tab', { name: /a\.md/ }).click();
  await setView(page, 'split');
  await previewReady(page);

  const stops = await walk(page, 'Alt+Tab');
  expectReached('document window', stops, [
    'new-button',
    'document-menu-button',
    'flavor-pill',
    'save-button',
    'tab',
    'toggle-sidebar',
    ...TOOLS,
    'view-split',
    'sync-scroll',
    'open-preferences',
    'outline-item',
    'status-line-ending',
    'zoom-slider',
    'editor-content',
  ]);
  // The depth filter, the splitter and the resize handle are reachable too.
  expect(ids(stops).some((id) => id === 'outline-depth-0' || id.startsWith('outline-depth'))).toBe(
    true,
  );
  expect(ids(stops)).toContain('splitter');
  expect(ids(stops)).toContain('sidebar-resize');
  expectFocusVisible('document window', stops);

  // Toolbar: Return and Space activate a button. The caret goes to the end first, so the empty
  // pairs land after the text and do not break the headings the outline test below relies on.
  await setSelection(page, (await editorText(page)).length);
  await page.getByTestId('tool-bold').focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => /(\*\*\*\*|____)$/.test(await editorText(page))).toBe(true);
  await page.getByTestId('tool-code').focus();
  await page.keyboard.press('Space');
  await expect.poll(async () => (await editorText(page)).includes('``')).toBe(true);

  // Flavor menu: Return opens it, arrows move, Return chooses, Escape closes.
  const pill = page.getByTestId('flavor-pill');
  await pill.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('flavor-menu')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('flavor-menu')).toHaveCount(0);
  await expect(page.getByTestId('status-flavor')).toHaveText('Obsidian');
  await pill.focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('flavor-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('flavor-menu')).toHaveCount(0);
  await expect(pill).toBeFocused();

  // Tabs: arrow keys move between and open the tabs.
  const tabA = page.getByTestId('tab-strip').getByRole('tab', { name: /a\.md/ });
  await tabA.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('tab-strip').getByRole('tab', { selected: true })).toContainText(
    'b.md',
  );
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('tab-strip').getByRole('tab', { selected: true })).toContainText(
    'a.md',
  );

  // Outline: arrows move, Return opens the section.
  const items = page.getByTestId('outline-item');
  await expect(items).toHaveCount(2);
  await items.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  const text = await editorText(page);
  const line = text.split('\n').findIndex((l) => l.startsWith('## A two'));
  await expect(page.getByTestId('status-position')).toHaveText(new RegExp(`^Ln ${line + 1}, Col `));
  await items.first().focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('status-position')).toHaveText(/^Ln \d+, Col /);

  // The depth control and the line ending work with the keyboard.
  await page.getByTestId('status-line-ending').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('status-line-ending')).toHaveText('CRLF');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('status-line-ending')).toHaveText('LF');
  await page.getByTestId('outline-depth').getByRole('radio', { name: '1' }).focus();
  await page.keyboard.press('Space');
  await expect(items).toHaveCount(1);
  expect(await mockRead<unknown[]>(page, 'saves')).toEqual([]);
});

// ---- A30 ---------------------------------------------------------------------------------------

async function seriousViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.impact} ${v.id}: ${v.help} (${v.nodes.length} nodes, first: ${v.nodes[0]?.target.join(' ')})`,
    );
}

for (const scheme of ['light', 'dark'] as const) {
  test(`A30 axe finds no serious or critical issue (${scheme}): welcome, split with the guide, and with the find bar`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const recent = `${DOCS}/recent.md`;
    await launch(page, {
      seed: { files: { [recent]: fixture('stats/english.md') }, recents: [recent] },
    });
    expect(await seriousViolations(page), 'welcome screen').toEqual([]);

    await menu(page, 'markdown-guide');
    await setView(page, 'split');
    await expect(page.locator('[data-testid="preview"] .footnotes')).toBeAttached();
    await expect(page.locator('[data-testid="preview"] math').first()).toBeAttached();
    expect(await seriousViolations(page), 'split view with the GFM guide').toEqual([]);

    await menu(page, 'find');
    await expect(page.locator('[data-testid="editor"] .cm-search')).toBeVisible();
    expect(await seriousViolations(page), 'split view with the find bar open').toEqual([]);
    expect((await settingsOf(page)).appearance).toBe('system');
  });
}
