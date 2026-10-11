/** WP5.2 typewriter scrolling in the editor. */
import { expect, type Page, test } from '@playwright/test';
import { editor, seedMock } from './helpers';
import { DOC, offCenter, start } from './typewriter-support';

const scrollTop = (page: Page) =>
  page.locator('.cm-scroller').evaluate((el) => (el as HTMLElement).scrollTop);

test.describe('typewriter scrolling', () => {
  test('keeps the line being typed on within one line height of the center', async ({ page }) => {
    await start(page);
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    for (let i = 0; i < 80; i++) await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await offCenter(page)).off).toBeLessThan(23);
    expect(await scrollTop(page)).toBeGreaterThan(500);

    await page.keyboard.press('End');
    await page.keyboard.type(' typed');
    await page.keyboard.press('Enter');
    await page.keyboard.type('a new line');
    const { off, line } = await offCenter(page);
    expect(off).toBeLessThanOrEqual(line);
  });

  test('undo brings the line back to the center', async ({ page }) => {
    await start(page);
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.type('x');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => (await offCenter(page)).off).toBeLessThan(23);
  });

  test('the last line of the document can reach the center', async ({ page }) => {
    await start(page);
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await expect.poll(async () => (await offCenter(page)).off).toBeLessThan(23);
  });

  test('the wheel scrolls freely and the next cursor move centers again', async ({ page }) => {
    await start(page);
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    for (let i = 0; i < 80; i++) await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await offCenter(page)).off).toBeLessThan(23);
    const centered = await scrollTop(page);

    await page.locator('.cm-scroller').hover();
    await page.mouse.wheel(0, 400);
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(centered + 100);
    const wheeled = await scrollTop(page);
    await page.waitForTimeout(300);
    expect(await scrollTop(page)).toBe(wheeled);

    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await offCenter(page)).off).toBeLessThan(23);
  });

  test('a click with the mouse does not move the text', async ({ page }) => {
    await start(page);
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    for (let i = 0; i < 80; i++) await page.keyboard.press('ArrowDown');
    await page.locator('.cm-scroller').hover();
    await page.mouse.wheel(0, 300);
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);
    const before = await scrollTop(page);
    const box = await page.locator('.cm-scroller').boundingBox();
    if (!box) throw new Error('no scroller');
    await page.mouse.click(box.x + 200, box.y + 100);
    await page.waitForTimeout(200);
    expect(await scrollTop(page)).toBe(before);
  });

  test('with Reduce motion on the scrolling is immediate', async ({ page }) => {
    await start(page, { a11y: { reduceMotion: 'on' } });
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    for (let i = 0; i < 80; i++) await page.keyboard.press('ArrowDown');
    const behavior = await page
      .locator('.cm-scroller')
      .evaluate((el) => getComputedStyle(el).scrollBehavior);
    expect(behavior).toBe('auto');
    expect((await offCenter(page)).off).toBeLessThan(23);
  });

  test('off, the cursor moves down the screen as usual', async ({ page }) => {
    await start(page, { editor: { typewriter: false } });
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowDown');
    expect(await scrollTop(page)).toBe(0);
  });

  test('turning it off in the settings stops the centering', async ({ page }) => {
    await start(page);
    await editor(page).click();
    await page.evaluate(() =>
      window.__WRITEDOWN_MOCK__?.settingsChanged({ editor: { typewriter: false } } as never),
    );
    await page.keyboard.press('ControlOrMeta+Home');
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowDown');
    expect(await scrollTop(page)).toBe(0);
  });

  test('soft-wrapped lines: the visual line with the cursor is centered', async ({ page }) => {
    const wrapped = `${Array.from({ length: 60 }, (_, i) => `Para ${i} ${'word '.repeat(60)}`).join('\n\n')}\n`;
    await seedMock(page, {
      files: { [DOC]: wrapped },
      launch: { openPath: DOC, view: 'editor' },
      settings: { editor: { typewriter: true, softWrap: true } },
    });
    await page.setViewportSize({ width: 900, height: 820 });
    await page.goto('/');
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await offCenter(page)).off).toBeLessThan(23);
  });

  test('in Split the preview follows the editor', async ({ page }) => {
    await start(page, {}, 'split');
    await expect(page.getByTestId('preview')).toContainText('Line 1 of');
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    for (let i = 0; i < 100; i++) await page.keyboard.press('ArrowDown');
    await expect
      .poll(() => page.getByTestId('preview-scroll').evaluate((el) => el.scrollTop))
      .toBeGreaterThan(200);
  });
});
