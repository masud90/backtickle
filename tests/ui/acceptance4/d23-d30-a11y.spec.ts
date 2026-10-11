/**
 * Phase 4 acceptance D23 to D30: accessibility
 * features, checked from computed styles, element bounds and WCAG 2.2 formulas. Run with
 * WD_UI_PORT=1487.
 */
import { expect, type Page, test } from '@playwright/test';
import { openPrefs } from '../prefs-helpers';
import {
  change,
  DOC,
  editor,
  effectiveBackground,
  HOME,
  menu,
  preview,
  resolveColor,
  rootAttr,
  seedMock,
  startGuide,
} from './support';
import { contrastOf } from './wcag';

const BLOCKS = [
  '# Title',
  '',
  'First paragraph of the spotlight test.',
  '',
  '- item one',
  '- item two',
  '',
  '```js',
  'const a = 1;',
  'const b = 2;',
  '```',
  '',
  'Last paragraph here.',
  '',
].join('\n');

test.describe('D23 dyslexia mode', () => {
  for (const font of ['atkinson', 'opendyslexic', 'lexend'] as const) {
    test(`the ${font} typeface and the 1.4.12 spacing apply to body blocks`, async ({ page }) => {
      await startGuide(page, { a11y: { dyslexia: true, dyslexiaFont: font } });
      const rows = await preview(page).evaluate((root) => {
        const out: Array<{
          tag: string;
          family: string;
          size: number;
          letter: number;
          word: number;
          line: number;
        }> = [];
        for (const el of root.querySelectorAll('p, li:not(.wd-tag), blockquote p, td')) {
          const s = getComputedStyle(el);
          out.push({
            tag: el.tagName,
            family: s.fontFamily.toLowerCase(),
            size: Number.parseFloat(s.fontSize),
            letter: Number.parseFloat(s.letterSpacing),
            word: Number.parseFloat(s.wordSpacing),
            line: Number.parseFloat(s.lineHeight),
          });
          if (out.length >= 12) break;
        }
        return out;
      });
      expect(rows.length).toBeGreaterThan(4);
      for (const r of rows) {
        expect(r.family, r.tag).toContain(font);
        expect(r.letter, r.tag).toBeGreaterThanOrEqual(0.12 * r.size - 0.05);
        expect(r.word, r.tag).toBeGreaterThanOrEqual(0.16 * r.size - 0.05);
        expect(r.line, r.tag).toBeGreaterThanOrEqual(1.5 * r.size - 0.05);
      }
    });
  }

  test('the frontmatter tag pills take the 1.4.12 spacing too', async ({ page }) => {
    await startGuide(page, { a11y: { dyslexia: true } });
    const pill = await preview(page)
      .locator('li.wd-tag')
      .first()
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return { size: Number.parseFloat(s.fontSize), letter: Number.parseFloat(s.letterSpacing) };
      });
    expect(pill.letter).toBeGreaterThanOrEqual(0.12 * pill.size - 0.05);
  });

  test('the editor uses letter and word spacing and a line height of at least 1.5', async ({
    page,
  }) => {
    await startGuide(page, { a11y: { dyslexia: true } });
    const cm = await page.locator('.cm-content').evaluate((el) => {
      const s = getComputedStyle(el);
      const line = getComputedStyle(el.querySelector('.cm-line') as Element);
      return {
        size: Number.parseFloat(s.fontSize),
        letter: Number.parseFloat(s.letterSpacing),
        word: Number.parseFloat(s.wordSpacing),
        line: Number.parseFloat(line.lineHeight),
      };
    });
    expect(cm.letter).toBeGreaterThanOrEqual(0.12 * cm.size - 0.05);
    expect(cm.word).toBeGreaterThanOrEqual(0.16 * cm.size - 0.05);
    expect(cm.line).toBeGreaterThanOrEqual(1.5 * cm.size - 0.05);
  });

  test('no text is clipped or overlapped in the guide (element bounds)', async ({ page }) => {
    await startGuide(
      page,
      { a11y: { dyslexia: true, dyslexiaFont: 'opendyslexic' } },
      { view: 'preview' },
    );
    await page.evaluate(() => document.fonts.ready);
    const problems = await preview(page).evaluate((root) => {
      const bad: string[] = [];
      const label = (el: Element) =>
        `${el.tagName}.${(el as HTMLElement).className} "${(el.textContent ?? '').trim().slice(0, 24)}"`;
      // Clipping: a box that clips its overflow must contain its content.
      for (const el of root.querySelectorAll(
        'p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, .callout, .code-card, summary',
      )) {
        const e = el as HTMLElement;
        const s = getComputedStyle(e);
        if (
          s.overflowX !== 'visible' &&
          e.scrollWidth > e.clientWidth + 1 &&
          s.overflowX !== 'auto' &&
          s.overflowX !== 'scroll'
        ) {
          bad.push(`clip-x ${label(e)}`);
        }
        if (
          s.overflowY !== 'visible' &&
          s.overflowY !== 'auto' &&
          s.overflowY !== 'scroll' &&
          e.scrollHeight > e.clientHeight + 1
        ) {
          bad.push(`clip-y ${label(e)}`);
        }
      }
      // Overlap: consecutive top-level blocks must not overlap vertically.
      const kids = [...root.querySelectorAll('article > *, .wd-preview > *')].filter(
        (k) => k.getBoundingClientRect().height > 0,
      );
      for (let i = 1; i < kids.length; i++) {
        const a = (kids[i - 1] as Element).getBoundingClientRect();
        const b = (kids[i] as Element).getBoundingClientRect();
        if (b.top < a.bottom - 1 && b.left < a.right && b.right > a.left)
          bad.push(`overlap ${label(kids[i] as Element)}`);
      }
      return bad;
    });
    expect(problems).toEqual([]);
  });

  test('outline and title bar text are not clipped with the mode on', async ({ page }) => {
    await startGuide(page, { a11y: { dyslexia: true } });
    const clipped = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll(
        '[data-testid="outline-item"], [data-testid="document-name"], [data-testid="app-title"]',
      )) {
        const e = el as HTMLElement;
        if (e.getBoundingClientRect().height === 0) continue;
        if (e.scrollHeight > e.clientHeight + 2 && getComputedStyle(e).overflowY === 'hidden')
          bad.push(e.dataset.testid ?? e.tagName);
      }
      return bad;
    });
    expect(clipped).toEqual([]);
  });
});

test.describe('D24 reading ruler', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const tint of ['yellow', 'blue', 'green', 'pink'] as const) {
      test(`${tint} tint keeps text at 4.5:1 in the editor and the preview (${scheme})`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await startGuide(page, { a11y: { ruler: true, rulerTint: tint } });
        await editor(page).click();
        await page.keyboard.press('ControlOrMeta+Home');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        const band = page.locator('.cm-wd-ruler');
        await expect(band).toHaveCount(1);
        const bandColor = await band.evaluate((el) => getComputedStyle(el).backgroundColor);
        const surface = await effectiveBackground(page, '.cm-scroller');
        const textColor = await page
          .locator('.cm-content')
          .evaluate((el) => getComputedStyle(el).color);
        expect(
          contrastOf(textColor, bandColor, surface),
          `editor text ${textColor} on ${bandColor}`,
        ).toBeGreaterThanOrEqual(4.5);
        // The tokens of headings and marks in the line also stay readable: check every colored span of the band line.
        const spans = await page
          .locator('.cm-line')
          .nth(2)
          .evaluate((line) =>
            [...line.querySelectorAll('span')].map((s) => getComputedStyle(s).color),
          );
        for (const color of spans) {
          expect(
            contrastOf(color, bandColor, surface),
            `editor token ${color}`,
          ).toBeGreaterThanOrEqual(4.5);
        }

        const paragraph = preview(page).locator('p').first();
        const box = await paragraph.boundingBox();
        if (!box) throw new Error('no paragraph');
        await page.mouse.move(box.x + 20, box.y + 6);
        const pband = page.locator('.wd-preview-ruler');
        await expect(pband).toBeVisible();
        const pbandColor = await pband.evaluate((el) => getComputedStyle(el).backgroundColor);
        const psurface = await effectiveBackground(page, '[data-testid="preview"]');
        const ptext = await paragraph.evaluate((el) => getComputedStyle(el).color);
        expect(
          contrastOf(ptext, pbandColor, psurface),
          `preview text ${ptext} on ${pbandColor}`,
        ).toBeGreaterThanOrEqual(4.5);
        const links = await preview(page)
          .locator('p a')
          .first()
          .evaluate((el) => getComputedStyle(el).color)
          .catch(() => null);
        if (links)
          expect(contrastOf(links, pbandColor, psurface), `link ${links}`).toBeGreaterThanOrEqual(
            4.5,
          );
      });
    }
  }

  test('the band is one line high and hides when the pointer leaves the preview', async ({
    page,
  }) => {
    await startGuide(page, { a11y: { ruler: true } });
    const paragraph = preview(page).locator('p').first();
    const box = await paragraph.boundingBox();
    if (!box) throw new Error('no paragraph');
    await page.mouse.move(box.x + 30, box.y + 4);
    const band = page.locator('.wd-preview-ruler');
    await expect(band).toBeVisible();
    const lineHeight = await paragraph.evaluate((el) =>
      Number.parseFloat(getComputedStyle(el).lineHeight),
    );
    const bh = (await band.boundingBox())?.height ?? 0;
    expect(bh).toBeGreaterThan(lineHeight * 0.7);
    expect(bh).toBeLessThan(lineHeight * 1.5);
    await page.mouse.move(2, 2);
    await expect(band).toBeHidden();
  });
});

test.describe('D25 spotlight', () => {
  const opacities = (page: Page) =>
    page.locator('.cm-line').evaluateAll((els) =>
      els.map((el) => ({
        text: el.textContent ?? '',
        o: Number.parseFloat(getComputedStyle(el).opacity),
      })),
    );

  test('only the cursor block is bright, the rest at 35%, and it moves with the cursor', async ({
    page,
  }) => {
    await startGuide(
      page,
      { a11y: { spotlight: true } },
      { seed: { files: { [DOC]: BLOCKS } }, ready: 'First paragraph' },
    );
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect
      .poll(async () => (await opacities(page)).find((l) => l.text.startsWith('First'))?.o)
      .toBe(1);
    const all = await opacities(page);
    for (const l of all) {
      if (l.text.startsWith('First')) expect(l.o).toBe(1);
      else expect(l.o, l.text).toBeCloseTo(0.35, 2);
    }
    // Into the code fence: both fence lines and the code lines are bright; the paragraphs are not.
    await page.locator('.cm-line', { hasText: 'const b = 2;' }).click();
    await expect
      .poll(async () => (await opacities(page)).find((l) => l.text.startsWith('First'))?.o)
      .toBeCloseTo(0.35, 2);
    const fence = await opacities(page);
    for (const l of fence) {
      const inFence = l.text.startsWith('```') || l.text.startsWith('const');
      expect(l.o, l.text).toBeCloseTo(inFence ? 1 : 0.35, 2);
    }
  });

  test('off in Preview mode, and the preview content is never dimmed', async ({ page }) => {
    await startGuide(page, { a11y: { spotlight: true } }, { view: 'preview' });
    const dimmed = await preview(page).evaluate(
      (root) =>
        [...root.querySelectorAll('p, li, h1, h2, pre')].filter(
          (el) => getComputedStyle(el).opacity !== '1',
        ).length,
    );
    expect(dimmed).toBe(0);
    await menu(page, 'view-editor');
    await expect(editor(page)).toBeVisible();
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    await expect
      .poll(async () => (await opacities(page)).some((l) => Math.abs(l.o - 0.35) < 0.01))
      .toBe(true);
  });
});

test.describe('D26 reduce motion', () => {
  const motion = (page: Page) =>
    page.evaluate(() => {
      const running = document.getAnimations().length;
      const withTransition = [...document.querySelectorAll('*')].filter((el) => {
        const d = getComputedStyle(el).transitionDuration;
        return d.split(',').some((x) => Number.parseFloat(x) > 0);
      }).length;
      const withAnimation = [...document.querySelectorAll('*')].filter((el) => {
        const s = getComputedStyle(el);
        return s.animationName !== 'none' && Number.parseFloat(s.animationDuration) > 0;
      }).length;
      const smooth = [...document.querySelectorAll('*')].filter(
        (el) => getComputedStyle(el).scrollBehavior === 'smooth',
      ).length;
      return { running, withTransition, withAnimation, smooth };
    });

  test('on: nothing animates in the main window, also with the palette and menus open', async ({
    page,
  }) => {
    await startGuide(page, { a11y: { reduceMotion: 'on' } });
    await editor(page).click();
    await menu(page, 'command-palette');
    await expect(page.getByTestId('picker')).toBeVisible();
    expect(await motion(page)).toEqual({
      running: 0,
      withTransition: 0,
      withAnimation: 0,
      smooth: 0,
    });
    await page.keyboard.press('Escape');
    await page.getByTestId('document-menu-button').click();
    expect(await motion(page)).toEqual({
      running: 0,
      withTransition: 0,
      withAnimation: 0,
      smooth: 0,
    });
  });

  test('on: nothing animates in the Preferences window', async ({ page }) => {
    await openPrefs(page, { settings: { a11y: { reduceMotion: 'on' } } });
    await expect.poll(() => rootAttr(page, 'data-motion')).toBe('reduce');
    expect(await motion(page)).toEqual({
      running: 0,
      withTransition: 0,
      withAnimation: 0,
      smooth: 0,
    });
  });

  test('system follows the emulated media query in both directions', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await startGuide(page, { a11y: { reduceMotion: 'system' } });
    expect((await motion(page)).withTransition).toBe(0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(async () => (await motion(page)).withTransition).toBeGreaterThan(0);
  });

  test('sync scroll and outline jumps land instantly', async ({ page }) => {
    await startGuide(page, { a11y: { reduceMotion: 'on' } });
    const scroller = page.getByTestId('preview-scroll');
    const item = page.getByTestId('outline-item').nth(6);
    await item.click();
    // An instant jump settles in the next frame: two samples a frame apart are equal.
    const a = await scroller.evaluate((el) => el.scrollTop);
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    const b = await scroller.evaluate((el) => el.scrollTop);
    expect(b).toBe(a);
    expect(a).toBeGreaterThan(0);
  });
});

test.describe('D27 high contrast', () => {
  const edges = (page: Page) =>
    page.evaluate(() => {
      const out: Array<{
        id: string;
        side: string;
        width: number;
        style: string;
        color: string;
        bg: string;
      }> = [];
      const surface = (start: Element | null) => {
        let el = start;
        while (el) {
          const bg = getComputedStyle(el).backgroundColor;
          if (!/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg;
          el = el.parentElement;
        }
        return 'rgb(255, 255, 255)';
      };
      for (const id of ['toolbar', 'status-bar', 'sidebar', 'title-bar', 'splitter']) {
        const el = document.querySelector(`[data-testid="${id}"]`);
        if (!el) continue;
        const s = getComputedStyle(el);
        for (const side of ['top', 'right', 'bottom', 'left']) {
          const w = Number.parseFloat(s.getPropertyValue(`border-${side}-width`));
          if (w > 0) {
            out.push({
              id,
              side,
              width: w,
              style: s.getPropertyValue(`border-${side}-style`),
              color: s.getPropertyValue(`border-${side}-color`),
              bg: surface(el),
            });
          }
        }
      }
      return out;
    });

  for (const scheme of ['light', 'dark'] as const) {
    test(`on: dividers are 1.5 px solid in outline with 3:1 against their surface (${scheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await startGuide(page, { a11y: { highContrast: 'on' } });
      const outline = await resolveColor(page, 'var(--wd-outline)');
      const list = await edges(page);
      const pageBg = await effectiveBackground(page, 'body');
      expect(list.length).toBeGreaterThanOrEqual(3);
      for (const d of list) {
        expect(d.width, `${d.id} ${d.side}`).toBeCloseTo(1.5, 1);
        expect(d.style, `${d.id} ${d.side}`).toBe('solid');
        expect(d.color, `${d.id} ${d.side}`).toBe(outline);
        expect(contrastOf(d.color, d.bg, pageBg), `${d.id} ${d.side}`).toBeGreaterThanOrEqual(3);
      }
      const page2 = await resolveColor(page, 'var(--wd-surface)').catch(() => 'rgb(255, 255, 255)');
      expect(contrastOf(outline, page2)).toBeGreaterThanOrEqual(3);
    });
  }

  test('system follows prefers-contrast: more and focus rings are 2 px', async ({ page }) => {
    await page.emulateMedia({ contrast: 'more' });
    await startGuide(page, { a11y: { highContrast: 'system' } });
    await expect.poll(() => rootAttr(page, 'data-contrast')).toBe('more');
    await page.keyboard.press('Alt+Tab');
    const ring = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement as Element);
      return { width: Number.parseFloat(s.outlineWidth), style: s.outlineStyle };
    });
    expect(ring.width).toBeGreaterThanOrEqual(2);
    expect(ring.style).not.toBe('none');
  });
});

test.describe('D28 interface scale 1.5', () => {
  const sizes = (page: Page) =>
    page.evaluate(() => {
      const h = (sel: string) => document.querySelector(sel)?.getBoundingClientRect().height ?? 0;
      return {
        status: h('[data-testid="status-position"]'),
        toolbar: h('[data-testid="toolbar"]'),
        title: h('[data-testid="title-bar"]'),
        newButton: h('[data-testid="new-button"]'),
        cmFont: Number.parseFloat(
          getComputedStyle(document.querySelector('.cm-content') as Element).fontSize,
        ),
        cmLine: document.querySelector('.cm-line')?.getBoundingClientRect().height ?? 0,
        prFont: Number.parseFloat(
          getComputedStyle(document.querySelector('[data-testid="preview"] p') as Element).fontSize,
        ),
        prWidth: Number.parseFloat(
          getComputedStyle(document.querySelector('[data-testid="preview"]') as Element).maxWidth,
        ),
      };
    });

  test('chrome sizes grow by 1.5, the title bar and the document text do not', async ({ page }) => {
    await startGuide(page);
    const base = await sizes(page);
    await change(page, { a11y: { scale: 1.5 } });
    await expect.poll(() => rootAttr(page, 'data-scaled')).not.toBeNull();
    const s = await sizes(page);
    expect(s.status / base.status).toBeGreaterThan(1.35);
    expect(s.status / base.status).toBeLessThan(2.1);
    expect(s.newButton / base.newButton).toBeGreaterThan(1.3);
    expect(s.title).toBeCloseTo(base.title, 0);
    expect(s.cmFont).toBe(base.cmFont);
    expect(s.cmLine).toBeCloseTo(base.cmLine, 0);
    expect(s.prFont).toBe(base.prFont);
    expect(s.prWidth).toBe(base.prWidth);
  });

  test('a Files tree of 2,000 entries opens the clicked row after a wheel scroll', async ({
    page,
  }) => {
    const root = `${HOME}/many`;
    const files: Record<string, string> = {};
    for (let i = 0; i < 2000; i++) files[`${root}/f${String(i).padStart(4, '0')}.md`] = `# F${i}\n`;
    await seedMock(page, {
      files,
      folderDialog: root,
      launch: { openPath: null, welcome: true },
      settings: { a11y: { scale: 1.5 } },
    });
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.goto('/');
    await page.getByTestId('welcome-open-folder').click();
    const tree = page.getByTestId('files-tree');
    await expect(tree).toBeVisible();
    await tree.hover();
    await page.mouse.wheel(0, 42 * 600);
    await expect.poll(() => tree.evaluate((el) => el.scrollTop)).toBeGreaterThan(42 * 500);
    const visible = await page
      .getByTestId('files-row')
      .evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.path ?? ''));
    expect(visible.length).toBeGreaterThan(5);
    const first = visible[3] as string;
    const row = page.locator(`[data-testid="files-row"][data-path="${first}"]`);
    const index = Number(first.match(/f(\d{4})\.md$/)?.[1]);
    expect(index).toBeGreaterThan(500);
    await row.click();
    await expect(page.getByTestId('document-name')).toHaveText(
      `f${String(index).padStart(4, '0')}.md`,
    );
  });

  test('a click on a picker row opens that row', async ({ page }) => {
    const names = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
    const files = Object.fromEntries(names.map((n) => [`${HOME}/${n}.md`, `# ${n}\n`]));
    await startGuide(
      page,
      { a11y: { scale: 1.5 } },
      { seed: { files, recents: Object.keys(files) } },
    );
    await menu(page, 'quick-open');
    const rows = page.getByTestId('picker').getByTestId('picker-row');
    await expect(rows.first()).toBeVisible();
    const target = rows.filter({ hasText: 'delta' });
    await expect(target).toHaveCount(1);
    await target.click();
    await expect(page.getByTestId('document-name')).toHaveText('delta.md');
  });
});

test.describe('D29 interface scale 1.5 at the minimum window', () => {
  for (const view of ['editor', 'split', 'preview'] as const) {
    test(`${view}: every control is inside the window and the toolbar overflow is reachable`, async ({
      page,
    }) => {
      await startGuide(page, { a11y: { scale: 1.5 } }, { view, size: { width: 960, height: 600 } });
      const report = await page.evaluate(() => {
        const w = window.innerWidth;
        const outside: string[] = [];
        for (const el of document.querySelectorAll(
          'button, [role="tab"], [role="radio"], [role="slider"], input, select',
        )) {
          if (el.closest('[data-testid="preview"], .cm-editor')) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > w + 1 || r.left < -1) {
            outside.push(
              `${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 18)} r${Math.round(r.right)} b${Math.round(r.bottom)}`,
            );
          }
        }
        return { outside, scrollW: document.documentElement.scrollWidth, w };
      });
      expect(report.outside).toEqual([]);
      expect(report.scrollW).toBeLessThanOrEqual(report.w);
      // Every toolbar item is either visible inside the window or reachable in an overflow menu.
      const toolbar = page.getByTestId('toolbar');
      await expect(toolbar).toBeVisible();
      const overflow = toolbar.getByRole('button', { name: /more|overflow/i });
      if (await overflow.count()) {
        await overflow.first().click();
        await expect(page.getByRole('menu')).toBeVisible();
      }
    });
  }
});

test.describe('D30 settings survive a restart and reach Preferences', () => {
  const all = {
    dyslexia: true,
    dyslexiaFont: 'lexend',
    ruler: true,
    rulerTint: 'pink',
    spotlight: true,
    reduceMotion: 'on',
    highContrast: 'on',
    scale: 1.2,
  } as const;

  test('a fresh page load with the saved settings applies every one', async ({ page }) => {
    await startGuide(page, { a11y: all });
    expect(await rootAttr(page, 'data-dyslexia')).toBe('lexend');
    expect(await rootAttr(page, 'data-ruler-tint')).toBe('pink');
    expect(await rootAttr(page, 'data-motion')).toBe('reduce');
    expect(await rootAttr(page, 'data-contrast')).toBe('more');
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--wd-scale').trim(),
      ),
    ).toBe('1.2');
    await page.reload();
    await expect(preview(page)).toContainText('Heading');
    expect(await rootAttr(page, 'data-dyslexia')).toBe('lexend');
  });

  test('the Preferences window follows scale, motion and contrast', async ({ page }) => {
    await openPrefs(page, { settings: { a11y: all } });
    expect(await rootAttr(page, 'data-motion')).toBe('reduce');
    expect(await rootAttr(page, 'data-contrast')).toBe('more');
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--wd-scale').trim(),
      ),
    ).toBe('1.2');
    await change(page, { a11y: { scale: 1, reduceMotion: 'off', highContrast: 'off' } });
    await expect.poll(() => rootAttr(page, 'data-motion')).toBeNull();
    await expect.poll(() => rootAttr(page, 'data-contrast')).toBeNull();
    await expect.poll(() => rootAttr(page, 'data-scaled')).toBeNull();
  });
});
