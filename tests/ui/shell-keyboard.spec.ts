/**
 * Keyboard use and accessibility of the main window. Playwright's WebKit, like Safari, skips buttons with a plain Tab; the tests press
 * Option+Tab, which stops on every control (the same stops as the macOS "Keyboard navigation"
 * setting turned on). A real Tab on the real app is a manual check.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import type { MockSeed } from '../../src/lib/platform-mock';
import { editor, HOME, menu, preview, seedMock } from './helpers';

/**
 * Safari and WebKit skip buttons with Tab unless "Keyboard navigation" is on; Option+Tab is the
 * opposite, which gives the same stops as the macOS setting turned on.
 */
const NEXT = 'Alt+Tab';
const PREVIOUS = 'Shift+Alt+Tab';

const NOTE = `${HOME}/note.md`;
const OTHER = `${HOME}/other.md`;
const DOC = '# Alpha\n\nintro\n\n## Beta\n\nbeta text\n\n### Gamma\n\ngamma text\n';

async function open(page: Page, seed: MockSeed = {}, view: 'split' | 'preview' = 'split') {
  await seedMock(page, {
    ...seed,
    files: { [NOTE]: DOC, [OTHER]: '# Other\n', ...seed.files },
    launch: { openPath: NOTE, view },
  });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');
  await expect(page.getByTestId('document-name')).toHaveText('note.md');
  await expect(page.getByTestId('outline-item').first()).toBeVisible();
}

const focusedId = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);

/** Tabs forward until the element with this test id has the focus. */
async function tabTo(page: Page, testId: string, max = 80) {
  for (let i = 0; i < max; i++) {
    if ((await focusedId(page)) === testId) return;
    await page.keyboard.press(NEXT);
  }
  throw new Error(`Tab never reached ${testId}; the focus is on ${await focusedId(page)}`);
}

/** The test ids of every element that Tab reaches, from the start of the page. */
async function tabStops(page: Page, presses: number): Promise<string[]> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const seen: string[] = [];
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press(NEXT);
    const id = await focusedId(page);
    if (id && !seen.includes(id)) seen.push(id);
  }
  return seen;
}

const outlineOf = (page: Page) => page.getByTestId('outline-item');

test.describe('A29 keyboard', () => {
  test('A29 the welcome screen: every control is a tab stop and Return works', async ({ page }) => {
    await seedMock(page, { recents: [NOTE], files: { [NOTE]: DOC } });
    await page.goto('/');
    await expect(page.getByTestId('welcome')).toBeVisible();

    const stops = await tabStops(page, 45);
    for (const id of [
      'new-button',
      'flavor-pill',
      'toggle-sidebar',
      'open-preferences',
      'outline-open-guide',
      'sidebar-resize',
      'welcome-new',
      'welcome-open',
    ]) {
      expect(stops, `Tab reaches ${id}`).toContain(id);
    }
    expect(stops.some((id) => id.startsWith('recent-'))).toBe(true);

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await tabTo(page, 'welcome-new');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('document-name')).toHaveText('Untitled');
  });

  test('A29 the welcome screen: Space on the sidebar guide link opens the guide', async ({
    page,
  }) => {
    await seedMock(page, {});
    await page.goto('/');
    await expect(page.getByTestId('welcome')).toBeVisible();
    await tabTo(page, 'outline-open-guide');
    await page.keyboard.press('Space');
    await expect(page.getByTestId('document-name')).toHaveText('Markdown Guide');
  });

  test('A29 focus is visible on the toolbar, the outline and the welcome buttons', async ({
    page,
  }) => {
    await open(page);
    for (const id of [
      'toggle-sidebar',
      'tool-italic',
      'tool-heading',
      'view-split',
      'sync-scroll',
      'open-preferences',
      'outline-item',
      'outline-depth-0',
      'new-button',
      'flavor-pill',
    ]) {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await tabTo(page, id);
      const ring = await page.evaluate(() => {
        const style = getComputedStyle(document.activeElement as Element);
        return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
      });
      expect(ring.style, `${id} outline style`).not.toBe('none');
      expect(ring.width, `${id} outline width`).toBeGreaterThan(0);
    }
  });

  test('A29 toolbar buttons work with Return and Space', async ({ page }) => {
    await open(page);
    const selectFirstLine = async () => {
      await editor(page).click();
      await page.keyboard.press('ControlOrMeta+Home');
      await page.keyboard.press('Shift+End');
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    };
    await selectFirstLine();
    await tabTo(page, 'tool-bold');
    await page.keyboard.press('Enter');
    await expect(editor(page)).toContainText('# **Alpha**');
    await menu(page, 'undo');
    await expect(editor(page)).not.toContainText('# **Alpha**');

    await selectFirstLine();
    await tabTo(page, 'tool-italic');
    await page.keyboard.press('Space');
    await expect(editor(page)).toContainText('# *Alpha*');
  });

  test('A29 the Sync Scroll pill and the sidebar button work with the keyboard', async ({
    page,
  }) => {
    await open(page);
    await tabTo(page, 'sync-scroll');
    await page.keyboard.press('Space');
    await expect(page.getByTestId('sync-scroll')).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('sync-scroll')).toHaveAttribute('aria-checked', 'true');

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await tabTo(page, 'toggle-sidebar');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('sidebar')).toHaveCount(0);
    await expect(page.getByTestId('toggle-sidebar')).toBeFocused();
  });

  test('A29 the Heading menu: Return opens it, the arrows move, Return chooses, Escape closes', async ({
    page,
  }) => {
    await open(page);
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    await tabTo(page, 'tool-heading');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('heading-menu')).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /^Paragraph/ })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: /^Heading 2/ })).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByRole('menuitem', { name: /^Heading 6/ })).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('heading-menu')).toHaveCount(0);
    await expect(editor(page)).toContainText('## Alpha');

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await tabTo(page, 'tool-heading');
    await page.keyboard.press('Space');
    await expect(page.getByTestId('heading-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('heading-menu')).toHaveCount(0);
    await expect(page.getByTestId('tool-heading')).toBeFocused();
  });

  test('A29 the segmented control is one tab stop with arrow keys', async ({ page }) => {
    await open(page);
    const stops = await tabStops(page, 45);
    expect(stops.filter((id) => id.startsWith('view-'))).toEqual(['view-split']);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await tabTo(page, 'view-split');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'editor');
    await expect(page.getByTestId('view-editor')).toBeFocused();
    // Tab leaves the control; the editor view is the stop that comes back.
    await page.keyboard.press(NEXT);
    expect(await focusedId(page)).toBe('sync-scroll');
  });

  test('A29 the outline: one tab stop, arrows move, Return opens, depth filter by keys', async ({
    page,
  }) => {
    await open(page);
    const stops = await tabStops(page, 60);
    expect(stops.filter((id) => id === 'outline-item')).toHaveLength(1);
    expect(stops.filter((id) => id.startsWith('outline-depth-'))).toEqual(['outline-depth-0']);

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await tabTo(page, 'outline-item');
    await expect(outlineOf(page).first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(outlineOf(page).nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(outlineOf(page).last()).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('status-position')).toHaveText('Ln 5, Col 1');
    await expect(page.locator('[aria-current="location"]')).toContainText('Beta');

    // The roving stop follows the focus: Tab away and back returns to the same item.
    await outlineOf(page).nth(2).focus();
    await page.keyboard.press(NEXT);
    await page.keyboard.press(PREVIOUS);
    await expect(outlineOf(page).nth(2)).toBeFocused();

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await tabTo(page, 'outline-depth-0');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('outline-depth-1')).toBeFocused();
    await expect(page.getByTestId('outline-depth-1')).toBeChecked();
    await expect(outlineOf(page)).toHaveCount(1);
    await page.keyboard.press('ArrowLeft');
    await expect(outlineOf(page)).toHaveCount(3);
  });

  test('A29 the flavor menu opens with Return and closes with Escape', async ({ page }) => {
    await open(page);
    await tabTo(page, 'flavor-pill');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('flavor-menu')).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('flavor-menu')).toHaveCount(0);
    await expect(page.getByTestId('flavor-pill')).toBeFocused();
    await expect(page.getByTestId('status-flavor')).not.toHaveText('GFM');
  });

  test('A29 tabs: the arrow keys move between and open the tabs, Return on close closes', async ({
    page,
  }) => {
    await open(page, { openDialog: [OTHER] });
    await menu(page, 'open');
    await expect(page.getByTestId('tab-strip').getByRole('tab')).toHaveText([
      'note.md',
      'other.md',
    ]);
    await expect(page.getByTestId('document-name')).toHaveText('other.md');

    await tabTo(page, 'tab');
    await expect(
      page.getByTestId('tab-strip').getByRole('tab', { name: 'other.md' }),
    ).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('document-name')).toHaveText('note.md');
    await expect(page.getByTestId('tab-strip').getByRole('tab', { name: 'note.md' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByTestId('document-name')).toHaveText('other.md');

    await page.keyboard.press(NEXT);
    expect(await focusedId(page)).toBe('tab-close');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('tab-strip').getByRole('tab')).toHaveCount(0);
  });

  test('A29 there is no positive tabindex, and the landmarks have names', async ({ page }) => {
    await open(page);
    const positive = await page.evaluate(() =>
      [...document.querySelectorAll('[tabindex]')]
        .filter((el) => Number(el.getAttribute('tabindex')) > 0)
        .map((el) => el.outerHTML.slice(0, 80)),
    );
    expect(positive).toEqual([]);

    await expect(page.getByRole('toolbar', { name: 'Formatting and view' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Document outline' })).toBeVisible();
    await expect(
      page.getByRole('list').filter({ has: page.getByTestId('outline-item') }),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'Markdown source' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Preview' })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'View' })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Depth' })).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('A29 Space on a focused task box in the preview still toggles it', async ({ page }) => {
    await open(page, { files: { [NOTE]: '# Tasks\n\n- [ ] one\n' } }, 'split');
    await preview(page).locator('.task-checkbox').focus();
    await page.keyboard.press('Space');
    await expect(editor(page)).toContainText('- [x] one');
  });
});

// ---- A30: axe ------------------------------------------------------------------------------------------

async function seriousFindings(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => `${node.target.join(' ')} :: ${node.failureSummary}`),
    }));
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`A30 axe, ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test(`A30 the welcome screen has no serious or critical finding (${scheme})`, async ({
      page,
    }) => {
      await seedMock(page, { recents: [NOTE], files: { [NOTE]: DOC } });
      await page.setViewportSize({ width: 1280, height: 820 });
      await page.goto('/');
      await expect(page.getByTestId('welcome')).toBeVisible();
      await expect(page.getByTestId('recent-item')).toBeVisible();
      expect(await seriousFindings(page)).toEqual([]);
    });

    test(`A30 the split view with the GFM guide has no serious or critical finding (${scheme})`, async ({
      page,
    }) => {
      await seedMock(page, {});
      await page.setViewportSize({ width: 1280, height: 820 });
      await page.goto('/');
      await expect(page.getByTestId('welcome')).toBeVisible();
      await menu(page, 'markdown-guide');
      await expect(page.getByTestId('document-name')).toHaveText('Markdown Guide');
      await menu(page, 'view-split');
      await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'split');
      await expect(page.getByTestId('outline-item').first()).toBeVisible();
      await expect(preview(page).locator('.code-card-actions button').first()).toBeVisible();
      await expect(preview(page).locator('math').first()).toBeAttached();
      expect(await seriousFindings(page)).toEqual([]);
    });

    test(`A30 the split view with the find bar open has no serious or critical finding (${scheme})`, async ({
      page,
    }) => {
      await seedMock(page, {});
      await page.setViewportSize({ width: 1280, height: 820 });
      await page.goto('/');
      await expect(page.getByTestId('welcome')).toBeVisible();
      await menu(page, 'markdown-guide');
      await menu(page, 'view-split');
      await expect(page.getByTestId('outline-item').first()).toBeVisible();
      await menu(page, 'find');
      await expect(page.locator('.cm-search')).toBeVisible();
      expect(await seriousFindings(page)).toEqual([]);
    });

    test(`A30 the heading menu and the flavor menu are clean too (${scheme})`, async ({ page }) => {
      await open(page);
      await page.getByTestId('tool-heading').click();
      await expect(page.getByTestId('heading-menu')).toBeVisible();
      expect(await seriousFindings(page)).toEqual([]);
      await page.keyboard.press('Escape');
      await page.getByTestId('flavor-pill').click();
      await expect(page.getByTestId('flavor-menu')).toBeVisible();
      expect(await seriousFindings(page)).toEqual([]);
    });
  });
}
