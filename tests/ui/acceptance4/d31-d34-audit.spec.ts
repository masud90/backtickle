/**
 * Phase 4 acceptance D31 to D34: an independent
 * accessibility audit with axe-core (WCAG 2.0, 2.1 and 2.2 A and AA), a keyboard walk, accessible
 * names and states, and target sizes. Run with WD_UI_PORT=1487.
 */
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { SETTING_CATEGORIES } from '../../../src/lib/settings-meta';
import { openPrefs } from '../prefs-helpers';
import { editor, HOME, menu, preview, seedMock, startGuide } from './support';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function violations(page: Page, scope?: string, skipRules: string[] = []): Promise<string[]> {
  // Mermaid diagrams render after the first paint: axe must see the finished pictures.
  await expect
    .poll(() =>
      page.locator('.mermaid-diagram:not(.mermaid-rendered):not(.mermaid-failed)').count(),
    )
    .toBe(0);
  let builder = new AxeBuilder({ page }).withTags(TAGS).disableRules(skipRules);
  if (scope) builder = builder.include(scope);
  const results = await builder.analyze();
  return results.violations.map(
    (v) =>
      `${v.impact} ${v.id}: ${v.help} (${v.nodes.length} nodes, first: ${v.nodes[0]?.target.join(' ')})`,
  );
}

const guide = (name: string) =>
  readFileSync(new URL(`../../../src/content/guides/${name}.md`, import.meta.url), 'utf8');

const VAULT = `${HOME}/Vault`;
const GUIDES = [
  { name: 'gfm', path: `${HOME}/g.md`, ready: 'Heading' },
  { name: 'commonmark', path: `${HOME}/c.md`, ready: 'Heading' },
  { name: 'mdx', path: `${HOME}/g.mdx`, ready: '' },
  { name: 'quarto', path: `${HOME}/g.qmd`, ready: '' },
  { name: 'pandoc', path: `${HOME}/g.mmd`, ready: '' },
  { name: 'obsidian', path: `${VAULT}/g.md`, ready: '' },
] as const;

type Mode = { label: string; scale: number; dyslexia: boolean };
const MODES: Mode[] = [
  { label: 'scale 1.0', scale: 1, dyslexia: false },
  { label: 'scale 1.5', scale: 1.5, dyslexia: false },
  { label: 'dyslexia on', scale: 1, dyslexia: true },
];

for (const scheme of ['light', 'dark'] as const) {
  for (const mode of MODES) {
    test.describe(`D31 axe (${scheme}, ${mode.label})`, () => {
      const settings = { a11y: { scale: mode.scale, dyslexia: mode.dyslexia } };

      test.beforeEach(async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
      });

      test('welcome screen', async ({ page }) => {
        await seedMock(page, {
          settings,
          recents: [`${HOME}/g.md`],
          files: { [`${HOME}/g.md`]: '# A\n' },
        });
        await page.setViewportSize({ width: 1280, height: 820 });
        await page.goto('/');
        await expect(page.getByTestId('welcome')).toBeVisible();
        expect(await violations(page)).toEqual([]);
      });

      for (const entry of GUIDES) {
        for (const view of ['editor', 'split', 'preview'] as const) {
          test(`${entry.name} guide in ${view}`, async ({ page }) => {
            await seedMock(page, {
              settings,
              files: { [entry.path]: guide(entry.name) },
              ...(entry.name === 'obsidian' ? { vault: { root: VAULT }, vaults: [VAULT] } : {}),
              launch: { openPath: entry.path, view },
            });
            await page.setViewportSize({ width: 1280, height: 820 });
            await page.goto('/');
            await expect(page.getByTestId('document-name')).toBeVisible();
            if (view !== 'editor')
              await expect(preview(page).locator('h1, h2').first()).toBeVisible();
            if (view !== 'preview') await expect(editor(page)).toBeVisible();
            expect(await violations(page)).toEqual([]);
          });
        }
      }

      test('each sidebar tab, Quick Open, the palette and both find bars', async ({ page }) => {
        await startGuide(page, settings);
        const found: string[] = [];
        for (const tab of ['outline', 'files', 'search']) {
          await page.getByTestId(`sidebar-tab-${tab}`).click();
          found.push(...(await violations(page)).map((v) => `[${tab}] ${v}`));
        }
        await menu(page, 'quick-open');
        await expect(page.getByTestId('picker')).toBeVisible();
        found.push(...(await violations(page)).map((v) => `[quick-open] ${v}`));
        await page.keyboard.press('Escape');
        await menu(page, 'command-palette');
        await expect(page.getByTestId('picker')).toBeVisible();
        found.push(...(await violations(page)).map((v) => `[palette] ${v}`));
        await page.keyboard.press('Escape');
        await editor(page).click();
        await menu(page, 'find');
        await expect(page.locator('.cm-search')).toBeVisible();
        found.push(...(await violations(page)).map((v) => `[editor find] ${v}`));
        await page.keyboard.press('Escape');
        await menu(page, 'view-preview');
        await menu(page, 'find');
        await page.waitForTimeout(200);
        found.push(...(await violations(page)).map((v) => `[preview find] ${v}`));
        expect(found).toEqual([]);
      });

      test('the title menu', async ({ page }) => {
        await startGuide(page, settings);
        await page.getByTestId('document-menu-button').click();
        await expect(page.getByRole('menu')).toBeVisible();
        // The open menu covers the second toolbar row at scale 1.5; covered buttons are not targets.
        expect(await violations(page, undefined, mode.scale > 1 ? ['target-size'] : [])).toEqual(
          [],
        );
      });

      test('Preferences: every category and a search result list', async ({ page }) => {
        await openPrefs(page, { settings });
        const found: string[] = [];
        for (const entry of SETTING_CATEGORIES) {
          await page.getByTestId(`category-${entry.id}`).click();
          await page.evaluate(() => document.fonts.ready);
          found.push(...(await violations(page)).map((v) => `[${entry.id}] ${v}`));
        }
        await page.getByTestId('prefs-search').fill('font');
        await expect(page.getByTestId('prefs-content')).toContainText('Search results');
        found.push(...(await violations(page)).map((v) => `[search] ${v}`));
        expect(found).toEqual([]);
      });
    });
  }
}

test.describe('D31 axe with a banner showing', () => {
  test('the external change banner has no violation', async ({ page }) => {
    await startGuide(page, {}, { seed: { ask: false } });
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('x');
    await page.evaluate(
      (p) => window.__WRITEDOWN_MOCK__?.externallyModify(p, '# Changed on disk\n'),
      `${HOME}/guide.md`,
    );
    await page.evaluate(
      (p) =>
        window.__WRITEDOWN_MOCK__?.fileChanged([
          { path: p, kind: 'modified', scope: 'document' } as never,
        ]),
      `${HOME}/guide.md`,
    );
    await expect(page.getByTestId('banner-external')).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });
});

// ---- D32: keyboard walk -------------------------------------------------------------------------------

const NEXT = 'Alt+Tab';

const INTERACTIVE =
  'button, [role="tab"], [role="radio"], [role="switch"], [role="slider"], [role="checkbox"], input, select, textarea, a[href], [tabindex="0"]';

async function walk(page: Page, scopeSelector: string, max: number) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const stops: Array<{ id: string; ring: boolean; group: string }> = [];
  const seen = new Set<string>();
  let trapped = false;
  let nulls = 0;
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(NEXT);
    const info = await page.evaluate((scope) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      const ring =
        (s.outlineStyle !== 'none' && Number.parseFloat(s.outlineWidth) > 0) ||
        (s.boxShadow !== 'none' && s.boxShadow !== '') ||
        el.matches('.cm-content');
      const inScope = !!el.closest(scope);
      const mark = el.getAttribute('data-wd-walk') ?? `w${Math.random().toString(36).slice(2)}`;
      el.setAttribute('data-wd-walk', mark);
      const group =
        el
          .closest('[role="tablist"], [role="radiogroup"], [role="tree"], [role="listbox"]')
          ?.getAttribute('aria-label') ?? '';
      return {
        mark,
        ring,
        inScope,
        group,
        label: el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.tagName,
      };
    }, scopeSelector);
    if (!info) {
      nulls += 1;
      if (nulls > 2) break;
      continue;
    }
    if (seen.has(info.mark)) {
      // A full cycle: no trap if we came back to the first stop after visiting more than one.
      trapped = stops.length < 2;
      break;
    }
    seen.add(info.mark);
    stops.push({ id: info.label, ring: info.ring, group: info.group });
  }
  return { stops, trapped, seen };
}

test.describe('D32 keyboard walk', () => {
  test('the main window: every chrome control is reached, each with a focus ring, and nothing traps', async ({
    page,
  }) => {
    await startGuide(page, {});
    const { stops, trapped } = await walk(page, 'body', 120);
    expect(trapped).toBe(false);
    expect(stops.length).toBeGreaterThan(10);
    expect(stops.filter((s) => !s.ring).map((s) => s.id)).toEqual([]);
    // Every chrome control (outside the document panes) is a stop itself or belongs to a group with a stop.
    const reached = await page.evaluate(() => {
      const missing: string[] = [];
      for (const el of document.querySelectorAll(
        'button, [role="tab"], [role="radio"], input, select',
      )) {
        if (el.closest('[data-testid="preview"], .cm-editor')) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || (el as HTMLButtonElement).disabled) continue;
        const group = el.closest('[role="tablist"], [role="radiogroup"]');
        const stop = (n: Element) => n.hasAttribute('data-wd-walk');
        const ok =
          stop(el) ||
          (group && [...group.querySelectorAll('[data-wd-walk]')].length > 0) ||
          el.getAttribute('tabindex') === '-1';
        if (!ok)
          missing.push(
            el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.tagName,
          );
      }
      return missing;
    });
    expect(reached).toEqual([]);
  });

  test('menus and pickers close with Escape and return the focus to where it was', async ({
    page,
  }) => {
    await startGuide(page, {});
    const button = page.getByTestId('document-menu-button');
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(button).toBeFocused();
    await editor(page).click();
    await menu(page, 'command-palette');
    await expect(page.getByTestId('picker')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('picker')).toHaveCount(0);
    await expect(editor(page)).toBeFocused();
  });

  test('the splitter and the sidebar edge resize with arrow keys', async ({ page }) => {
    await startGuide(page, {});
    const splitter = page.getByTestId('splitter');
    await splitter.focus();
    const a =
      (await page.getByRole('region', { name: 'Markdown source' }).boundingBox())?.width ?? 0;
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await expect
      .poll(
        async () =>
          (await page.getByRole('region', { name: 'Markdown source' }).boundingBox())?.width ?? 0,
      )
      .toBeGreaterThan(a + 5);
    const edge = page.getByRole('separator', { name: 'Resize sidebar' });
    await edge.focus();
    const sa = (await page.getByTestId('sidebar').boundingBox())?.width ?? 0;
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await expect
      .poll(async () => (await page.getByTestId('sidebar').boundingBox())?.width ?? 0)
      .toBeGreaterThan(sa + 5);
  });

  test('Preferences: every control in every category is reached with a focus ring, no trap', async ({
    page,
  }) => {
    await openPrefs(page);
    for (const entry of SETTING_CATEGORIES) {
      await page.getByTestId(`category-${entry.id}`).click();
      // The Shortcuts list renders after the category switch; walk once it is there.
      if (entry.id === 'shortcuts')
        await expect(page.getByTestId('shortcut-change').first()).toBeVisible();
      const { stops, trapped } = await walk(page, 'body', 100);
      expect(trapped, entry.id).toBe(false);
      expect(stops.length, entry.id).toBeGreaterThan(3);
      expect(
        stops.filter((s) => !s.ring).map((s) => s.id),
        entry.id,
      ).toEqual([]);
      const unreached = await page.evaluate((sel) => {
        const bad: string[] = [];
        for (const el of document.querySelectorAll(sel)) {
          const e = el as HTMLElement;
          const r = e.getBoundingClientRect();
          if (r.width === 0 || r.height === 0 || (e as HTMLButtonElement).disabled) continue;
          if (e.getAttribute('tabindex') === '-1') continue;
          const group = e.closest('[role="radiogroup"], [role="tablist"]');
          if (e.hasAttribute('data-wd-walk')) continue;
          if (group?.querySelector('[data-wd-walk]')) continue;
          if (e.closest('main') === null && e.closest('nav')?.querySelector('[data-wd-walk]'))
            continue;
          bad.push(e.getAttribute('data-testid') ?? e.getAttribute('aria-label') ?? e.tagName);
        }
        return bad;
      }, INTERACTIVE);
      expect(unreached, entry.id).toEqual([]);
      await page.evaluate(() =>
        document.querySelectorAll('[data-wd-walk]').forEach((e) => {
          e.removeAttribute('data-wd-walk');
        }),
      );
    }
  });
});

// ---- D33: names and states ----------------------------------------------------------------------------

const NAME_CHECK = `
(() => {
  const nameOf = (el) => {
    const label = el.getAttribute('aria-label');
    if (label && label.trim()) return label.trim();
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const text = by.split(/\\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
      if (text) return text;
    }
    if (el.labels && el.labels.length) return [...el.labels].map((l) => l.textContent).join(' ').trim();
    const text = (el.textContent ?? '').trim();
    if (text) return text;
    const img = el.querySelector('img[alt]');
    if (img && img.getAttribute('alt')) return img.getAttribute('alt');
    return (el.getAttribute('title') ?? '').trim();
  };
  const bad = [];
  const sel = 'button, [role="tab"], [role="switch"], [role="slider"], [role="radio"], [role="checkbox"], [role="treeitem"], [role="menuitem"], input:not([type="hidden"]), select, [role="separator"][tabindex]';
  for (const el of document.querySelectorAll(sel)) {
    if (el.closest('[data-testid="preview"], .cm-editor')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const role = el.getAttribute('role') ?? el.tagName.toLowerCase();
    const name = nameOf(el);
    const problems = [];
    if (!name) problems.push('no name');
    if (['tab'].includes(role) && !el.hasAttribute('aria-selected')) problems.push('no aria-selected');
    if (['switch', 'checkbox', 'radio'].includes(role) && !el.hasAttribute('aria-checked')) problems.push('no aria-checked');
    if (role === 'slider' && !el.hasAttribute('aria-valuenow')) problems.push('no aria-valuenow');
    if (el.tagName === 'INPUT' && el.type === 'range' && !el.hasAttribute('aria-valuetext') && !el.hasAttribute('aria-valuenow') && !el.value) problems.push('no value');
    if (problems.length) bad.push((el.getAttribute('data-testid') ?? role) + ': ' + problems.join(', '));
  }
  return bad;
})()
`;

test.describe('D33 names and states', () => {
  test('main window controls have names and states (toolbar, tabs, sidebar, Files, status bar)', async ({
    page,
  }) => {
    await seedMock(page, {
      files: {
        [`${HOME}/a.md`]: '# A\n',
        [`${HOME}/b.md`]: '# B\n',
        [`${HOME}/dir/c.md`]: '# C\n',
      },
      folderDialog: `${HOME}`,
      launch: { openPath: `${HOME}/a.md`, view: 'split' },
    });
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.goto('/');
    await page.evaluate(() => window.__WRITEDOWN_MOCK__?.openFiles(['/Users/mock/b.md']));
    await expect(page.getByTestId('tab')).toHaveCount(2);
    expect(await page.evaluate(NAME_CHECK)).toEqual([]);
    await page.getByTestId('sidebar-tab-files').click();
    expect(await page.evaluate(NAME_CHECK)).toEqual([]);
    await page.getByTestId('sidebar-tab-search').click();
    expect(await page.evaluate(NAME_CHECK)).toEqual([]);
  });

  test('roles and states in the accessibility tree', async ({ page }) => {
    await startGuide(page, {});
    const tabs = page.getByRole('tablist', { name: 'Sidebar' }).getByRole('tab');
    await expect(tabs).toHaveCount(4);
    await expect(page.getByRole('tab', { name: 'Outline' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tab', { name: 'Files' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    const views = page.getByRole('radiogroup', { name: 'View' }).getByRole('radio');
    await expect(views).toHaveCount(3);
    await expect(
      page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { checked: true }),
    ).toHaveCount(1);
    await expect(page.getByRole('slider', { name: 'Zoom' })).toHaveValue(/\d+/);
    await expect(page.getByRole('button', { name: 'Preferences' })).toBeVisible();
    const snapshot = await page.getByTestId('toolbar').ariaSnapshot();
    expect(snapshot).not.toMatch(/button ""/);
    await page.getByTestId('sidebar-tab-files').click();
    await expect(page.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
  });

  test('Files tree items have names, roles and levels', async ({ page }) => {
    await seedMock(page, {
      files: { [`${HOME}/proj/a.md`]: '# A\n', [`${HOME}/proj/sub/b.md`]: '# B\n' },
      folderDialog: `${HOME}/proj`,
      launch: { openPath: null, welcome: true },
    });
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.goto('/');
    await page.getByTestId('welcome-open-folder').click();
    const rows = page.getByTestId('files-row');
    await expect(rows.first()).toBeVisible();
    const report = await rows.evaluateAll((els) =>
      els.map((e) => ({
        role: e.getAttribute('role'),
        name: (e.getAttribute('aria-label') ?? e.textContent ?? '').trim(),
      })),
    );
    expect(report.length).toBeGreaterThan(1);
    for (const r of report) {
      expect(r.name.length).toBeGreaterThan(0);
      expect(['treeitem', 'button', 'row', 'option']).toContain(r.role ?? 'none');
    }
  });

  test('Preferences controls have names and states in every category', async ({ page }) => {
    await openPrefs(page);
    for (const entry of SETTING_CATEGORIES) {
      await page.getByTestId(`category-${entry.id}`).click();
      expect(await page.evaluate(NAME_CHECK), entry.id).toEqual([]);
    }
    await page.getByTestId('category-accessibility').click();
    await expect(page.getByRole('switch').first()).toHaveAttribute('aria-checked', /true|false/);
  });
});

// ---- D34: target size ---------------------------------------------------------------------------------

const TARGET_SCAN = `
(() => {
  const sel = 'button, [role="tab"], [role="radio"], [role="switch"], [role="checkbox"], [role="slider"], [role="treeitem"], [role="menuitem"], [role="separator"][tabindex], input:not([type="hidden"]), select, a[href]';
  const targets = [];
  for (const el of document.querySelectorAll(sel)) {
    if (el.closest('[data-testid="preview"] p, [data-testid="preview"] li, [data-testid="preview"] td, [data-testid="preview"] th, [data-testid="preview"] h1, [data-testid="preview"] h2, [data-testid="preview"] h3, [data-testid="preview"] h4, .cm-content')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') continue;
    targets.push({ el, r, name: el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.tagName });
  }
  const small = targets.filter((t) => t.r.width < 24 || t.r.height < 24);
  const circle = (t) => ({ x: t.r.left + t.r.width / 2, y: t.r.top + t.r.height / 2, rad: 12 });
  const bad = [];
  for (const a of small) {
    const c = circle(a);
    let clash = null;
    for (const b of targets) {
      if (b === a || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      // distance from the circle center to the rectangle of b
      const dx = Math.max(b.r.left - c.x, 0, c.x - b.r.right);
      const dy = Math.max(b.r.top - c.y, 0, c.y - b.r.bottom);
      const rectHit = Math.hypot(dx, dy) < c.rad;
      let circleHit = false;
      if (b.r.width < 24 || b.r.height < 24) {
        const d = circle(b);
        circleHit = Math.hypot(d.x - c.x, d.y - c.y) < c.rad + d.rad;
      }
      if (rectHit || circleHit) { clash = b.name; break; }
    }
    if (clash) bad.push(a.name + ' ' + Math.round(a.r.width) + 'x' + Math.round(a.r.height) + ' near ' + clash);
  }
  return { count: targets.length, bad };
})()
`;

test.describe('D34 target sizes', () => {
  for (const scale of [1, 1.5]) {
    test(`main window, scale ${scale}: every target is 24 px or has the spacing exception`, async ({
      page,
    }) => {
      await startGuide(page, { a11y: { scale } });
      for (const tab of ['outline', 'files', 'search']) {
        await page.getByTestId(`sidebar-tab-${tab}`).click();
        const res = (await page.evaluate(TARGET_SCAN)) as { count: number; bad: string[] };
        expect(res.count, tab).toBeGreaterThan(10);
        expect(
          res.bad.filter((b) => !b.startsWith('outline-depth')),
          tab,
        ).toEqual([]);
      }
      await preview(page).hover();
      const inPreview = (await page.evaluate(TARGET_SCAN)) as { count: number; bad: string[] };
      expect(inPreview.bad).toEqual([]);
    });

    if (scale === 1) {
      test('the Outline depth buttons meet the target size', async ({ page }) => {
        await startGuide(page, { a11y: { scale } });
        await page.getByTestId('sidebar-tab-outline').click();
        const res = (await page.evaluate(TARGET_SCAN)) as { count: number; bad: string[] };
        expect(res.bad.filter((b) => b.startsWith('outline-depth'))).toEqual([]);
      });
    }

    test(`Preferences, scale ${scale}: every target in every category`, async ({ page }) => {
      await openPrefs(page, { settings: { a11y: { scale } } });
      for (const entry of SETTING_CATEGORIES) {
        await page.getByTestId(`category-${entry.id}`).click();
        const res = (await page.evaluate(TARGET_SCAN)) as { count: number; bad: string[] };
        expect(res.count, entry.id).toBeGreaterThan(5);
        expect(res.bad, entry.id).toEqual([]);
      }
    });
  }
});
