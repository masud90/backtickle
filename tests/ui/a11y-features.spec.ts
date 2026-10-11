/**
 * Accessibility features against the mock platform:
 * dyslexia-friendly mode, reading ruler, focus-line spotlight, reduce motion, high-contrast
 * dividers and interface scale. With every setting off nothing changes (D35).
 */
import { expect, type Page, test } from '@playwright/test';
import type { MockSeed } from '../../src/lib/platform-mock';
import { editor, guideText, HOME, menu, preview, seedMock } from './helpers';

const DOC = `${HOME}/guide.md`;

type A11yPatch = Partial<{
  dyslexia: boolean;
  dyslexiaFont: 'opendyslexic' | 'atkinson' | 'lexend';
  ruler: boolean;
  rulerTint: 'yellow' | 'blue' | 'green' | 'pink';
  spotlight: boolean;
  reduceMotion: 'system' | 'on' | 'off';
  highContrast: 'system' | 'on' | 'off';
  scale: number;
}>;

async function start(
  page: Page,
  a11y: A11yPatch = {},
  extra: Partial<MockSeed> = {},
  size = { width: 1280, height: 820 },
) {
  await seedMock(page, {
    files: { [DOC]: guideText('gfm'), ...extra.files },
    ...extra,
    launch: { openPath: DOC, view: 'split', ...extra.launch },
    settings: { ...extra.settings, a11y },
  });
  await page.setViewportSize(size);
  await page.goto('/');
  if (extra.launch?.welcome) return;
  await expect(preview(page)).toContainText('Heading');
  if (extra.launch?.view !== 'preview') await expect(editor(page)).toBeVisible();
}

/** Changes settings the way the Preferences window does. */
const change = (page: Page, a11y: A11yPatch) =>
  page.evaluate((patch) => window.__WRITEDOWN_MOCK__?.settingsChanged({ a11y: patch }), a11y);

const rootAttr = (page: Page, name: string) =>
  page.evaluate((n) => document.documentElement.getAttribute(n), name);

const css = (page: Page, selector: string, property: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);

test.describe('D35 defaults change nothing', () => {
  test('no attribute and no scale on the document element', async ({ page }) => {
    await start(page);
    for (const name of [
      'data-scaled',
      'data-motion',
      'data-contrast',
      'data-dyslexia',
      'data-ruler',
    ]) {
      expect(await rootAttr(page, name)).toBeNull();
    }
    await expect(page.locator('.wd-preview-ruler')).toHaveCount(0);
    await expect(page.locator('.cm-wd-ruler')).toHaveCount(0);
    expect(await page.locator('.cm-wd-spotlight').count()).toBe(0);
    expect(await css(page, 'html', '--wd-scale')).toBe('1');
  });
});

test.describe('D23 dyslexia-friendly mode', () => {
  test('the preview takes the typeface and the 1.4.12 spacing; the editor the spacing', async ({
    page,
  }) => {
    await start(page, { dyslexia: true, dyslexiaFont: 'lexend' });
    const p = await preview(page)
      .locator('p')
      .first()
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          family: s.fontFamily,
          size: Number.parseFloat(s.fontSize),
          letter: Number.parseFloat(s.letterSpacing),
          word: Number.parseFloat(s.wordSpacing),
          line: Number.parseFloat(s.lineHeight),
          after: Number.parseFloat(s.marginBottom),
        };
      });
    expect(p.family).toContain('Lexend');
    expect(p.letter).toBeCloseTo(0.12 * p.size, 1);
    expect(p.word).toBeCloseTo(0.16 * p.size, 1);
    expect(p.line).toBeCloseTo(1.8 * p.size, 1);
    expect(p.after).toBeCloseTo(2 * p.size, 1);
    const h = await preview(page)
      .locator('h2, h3')
      .first()
      .evaluate((el) => {
        const st = getComputedStyle(el);
        return { size: Number.parseFloat(st.fontSize), line: Number.parseFloat(st.lineHeight) };
      });
    expect(h.line).toBeGreaterThanOrEqual(1.5 * h.size - 0.01);

    const cm = await page.locator('.cm-content').evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        family: s.fontFamily,
        size: Number.parseFloat(s.fontSize),
        letter: Number.parseFloat(s.letterSpacing),
        word: Number.parseFloat(s.wordSpacing),
        line: Number.parseFloat(
          getComputedStyle(el.querySelector('.cm-line') as Element).lineHeight,
        ),
      };
    });
    expect(cm.family.toLowerCase()).toContain('mono');
    expect(cm.letter).toBeCloseTo(0.12 * cm.size, 1);
    expect(cm.word).toBeCloseTo(0.16 * cm.size, 1);
    expect(cm.line).toBeGreaterThanOrEqual(1.5 * cm.size - 0.01);
  });

  test('no text is clipped in the guide document, and the typeface choice follows the setting', async ({
    page,
  }) => {
    await start(page, { dyslexia: true });
    const clipped = await preview(page).evaluate((root) => {
      const bad: string[] = [];
      for (const el of root.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote')) {
        const e = el as HTMLElement;
        if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible') {
          bad.push(`${e.tagName} ${e.textContent?.slice(0, 20)}`);
        }
      }
      return bad;
    });
    expect(clipped).toEqual([]);
    expect((await css(page, '[data-testid="preview"] p', 'font-family')).toLowerCase()).toContain(
      'opendyslexic',
    );
    await change(page, { dyslexia: false });
    await expect.poll(() => rootAttr(page, 'data-dyslexia')).toBeNull();
    expect(
      (await css(page, '[data-testid="preview"] p', 'font-family')).toLowerCase(),
    ).not.toContain('opendyslexic');
  });
});

test.describe('D24 reading ruler', () => {
  test('in the editor it follows the cursor line and replaces the current-line highlight', async ({
    page,
  }) => {
    await start(page, { ruler: true, rulerTint: 'blue' });
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    const band = page.locator('.cm-wd-ruler');
    await expect(band).toHaveCount(1);
    const first = await band.boundingBox();
    const line = await page.locator('.cm-line').first().boundingBox();
    expect(first && line && Math.abs(first.y - line.y) < 3).toBe(true);
    expect(first?.height).toBeGreaterThan(10);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect
      .poll(async () => ((await band.boundingBox())?.y ?? 0) - (first?.y ?? 0))
      .toBeGreaterThan(20);
    expect(await css(page, '.cm-activeLine', 'background-color')).toMatch(
      /rgba\(0, 0, 0, 0\)|transparent/,
    );
    const tint = await css(page, 'html', '--wd-ruler');
    expect(await band.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('');
    expect(tint.length).toBeGreaterThan(0);
  });

  test('in the preview it follows the pointer, snaps to the line and hides on leave', async ({
    page,
  }) => {
    await start(page, { ruler: true });
    const band = page.locator('.wd-preview-ruler');
    await expect(band).toBeHidden();
    const paragraph = preview(page).locator('p').first();
    const box = await paragraph.boundingBox();
    if (!box) throw new Error('no paragraph');
    await page.mouse.move(box.x + 20, box.y + 6);
    await expect(band).toBeVisible();
    const one = await band.boundingBox();
    expect(one && one.y <= box.y + 6 && one.y + one.height >= box.y + 6).toBe(true);
    await page.mouse.move(box.x + 20, box.y + box.height - 4);
    await expect
      .poll(async () => (await band.boundingBox())?.y ?? 0)
      .toBeGreaterThanOrEqual(one?.y ?? 0);
    await page.mouse.move(5, 5);
    await expect(band).toBeHidden();
    await change(page, { ruler: false });
    await expect(band).toHaveCount(0);
    await expect(page.locator('.cm-wd-ruler')).toHaveCount(0);
  });

  test('each tint is applied', async ({ page }) => {
    await start(page, { ruler: true });
    const seen = new Set<string>();
    for (const tint of ['yellow', 'blue', 'green', 'pink'] as const) {
      await change(page, { rulerTint: tint });
      await expect.poll(() => rootAttr(page, 'data-ruler-tint')).toBe(tint);
      seen.add(await css(page, 'html', '--wd-ruler'));
    }
    expect(seen.size).toBe(4);
  });
});

test.describe('D25 focus-line spotlight', () => {
  test('lines outside the cursor block are at 35% and the bright block follows the cursor', async ({
    page,
  }) => {
    await start(page, { spotlight: true });
    const opacityOf = (text: string) =>
      page
        .locator('.cm-line', { hasText: text })
        .first()
        .evaluate((el) => Number.parseFloat(getComputedStyle(el).opacity));
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    // The cursor is in the frontmatter: other blocks are dimmed.
    expect(await opacityOf('title: Markdown')).toBe(1);
    expect(await opacityOf('# Markdown Guide')).toBeCloseTo(0.35, 2);
    // A click inside a fenced code block brightens the whole block and nothing else.
    await page.locator('.cm-line', { hasText: '### Heading 3' }).first().click();
    expect(await opacityOf('# Heading 1')).toBe(1);
    expect(await opacityOf('#### Heading 4')).toBe(1);
    expect(await opacityOf('## Headings')).toBeCloseTo(0.35, 2);
    expect(await opacityOf('title: Markdown')).toBeCloseTo(0.35, 2);
    const all = await page
      .locator('.cm-line')
      .evaluateAll((els) => els.map((el) => Number.parseFloat(getComputedStyle(el).opacity)));
    expect(all.every((o) => o === 1 || Math.abs(o - 0.35) < 0.001)).toBe(true);
    await change(page, { spotlight: false });
    await expect(page.locator('.cm-wd-spotlight')).toHaveCount(0);
    expect(await opacityOf('title: Markdown')).toBe(1);
  });

  test('the preview is not dimmed', async ({ page }) => {
    await start(page, { spotlight: true }, { launch: { openPath: DOC, view: 'preview' } });
    const dimmed = await preview(page).evaluate((root) =>
      [...root.querySelectorAll('p, li, h2')].some((el) => getComputedStyle(el).opacity !== '1'),
    );
    expect(dimmed).toBe(false);
  });
});

test.describe('D26 reduce motion', () => {
  test('on: no transitions or animations, and the caret does not blink', async ({ page }) => {
    await start(page, { reduceMotion: 'on' });
    expect(await rootAttr(page, 'data-motion')).toBe('reduce');
    await editor(page).click();
    const result = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')];
      const durations = buttons.map((b) => getComputedStyle(b).transitionDuration);
      const layer = document.querySelector('.cm-cursorLayer');
      return {
        durations,
        animation: layer ? getComputedStyle(layer).animationName : 'none',
        running: document.getAnimations().length,
      };
    });
    expect(result.durations.length).toBeGreaterThan(3);
    expect(result.durations.every((d) => d.split(',').every((x) => x.trim() === '0s'))).toBe(true);
    expect(result.animation).toBe('none');
    expect(result.running).toBe(0);
  });

  test('system follows prefers-reduced-motion; off overrides it', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await start(page, { reduceMotion: 'system' });
    expect(await rootAttr(page, 'data-motion')).toBe('reduce');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(() => rootAttr(page, 'data-motion')).toBeNull();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => rootAttr(page, 'data-motion')).toBe('reduce');
    await change(page, { reduceMotion: 'off' });
    await expect.poll(() => rootAttr(page, 'data-motion')).toBeNull();
  });

  test('outline and sync scroll jumps are instant', async ({ page }) => {
    await start(page, { reduceMotion: 'on' });
    const smooth = await page.evaluate(() =>
      [...document.querySelectorAll('*')].some(
        (el) => getComputedStyle(el).scrollBehavior === 'smooth',
      ),
    );
    expect(smooth).toBe(false);
  });
});

test.describe('D27 high-contrast dividers', () => {
  const dividers = (page: Page) =>
    page.evaluate(() => {
      const out: Array<{ cls: string; width: number; color: string; side: string }> = [];
      const sides = ['Top', 'Right', 'Bottom', 'Left'] as const;
      for (const el of document.querySelectorAll('[class*="border-outline-variant"]')) {
        const s = getComputedStyle(el);
        for (const side of sides) {
          const w = Number.parseFloat(s.getPropertyValue(`border-${side.toLowerCase()}-width`));
          if (w > 0) {
            out.push({
              cls: el.getAttribute('data-testid') ?? el.tagName,
              width: w,
              color: s.getPropertyValue(`border-${side.toLowerCase()}-color`),
              side,
            });
          }
        }
      }
      return out;
    });

  test('on: dividers are 1.5 px in outline and focus rings 2 px', async ({ page }) => {
    await start(page, { highContrast: 'on' });
    expect(await rootAttr(page, 'data-contrast')).toBe('more');
    const outline = await page.evaluate(() => {
      const probe = document.createElement('i');
      probe.style.color = 'var(--wd-outline)';
      document.body.append(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    const list = await dividers(page);
    expect(list.length).toBeGreaterThan(3);
    for (const d of list) {
      expect(d.width, d.cls).toBeCloseTo(1.5, 1);
      expect(d.color, d.cls).toBe(outline);
    }
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.activeElement as Element).outlineWidth),
    );
    expect(ring).toBeGreaterThanOrEqual(2);
  });

  test('off leaves the 1 px hairlines; system follows prefers-contrast', async ({ page }) => {
    await start(page, { highContrast: 'off' });
    expect((await dividers(page)).every((d) => d.width === 1)).toBe(true);
    await change(page, { highContrast: 'system' });
    await page.emulateMedia({ contrast: 'more' });
    await expect.poll(() => rootAttr(page, 'data-contrast')).toBe('more');
    await page.emulateMedia({ contrast: 'no-preference' });
    await expect.poll(() => rootAttr(page, 'data-contrast')).toBeNull();
  });
});

const TREE = `${HOME}/big`;

test.describe('D28 interface scale', () => {
  const heights = (page: Page) =>
    page.evaluate(() => ({
      title:
        document.querySelector('header, [data-testid="title-bar"]')?.getBoundingClientRect()
          .height ?? 0,
      status:
        document.querySelector('[data-testid="status-bar"]')?.getBoundingClientRect().height ?? 0,
      editorFont: Number.parseFloat(
        getComputedStyle(document.querySelector('.cm-content') as Element).fontSize,
      ),
      previewFont: Number.parseFloat(
        getComputedStyle(document.querySelector('[data-testid="preview"] p') as Element).fontSize,
      ),
    }));

  test('1.5 scales the chrome and leaves the document text alone', async ({ page }) => {
    await start(page);
    const base = await heights(page);
    await change(page, { scale: 1.5 });
    await expect.poll(() => rootAttr(page, 'data-scaled')).not.toBeNull();
    const scaled = await heights(page);
    // The title bar keeps its height: the traffic lights stay where the window put them.
    expect(scaled.title).toBeCloseTo(base.title, 0);
    expect(scaled.status).toBeGreaterThan(base.status * 1.3);
    expect(scaled.editorFont).toBe(base.editorFont);
    expect(scaled.previewFont).toBe(base.previewFont);
    await change(page, { scale: 1 });
    await expect.poll(() => rootAttr(page, 'data-scaled')).toBeNull();
    expect((await heights(page)).title).toBeCloseTo(base.title, 1);
  });

  test('the Files tree with 2,000 entries scrolls to the right rows and opens the clicked file', async ({
    page,
  }) => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 2000; i++)
      files[`${TREE}/n${String(i).padStart(4, '0')}.md`] = `# Note ${i}\n`;
    await start(
      page,
      { scale: 1.5 },
      { files, folderDialog: TREE, launch: { openPath: null, welcome: true } },
    );
    await expect(page.getByTestId('welcome')).toBeVisible();
    await page.getByTestId('welcome-open-folder').click();
    const tree = page.getByTestId('files-tree');
    await expect(tree).toBeVisible();
    const rowHeight = await page
      .getByTestId('files-row')
      .first()
      .evaluate((el) => (el.parentElement as HTMLElement).getBoundingClientRect().height);
    expect(rowHeight).toBeCloseTo(42, 0);
    await tree.evaluate((el) => {
      el.scrollTop = 42 * 1000;
    });
    const target = page.locator('[data-testid="files-row"][data-path$="n1000.md"]');
    await expect(target).toBeVisible();
    const t = await target.boundingBox();
    const w = await tree.boundingBox();
    expect(t && w && t.y >= w.y - 1 && t.y + t.height <= w.y + w.height + 1).toBe(true);
    await target.click();
    await expect(page.getByTestId('tab-strip').or(page.getByTestId('title-bar'))).toContainText(
      'n1000',
    );
  });

  test('pickers select the clicked row', async ({ page }) => {
    await start(page, { scale: 1.5 });
    await menu(page, 'command-palette');
    const picker = page.getByTestId('picker');
    await expect(picker).toBeVisible();
    const rows = picker.getByTestId('picker-row');
    await expect(rows.first()).toBeVisible();
    const third = rows.nth(2);
    const name = (await third.textContent()) ?? '';
    await third.hover();
    await expect(third).toHaveAttribute('aria-selected', 'true');
    expect(name.length).toBeGreaterThan(0);
    const box = await third.boundingBox();
    expect(box?.height).toBeGreaterThan(30);
  });
});

test.describe('D29 interface scale 1.5 at the minimum window size', () => {
  test('no control sits outside the window', async ({ page }) => {
    await start(page, { scale: 1.5 }, {}, { width: 960, height: 600 });
    const outside = await page.evaluate(() => {
      const bad: string[] = [];
      const w = window.innerWidth;
      for (const el of document.querySelectorAll(
        'button, [role="tab"], [role="radio"], input, select',
      )) {
        if (el.closest('[data-testid="preview"], .cm-editor')) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right > w + 1 || r.left < -1) {
          bad.push(
            `${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 20)} ${Math.round(r.right)}`,
          );
        }
      }
      return bad;
    });
    expect(outside).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});

test.describe('WP4.6 title bar at scale 1.5', () => {
  test('keeps its 44 px height and nothing in it is clipped', async ({ page }) => {
    await start(page, { scale: 1.5 }, {}, { width: 960, height: 600 });
    const bar = page.getByTestId('title-bar');
    const box = await bar.boundingBox();
    expect(box?.height).toBe(44);
    const clipped = await bar.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const bad: string[] = [];
      for (const child of el.querySelectorAll('button, [data-testid="app-title"]')) {
        const c = child.getBoundingClientRect();
        if (c.width === 0) continue;
        if (c.top < r.top - 0.5 || c.bottom > r.bottom + 0.5) bad.push(child.tagName);
      }
      return bad;
    });
    expect(clipped).toEqual([]);
  });
});

test.describe('D30 settings survive a restart', () => {
  test('a seeded session applies every accessibility setting at start', async ({ page }) => {
    await start(page, {
      dyslexia: true,
      ruler: true,
      rulerTint: 'green',
      spotlight: true,
      reduceMotion: 'on',
      highContrast: 'on',
      scale: 1.3,
    });
    expect(await rootAttr(page, 'data-dyslexia')).toBe('opendyslexic');
    expect(await rootAttr(page, 'data-ruler-tint')).toBe('green');
    expect(await rootAttr(page, 'data-motion')).toBe('reduce');
    expect(await rootAttr(page, 'data-contrast')).toBe('more');
    expect(await css(page, 'html', '--wd-scale')).toBe('1.3');
    await expect(page.locator('.cm-wd-spotlight')).toHaveCount(1);
    await expect(page.locator('.cm-wd-ruler')).toHaveCount(1);
  });
});

test.describe('WP4.7 title bar and Outline depth row at large scale', () => {
  const sizes = [
    { width: 1280, height: 820, scale: 1.5 },
    { width: 960, height: 600, scale: 1.5 },
    { width: 960, height: 600, scale: 1 },
  ];
  for (const { width, height, scale } of sizes) {
    test(`the title-bar boxes do not intersect (${width} px, scale ${scale})`, async ({ page }) => {
      await start(page, { scale }, {}, { width, height });
      const overlaps = await page.getByTestId('title-bar').evaluate((bar) => {
        const items: { name: string; r: DOMRect }[] = [];
        for (const child of Array.from(bar.children)) {
          const cs = getComputedStyle(child);
          if (cs.visibility === 'hidden' || cs.display === 'none') continue;
          const r = child.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          items.push({ name: child.getAttribute('data-testid') ?? child.tagName, r });
        }
        const bad: string[] = [];
        for (let i = 0; i < items.length; i++) {
          for (let j = i + 1; j < items.length; j++) {
            const x = items[i];
            const y = items[j];
            if (!x || !y) continue;
            const a = x.r;
            const b = y.r;
            if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
              bad.push(`${x.name} / ${y.name}`);
            }
          }
        }
        return bad;
      });
      expect(overlaps).toEqual([]);
    });
  }

  test('every Outline depth button stays inside the sidebar at scale 1.5', async ({ page }) => {
    await start(page, { scale: 1.5 });
    await page.getByTestId('sidebar-tab-outline').click();
    const sidebar = await page.getByTestId('sidebar').boundingBox();
    if (!sidebar) throw new Error('no sidebar');
    for (const d of [0, 1, 2, 3]) {
      const button = page.getByTestId(`outline-depth-${d}`);
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      if (!box) throw new Error('no button');
      expect(box.width).toBeGreaterThanOrEqual(24);
      expect(box.height).toBeGreaterThanOrEqual(24);
      expect(box.x + box.width).toBeLessThanOrEqual(sidebar.x + sidebar.width + 0.5);
    }
  });
});
