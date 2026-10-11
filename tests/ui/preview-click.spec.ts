/**
 * Click to source and wikilink wiring. Mock platform, real WebKit.
 * Expected lines come from the document text the tests build. Run with WD_UI_PORT=1467.
 */
import { type Page, test } from '@playwright/test';
import { DOCS, expect, launch, preview, VAULT_ROOT, vaultSeed } from './acceptance2/common';

const FILE = `${DOCS}/click.md`;

/** Lines (0-based) of what the tests click are found from the text itself. */
const LINES = [
  '# Heading one', // 0
  '', // 1
  'First paragraph with a [link](#heading-one).', // 2
  '', // 3
  '- item one', // 4
  '- item two', // 5
  '', // 6
  '| a | b |', // 7
  '| - | - |', // 8
  '| cell one | cell two |', // 9
  '', // 10
  '- [ ] task box', // 11
  '',
  '<details><summary>More</summary>\n\nHidden body.\n\n</details>',
  '',
  ...Array.from({ length: 80 }, (_, i) => `Filler paragraph ${i}.\n`),
  'Target paragraph far down.',
  '',
];
const TEXT = LINES.join('\n');
const lineOf = (needle: string) => TEXT.split('\n').findIndex((line) => line.includes(needle));

const position = (page: Page) => page.getByTestId('status-position');

async function open(page: Page, text = TEXT, view: 'split' | 'preview' = 'split') {
  await page.setViewportSize({ width: 1280, height: 700 });
  await launch(page, { seed: { files: { [FILE]: text } }, open: FILE, view });
  await expect(preview(page).locator('.wd-block').first()).toBeVisible();
  // Put the caret away from everything the tests click.
  await expect(position(page)).toHaveText('Ln 1, Col 1');
}

const caretLine = async (page: Page) => {
  const text = (await position(page).textContent()) ?? '';
  return Number(/Ln (\d+)/.exec(text)?.[1]) - 1;
};

test.describe('C10 click to source', () => {
  test('C10 a click on a paragraph, list item, table cell and heading moves the caret', async ({
    page,
  }) => {
    await open(page);
    const cases: Array<[string, string]> = [
      ['First paragraph', 'First paragraph'],
      ['item two', 'item two'],
      ['cell two', '| cell one |'],
      ['Heading one', '# Heading one'],
    ];
    for (const [shown, source] of cases) {
      await preview(page)
        .getByText(shown, { exact: false })
        .first()
        .click({ position: { x: 4, y: 4 } });
      await expect.poll(() => caretLine(page)).toBe(lineOf(source));
    }
  });

  test('C10 the keyboard focus stays where it was', async ({ page }) => {
    await open(page);
    await page.getByTestId('preview-scroll').focus();
    await preview(page).getByText('item one').click();
    await expect.poll(() => caretLine(page)).toBe(lineOf('item one'));
    const focus = await page.evaluate(() => document.activeElement?.closest('.cm-editor') !== null);
    expect(focus).toBe(false);
  });

  test('C10 a far line is scrolled into view in the editor', async ({ page }) => {
    await open(page);
    const target = lineOf('Target paragraph');
    await page.getByTestId('preview-scroll').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const last = preview(page).getByText('Target paragraph far down.');
    await expect(last).toBeVisible();
    await last.click();
    await expect.poll(() => caretLine(page)).toBe(target);
    await expect(page.locator('.cm-line', { hasText: 'Target paragraph far down.' })).toBeVisible();
  });

  test('C10 links, task boxes, Copy buttons and summary do not move the caret', async ({
    page,
  }) => {
    await open(page, `${TEXT}\n\n\`\`\`js\nconst x = 1;\n\`\`\`\n`);
    await preview(page).getByRole('link', { name: 'link' }).click();
    await preview(page).locator('summary').click();
    await preview(page).locator('.task-checkbox').first().scrollIntoViewIfNeeded();
    await expect(position(page)).toHaveText('Ln 1, Col 1');
    await preview(page).locator('.code-card').first().scrollIntoViewIfNeeded();
    await preview(page).locator('.code-copy').first().click();
    await expect(position(page)).toHaveText('Ln 1, Col 1');
  });

  test('C10 selecting text does not move the caret, and Preview view does nothing', async ({
    page,
  }) => {
    await open(page);
    const box = await preview(page).getByText('First paragraph').boundingBox();
    if (!box) throw new Error('no box');
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    expect(
      await page.evaluate(() => window.getSelection()?.toString().length ?? 0),
    ).toBeGreaterThan(0);
    await expect(position(page)).toHaveText('Ln 1, Col 1');
  });

  test('C10 sync scroll does not bounce the preview when the editor jumps', async ({ page }) => {
    await open(page);
    const scroller = page.getByTestId('preview-scroll');
    await scroller.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(500);
    const last = preview(page).getByText('Target paragraph far down.');
    await last.click();
    const before = await scroller.evaluate((el) => el.scrollTop);
    await page.waitForTimeout(800);
    const after = await scroller.evaluate((el) => el.scrollTop);
    expect(Math.abs(after - before)).toBeLessThan(2);
  });
});

test.describe('wikilink wiring', () => {
  test('a wikilink without an href (drawn before the index) opens the note on click', async ({
    page,
  }) => {
    const seed = vaultSeed();
    const home = `${VAULT_ROOT}/Home.md`;
    await page.setViewportSize({ width: 1280, height: 800 });
    await launch(page, { seed: seed as never, open: home, view: 'split' });
    await expect(preview(page).locator('.wd-block').first()).toBeVisible();
    // Make a resolved link look as if it was drawn before the index arrived: no href.
    const link = preview(page).locator('a.wikilink[href]').first();
    await expect(link).toBeVisible();
    const target = await link.getAttribute('data-target');
    expect(target).not.toBeNull();
    await link.evaluate((el) => {
      el.removeAttribute('href');
      el.classList.add('is-unresolved');
    });
    await link.click();
    await expect(page.getByTestId('document-name')).not.toHaveText('Home.md');
    await expect(page.getByTestId('document-name')).toContainText(
      (target as string).split('/').pop() as string,
    );
  });
});
