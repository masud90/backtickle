/** Shared by the WP5.2 typewriter specs. */
import { expect, type Page } from '@playwright/test';
import type { MockSeed } from '../../src/lib/platform-mock';
import { editor, HOME, seedMock } from './helpers';

export const DOC = `${HOME}/long.md`;
export const TEXT = `${Array.from({ length: 300 }, (_, i) => `Line ${i + 1} of the long note.`).join('\n')}\n`;

export async function start(page: Page, settings: MockSeed['settings'] = {}, view = 'editor') {
  await seedMock(page, {
    files: { [DOC]: TEXT },
    launch: { openPath: DOC, view: view as 'editor' },
    settings: { editor: { typewriter: true }, ...settings },
  });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');
  await expect(editor(page)).toBeVisible();
}

/** How far the cursor's vertical middle is from the middle of the scroller, and one line's height. */
export async function offCenter(page: Page): Promise<{ off: number; line: number }> {
  return page.evaluate(() => {
    const scroller = document.querySelector('.cm-scroller') as HTMLElement;
    const cursor = document.querySelector('.cm-cursor-primary') as HTMLElement;
    const s = scroller.getBoundingClientRect();
    const c = cursor.getBoundingClientRect();
    return { off: Math.abs(c.top + c.height / 2 - (s.top + s.height / 2)), line: c.height };
  });
}
