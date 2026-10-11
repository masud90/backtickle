/** Shared helpers of the Phase 4 acceptance specs (D21 to D36). */
import { expect, type Page } from '@playwright/test';
import type { MockSeed } from '../../../src/lib/platform-mock';
import { editor, guideText, HOME, preview, seedMock } from '../helpers';

export { editor, guideText, HOME, menu, preview, seedMock } from '../helpers';
export const DOC = `${HOME}/guide.md`;

/** Opens the GFM guide in Split (or the given view) with the given settings. */
export async function startGuide(
  page: Page,
  settings: MockSeed['settings'] = {},
  options: {
    view?: 'editor' | 'split' | 'preview';
    size?: { width: number; height: number };
    seed?: Partial<MockSeed>;
    ready?: string;
  } = {},
): Promise<void> {
  const view = options.view ?? 'split';
  await seedMock(page, {
    ...options.seed,
    files: { [DOC]: guideText('gfm'), ...options.seed?.files },
    launch: { openPath: DOC, view },
    settings,
  });
  await page.setViewportSize(options.size ?? { width: 1280, height: 820 });
  await page.goto('/');
  if (view !== 'editor') await expect(preview(page)).toContainText(options.ready ?? 'Heading');
  if (view !== 'preview') await expect(editor(page)).toBeVisible();
}

/** Sends a settings patch as the Preferences window would (through `settings-changed`). */
export const change = (page: Page, patch: object): Promise<void> =>
  page.evaluate((value) => window.__WRITEDOWN_MOCK__?.settingsChanged(value as never), patch);

export const rootAttr = (page: Page, name: string): Promise<string | null> =>
  page.evaluate((n) => document.documentElement.getAttribute(n), name);

/** The computed color of a CSS custom property or any CSS color, resolved to rgb(). */
export const resolveColor = (page: Page, value: string): Promise<string> =>
  page.evaluate((v) => {
    const probe = document.createElement('i');
    probe.style.color = v;
    document.body.append(probe);
    const out = getComputedStyle(probe).color;
    probe.remove();
    return out;
  }, value);

/** The first opaque background found walking up from an element. */
export const effectiveBackground = (page: Page, selector: string): Promise<string> =>
  page
    .locator(selector)
    .first()
    .evaluate((start) => {
      let el: Element | null = start;
      const acc: string[] = [];
      while (el) {
        const bg = getComputedStyle(el).backgroundColor;
        acc.push(bg);
        if (!/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg;
        el = el.parentElement;
      }
      return 'rgb(255, 255, 255)';
    });
