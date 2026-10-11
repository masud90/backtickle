/**
 * Phase 4 accessibility audit: keyboard walk, accessible names and states, target
 * sizes (WCAG 2.5.8) and text spacing (WCAG 1.4.12) of the chrome. Run with WD_UI_PORT=1485.
 */
import { type Page, test } from '@playwright/test';
import { CONFIGS, type Config, expect, menu, openMain, openPrefsWith } from './support';

const LIGHT = CONFIGS[0] as Config;
const SCALED = CONFIGS[1] as Config;

/** Tab stops in order, until focus returns to where it began or the limit is hit. */
async function walk(page: Page, limit = 120) {
  const stops: Array<{ id: string; ring: boolean }> = [];
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const ring =
        (cs.outlineStyle !== 'none' && Number.parseFloat(cs.outlineWidth) > 0) ||
        (cs.boxShadow !== 'none' && cs.boxShadow !== '') ||
        el.matches('.cm-content');
      const id =
        el.getAttribute('data-testid') ??
        el.getAttribute('aria-label') ??
        (el.textContent ?? '').trim().slice(0, 30) ??
        el.tagName;
      return { id: `${el.tagName.toLowerCase()}:${id}`, ring };
    });
    if (!stop) break;
    if (stop.id.includes('Markdown source')) break;
    if (stops.length > 2 && stops[0]?.id === stop.id) break;
    stops.push(stop);
  }
  return stops;
}

test.describe('keyboard', () => {
  test('main window: every Tab stop before the editor shows a focus ring', async ({ page }) => {
    await openMain(page, LIGHT);
    await page
      .getByTestId('document-name')
      .click()
      .catch(() => {});
    const stops = await walk(page, 40);
    expect(stops.length).toBeGreaterThanOrEqual(4);
    expect(
      stops.filter((s) => !s.ring).map((s) => s.id),
      'stops without a ring',
    ).toEqual([]);
  });

  test('the status bar controls show a focus ring from the keyboard', async ({ page }) => {
    await openMain(page, LIGHT);
    for (const id of ['status-line-ending', 'zoom-slider']) {
      await page.getByTestId(id).focus();
      const ring = await page.getByTestId(id).evaluate((el) => {
        const cs = getComputedStyle(el);
        return cs.outlineStyle !== 'none' || cs.boxShadow !== 'none';
      });
      expect(ring, id).toBe(true);
    }
  });

  test('Escape, then Tab leaves the editor', async ({ page }) => {
    // Tab indents (Markdown writing); CodeMirror's tab focus mode gives the way out (WCAG 2.1.2).
    await openMain(page, LIGHT, { view: 'editor' });
    await page.locator('[data-testid="editor"] .cm-content').click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    await expect
      .poll(() =>
        page.evaluate(() => document.activeElement?.closest('[data-testid="editor"]') === null),
      )
      .toBe(true);
  });

  test('Preferences: every Tab stop shows a focus ring and Escape closes', async ({ page }) => {
    await openPrefsWith(page, LIGHT);
    const stops = await walk(page);
    expect(stops.length).toBeGreaterThanOrEqual(4);
    expect(
      stops.filter((s) => !s.ring).map((s) => s.id),
      'stops without a ring',
    ).toEqual([]);
  });

  test('Escape closes Quick Open and returns focus to the editor', async ({ page }) => {
    await openMain(page, LIGHT);
    await page.getByTestId('editor').locator('.cm-content').click();
    await menu(page, 'quick-open');
    await expect(page.getByTestId('picker')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('picker')).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => document.activeElement?.closest('[data-testid="editor"]') !== null),
      )
      .toBe(true);
  });

  test('Escape closes the title menu and returns focus to its button', async ({ page }) => {
    await openMain(page, LIGHT);
    const button = page.getByTestId('document-menu-button');
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test('the splitter resizes with arrow keys', async ({ page }) => {
    await openMain(page, LIGHT);
    const splitter = page.getByTestId('splitter');
    await splitter.focus();
    const before = await splitter.getAttribute('aria-valuenow');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => splitter.getAttribute('aria-valuenow')).not.toBe(before);
  });

  test('the sidebar edge resizes with arrow keys', async ({ page }) => {
    await openMain(page, LIGHT);
    const edge = page.getByTestId('sidebar-resize');
    await edge.focus();
    const before = await edge.getAttribute('aria-valuenow');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => edge.getAttribute('aria-valuenow')).not.toBe(before);
  });
});

test.describe('names and states', () => {
  test('every button, tab, slider and tree item of the main window has an accessible name', async ({
    page,
  }) => {
    await openMain(page, LIGHT);
    await page.getByTestId('sidebar-tab-files').click();
    const unnamed = await page.evaluate(() => {
      const bad: string[] = [];
      const sel =
        'button, [role="tab"], [role="slider"], input, [role="treeitem"], [role="switch"], [role="checkbox"], [role="menuitem"]';
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        if (el.closest('[hidden], [aria-hidden="true"]')) continue;
        const name =
          el.getAttribute('aria-label') ??
          document.getElementById(el.getAttribute('aria-labelledby') ?? '')?.textContent ??
          (el as HTMLInputElement).labels?.[0]?.textContent ??
          el.getAttribute('title') ??
          el.textContent;
        if (!name || name.trim() === '') bad.push(el.outerHTML.slice(0, 80));
      }
      return bad;
    });
    expect(unnamed).toEqual([]);
  });

  test('tabs, the view switch and the zoom slider expose their state', async ({ page }) => {
    await openMain(page, LIGHT);
    await expect(page.getByTestId('sidebar-tab-outline')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('sidebar-tab-files')).toHaveAttribute('aria-selected', 'false');
    const slider = page.getByTestId('zoom-slider');
    expect(
      await slider.evaluate(
        (el) => (el as HTMLInputElement).type === 'range' || el.getAttribute('role') === 'slider',
      ),
    ).toBe(true);
    expect(
      await slider.evaluate(
        (el) =>
          el.getAttribute('aria-label') ?? (el as HTMLInputElement).labels?.[0]?.textContent ?? '',
      ),
    ).not.toBe('');
    const pressed = await page
      .getByTestId('view-switch')
      .locator('[aria-pressed], [aria-checked], [aria-selected]')
      .count();
    expect(pressed).toBeGreaterThan(0);
  });

  test('Preferences controls have names and the categories expose the selected one', async ({
    page,
  }) => {
    await openPrefsWith(page, LIGHT);
    await page.getByTestId('category-accessibility').click();
    const unnamed = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(
        'button, input, select, [role="switch"], [role="slider"], [role="radio"]',
      )) {
        const name =
          el.getAttribute('aria-label') ??
          document.getElementById(el.getAttribute('aria-labelledby') ?? '')?.textContent ??
          (el as HTMLInputElement).labels?.[0]?.textContent ??
          el.textContent;
        if (!name || name.trim() === '') bad.push(el.outerHTML.slice(0, 80));
      }
      return bad;
    });
    expect(unnamed).toEqual([]);
    const state = await page
      .getByTestId('category-accessibility')
      .evaluate((el) => el.getAttribute('aria-current') ?? el.getAttribute('aria-selected'));
    expect(state).toBe('true');
  });
});

test.describe('target size (WCAG 2.5.8)', () => {
  for (const config of [LIGHT, SCALED]) {
    test(`main window targets are at least 24 by 24 CSS px (${config.name})`, async ({ page }) => {
      await openMain(page, config);
      await page.getByTestId('sidebar-tab-files').click();
      const small = await page.evaluate(() => {
        const out: string[] = [];
        const sel =
          'button, a[href], input, select, [role="tab"], [role="slider"], [role="treeitem"]';
        for (const el of document.querySelectorAll<HTMLElement>(sel)) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (el.closest('[data-testid="preview"]')) continue;
          if (r.width < 24 || r.height < 24) {
            const id =
              el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.tagName;
            out.push(`${id} ${Math.round(r.width)}x${Math.round(r.height)}`);
          }
        }
        return out;
      });
      expect(small).toEqual([]);
    });
  }

  test('the splitter and the sidebar edge are at least 24 CSS px wide', async ({ page }) => {
    await openMain(page, LIGHT);
    for (const id of ['splitter', 'sidebar-resize']) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box?.width ?? 0, id).toBeGreaterThanOrEqual(24);
    }
  });

  test('Preferences targets are at least 24 by 24 CSS px', async ({ page }) => {
    await openPrefsWith(page, LIGHT);
    const small = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(
        'button, input:not([type="hidden"]), select, [role="switch"], [role="radio"]',
      )) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.width < 24 || r.height < 24)
          out.push(
            `${el.getAttribute('data-testid') ?? el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`,
          );
      }
      return out;
    });
    expect(small).toEqual([]);
  });
});

test.describe('text spacing (WCAG 1.4.12)', () => {
  const SPACING = `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
p { margin-bottom: 2em !important; }`;

  /** Elements of the chrome whose text overflows their own box. */
  const overflowing = (page: Page) =>
    page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(
        '[data-testid="title-bar"] *, [data-testid="toolbar"] *, [data-testid="status-bar"] *, [data-testid="sidebar"] *, [data-testid="prefs-categories"] *',
      )) {
        const cs = getComputedStyle(el);
        if (cs.overflowX === 'visible' && cs.textOverflow !== 'ellipsis') continue;
        if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
          out.push(
            `${el.getAttribute('data-testid') ?? el.tagName} ${el.scrollWidth}>${el.clientWidth}`,
          );
        }
      }
      return out;
    });

  test('the main window chrome does not newly clip', async ({ page }) => {
    await openMain(page, LIGHT);
    const before = await overflowing(page);
    await page.addStyleTag({ content: SPACING });
    const after = await overflowing(page);
    expect(after.filter((entry) => !before.includes(entry))).toEqual([]);
  });

  test('Preferences does not newly clip', async ({ page }) => {
    await openPrefsWith(page, LIGHT);
    const before = await overflowing(page);
    await page.addStyleTag({ content: SPACING });
    const after = await overflowing(page);
    expect(after.filter((entry) => !before.includes(entry))).toEqual([]);
  });
});
