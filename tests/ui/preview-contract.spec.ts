/**
 * The HTML structure contract of the preview, checked in real WebKit on
 * the harness page: the GFM guide with everything it has, source lines, task lines, heading ids,
 * keyed updates, images, the Copy button and the cursor block. Run with WD_UI_PORT=1433.
 */
import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

const GUIDE = readFileSync(new URL('../../src/content/guides/gfm.md', import.meta.url), 'utf8');

const preview = (page: Page) => page.getByTestId('preview');

async function mount(page: Page, text: string, extra: Record<string, unknown> = {}) {
  await page.goto('/tests/harness/preview.html');
  await page.waitForFunction(() => window.__harness !== undefined);
  await page.evaluate(
    async ({ text, extra }) => {
      await window.__harness.mount({ text, ...extra });
      await window.__harness.settled();
    },
    { text, extra },
  );
}

test.describe('the GFM guide', () => {
  test.beforeEach(async ({ page }) => {
    await mount(page, GUIDE);
  });

  test('blocks are wrappers with data-line, data-end-line and data-key', async ({ page }) => {
    const wrappers = preview(page).locator(
      ':scope > div.wd-block[data-line][data-end-line][data-key]',
    );
    const count = await wrappers.count();
    const children = await preview(page).locator(':scope > *').count();
    expect(count).toBeGreaterThan(80);
    expect(count).toBe(children);
  });

  test('data-line values increase and match the source (footnotes move to the end)', async ({
    page,
  }) => {
    const lines = GUIDE.split('\n');
    const blocks = await preview(page)
      .locator(':scope > .wd-block')
      .evaluateAll((elements) =>
        elements.map((el) => ({
          line: Number(el.getAttribute('data-line')),
          end: Number(el.getAttribute('data-end-line')),
          footnotes: el.querySelector('section.footnotes') !== null,
        })),
      );
    let previous = -1;
    for (const block of blocks) {
      if (block.footnotes) {
        // markdown-it-footnote moves the definitions to the end; the block keeps their lines.
        expect(lines[block.line]).toMatch(/^\[\^\d+\]:/);
        continue;
      }
      expect(block.line).toBeGreaterThan(previous);
      expect(block.end).toBeGreaterThanOrEqual(block.line);
      expect((lines[block.line] ?? '').trim(), `line ${block.line}`).not.toBe('');
      expect((lines[block.end] ?? '').trim(), `end line ${block.end}`).not.toBe('');
      previous = block.end;
    }
  });

  test('the frontmatter header has tags and the version, and no title (the guide has an H1)', async ({
    page,
  }) => {
    const header = preview(page).locator('.wd-block:first-child > header.wd-frontmatter');
    await expect(header.locator('.wd-tag')).toHaveText(['#markdown', '#gfm', '#reference']);
    await expect(header.locator('.wd-frontmatter-info').first()).toHaveText('Version 1.0.0');
    await expect(header.locator('h1')).toHaveCount(0);
  });

  test('headings carry GitHub-style ids, also those that are names of document properties', async ({
    page,
  }) => {
    for (const id of ['markdown-guide', 'headings', 'links', 'images']) {
      await expect(preview(page).locator(`[id="${id}"]`), id).toHaveCount(1);
    }
    const ids = await preview(page)
      .locator('h1, h2, h3, h4, h5, h6')
      .evaluateAll((els) => els.map((el) => el.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('repeated heading text gets numbered ids (a small inline document)', async ({ page }) => {
    await mount(page, '# Title\n\n## Links\n\n## Images\n\n## Links\n\n## Images\n');
    for (const id of ['title', 'links', 'links-1', 'images', 'images-1']) {
      await expect(preview(page).locator(`[id="${id}"]`), id).toHaveCount(1);
    }
  });

  test('task items: span checkboxes with role, state, tabindex and the source line', async ({
    page,
  }) => {
    const lines = GUIDE.split('\n');
    const boxes = preview(page).locator(
      'li.task-list-item span.task-checkbox[role="checkbox"][tabindex="0"][data-task-line]',
    );
    expect(await boxes.count()).toBe(5);
    const info = await boxes.evaluateAll((els) =>
      els.map((el) => ({
        checked: el.getAttribute('aria-checked'),
        line: Number(el.getAttribute('data-task-line')),
        itemLine: Number(el.closest('li')?.getAttribute('data-line')),
      })),
    );
    // Rendered task list: the second one in the file (the first is inside a code fence).
    for (const box of info) {
      expect(box.line).toBe(box.itemLine);
      const text = lines[box.line] ?? '';
      expect(text).toMatch(/^\s*- \[([ x])\]/);
      expect(text.includes('[x]')).toBe(box.checked === 'true');
    }
    await expect(preview(page).locator('input')).toHaveCount(0);
  });

  test('alerts of all five types have an icon, a title and the text', async ({ page }) => {
    for (const [type, title] of [
      ['note', 'Note'],
      ['tip', 'Tip'],
      ['important', 'Important'],
      ['warning', 'Warning'],
      ['caution', 'Caution'],
    ] as const) {
      const callout = preview(page).locator(`div.callout.callout-${type}`);
      await expect(callout).toHaveCount(1);
      await expect(callout.locator('> p.callout-title')).toHaveText(title);
      await expect(
        callout.locator('> p.callout-title > span.callout-icon[data-icon] > svg'),
      ).toHaveCount(1);
    }
  });

  test('code cards: language label, Copy button and token colors', async ({ page }) => {
    const card = preview(page).locator('div.code-card[data-lang="typescript"]');
    await expect(card.locator('> .code-card-header > .code-card-lang')).toHaveText('TypeScript');
    await expect(card.locator('.code-card-actions button.code-copy')).toHaveText('Copy');
    await expect(card.locator('pre > code .tok-keyword').first()).toBeVisible();
    await expect(card.locator('pre > code .tok-string').first()).toBeVisible();
    await expect(
      preview(page).locator('div.code-card[data-lang="python"] .tok-keyword').first(),
    ).toBeVisible();
    // No language: plain text label, no colors.
    const plain = preview(page).locator('div.code-card[data-lang=""]').first();
    await expect(plain.locator('.code-card-lang')).toHaveText('Text');
    await expect(plain.locator('[class^="tok-"]')).toHaveCount(0);
    // The card is dark in the light theme too.
    const background = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(background).toBe('rgb(30, 30, 36)');
  });

  test('tables have alignment classes and no inline styles', async ({ page }) => {
    const table = preview(page).locator('table');
    await expect(table).toHaveCount(1);
    await expect(table.locator('thead th')).toHaveClass([
      'align-left',
      'align-center',
      'align-right',
    ]);
    expect(await preview(page).locator('[style]').count()).toBe(0);
  });

  test('math is MathML after KaTeX has loaded, and the formulas are marked', async ({ page }) => {
    await expect(
      preview(page).locator('span.math.math-inline[data-tex="E = mc^2"] math'),
    ).toHaveCount(1);
    await expect(
      preview(page).locator('div.math.math-display[data-tex] math[display="block"]'),
    ).toHaveCount(2);
    expect(await page.evaluate(() => window.__harness.result?.features.math)).toBe(true);
  });

  test('footnotes, emoji, strikethrough and autolinks', async ({ page }) => {
    await expect(preview(page).locator('sup.footnote-ref a')).toHaveCount(2);
    await expect(preview(page).locator('section.footnotes li.footnote-item')).toHaveCount(2);
    await expect(
      preview(page).getByText('You can use emoji shortcodes like \u{1F389} and \u{1F680}'),
    ).toHaveCount(1);
    await expect(preview(page).locator('del')).toHaveText('strikethrough');
    await expect(preview(page).locator('a[href="https://example.org"]').first()).toBeVisible();
  });

  test('an image with a data address stays; there is no network or file access', async ({
    page,
  }) => {
    const image = preview(page).locator('img[alt="Sample PNG"]');
    await expect(image).toHaveAttribute('src', /^data:image\/png;base64,/);
  });
});

test.describe('lines of nested elements', () => {
  test('list items and table rows carry their lines, and they follow when the block moves', async ({
    page,
  }) => {
    const text = '# T\n\n- a\n- b\n  - c\n\n| h |\n| - |\n| r |\n';
    await mount(page, text);
    const lines = () =>
      preview(page)
        .locator('li[data-line], tr[data-line]')
        .evaluateAll((els) => els.map((el) => `${el.tagName}:${el.getAttribute('data-line')}`));
    expect(await lines()).toEqual(['LI:2', 'LI:3', 'LI:4', 'TR:6', 'TR:8']);
    const items = await preview(page).locator('li').elementHandles();

    await page.evaluate((next) => window.__harness.setText(next), `extra\n\n${text}`);
    await page.evaluate(() => window.__harness.settled());
    // The blocks only moved two lines down: same elements, new line numbers.
    expect(await lines()).toEqual(['LI:4', 'LI:5', 'LI:6', 'TR:8', 'TR:10']);
    const after = await preview(page).locator('li').elementHandles();
    for (let i = 0; i < items.length; i++) {
      expect(await page.evaluate(([a, b]) => a === b, [items[i], after[i]] as const)).toBe(true);
    }
  });

  test('task lines are right for nested, numbered and quoted items', async ({ page }) => {
    const text = '- [x] one\n  - [ ] two\n\n1. [ ] three\n\n> - [x] four\n';
    await mount(page, text);
    const lines = await preview(page)
      .locator('.task-checkbox')
      .evaluateAll((els) => els.map((el) => Number(el.getAttribute('data-task-line'))));
    expect(lines).toEqual([0, 1, 3, 5]);
  });
});

test.describe('updates', () => {
  test('after an edit only the changed block element is replaced', async ({ page }) => {
    const text = '# One\n\nfirst paragraph\n\nsecond paragraph\n\n- item\n\nlast\n';
    await mount(page, text);
    const before = await page.evaluate(() => window.__harness.wrappers());
    expect(before.length).toBe(5);
    await page.evaluate(() => {
      const w = window as unknown as { __before: Element[] };
      w.__before = window.__harness.wrappers();
      window.__harness.setText(
        window.__harness.text.replace('second paragraph', 'second paragraph, edited'),
      );
    });
    const result = await page.evaluate(() => {
      const w = window as unknown as { __before: Element[] };
      const after = window.__harness.wrappers();
      return after.map((el, i) => el === w.__before[i]);
    });
    expect(result).toEqual([true, true, false, true, true]);
    await expect(preview(page)).toContainText('second paragraph, edited');
  });

  test('inserting a line above keeps every element and moves the lines', async ({ page }) => {
    await mount(page, 'a\n\nb\n\nc\n');
    await page.evaluate(() => {
      const w = window as unknown as { __before: Element[] };
      w.__before = window.__harness.wrappers();
      window.__harness.setText(`new first\n\n${window.__harness.text}`);
    });
    const info = await page.evaluate(() => {
      const w = window as unknown as { __before: Element[] };
      const after = window.__harness.wrappers();
      return after.map((el, i) => ({
        same: i > 0 && el === w.__before[i - 1],
        line: el.getAttribute('data-line'),
      }));
    });
    expect(info).toEqual([
      { same: false, line: '0' },
      { same: true, line: '2' },
      { same: true, line: '4' },
      { same: true, line: '6' },
    ]);
  });
});

test.describe('images', () => {
  const PIXEL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  test('a relative image is requested through resolveImage and shown; a failure shows the placeholder', async ({
    page,
  }) => {
    await mount(
      page,
      '![ok](pics/a.png)\n\n![gone](pics/missing.png)\n\n<img src="b.png" alt="raw">',
      {
        images: { 'pics/a.png': PIXEL, 'b.png': PIXEL },
      },
    );
    await expect(preview(page).locator('img[alt="ok"]')).toHaveAttribute('src', PIXEL);
    await expect(preview(page).locator('img[alt="raw"]')).toHaveAttribute('src', PIXEL);
    await expect(preview(page).locator('img[alt="gone"]')).toHaveCount(0);
    const placeholder = preview(page).locator('.wd-image-missing');
    await expect(placeholder).toHaveCount(1);
    await expect(placeholder).toHaveAttribute('aria-label', 'Image not found: gone');
  });

  test('http and file-scheme addresses never load by themselves', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await mount(page, '![a](http://example.invalid/a.png)\n\n![b](pics/b.png)\n');
    await expect(preview(page).locator('.wd-image-missing')).toHaveCount(2);
    expect(
      requests.filter((url) => url.includes('example.invalid') || url.includes('b.png')),
    ).toEqual([]);
  });
});

test.describe('the Copy button', () => {
  test('copies the code, shows Copied for 1.5 seconds, then Copy again', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __copied: string[] }).__copied = [];
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async (text: string) =>
            (window as unknown as { __copied: string[] }).__copied.push(text),
        },
        configurable: true,
      });
    });
    await mount(page, '```js\nconst a = 1;\n```\n');
    const button = preview(page).locator('.code-copy');
    await expect(button).toHaveText('Copy');
    await button.click();
    await expect(button).toHaveText('Copied');
    expect(
      await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied),
    ).toEqual(['const a = 1;\n']);
    await expect(button).toHaveText('Copy', { timeout: 4000 });
  });

  test('is focusable with the keyboard and shows a focus ring', async ({ page }) => {
    await mount(page, '```js\nx\n```\n');
    // WebKit on macOS reaches buttons with Option+Tab unless the system setting is on.
    await page.keyboard.press('Alt+Tab');
    const button = preview(page).locator('.code-copy');
    await expect(button).toBeFocused();
    const outline = await button.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).toBe('solid');
  });
});

test.describe('the cursor block', () => {
  test('the block that contains the line is marked, and nothing for a line between blocks', async ({
    page,
  }) => {
    await mount(page, '# Title\n\npara one\nstill one\n\npara two\n');
    const marked = () =>
      preview(page)
        .locator('.is-cursor-block')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-line')));
    await page.evaluate(() => window.__harness.controller.highlightLine(3));
    expect(await marked()).toEqual(['2']);
    await page.evaluate(() => window.__harness.controller.highlightLine(4));
    expect(await marked()).toEqual([]);
    await page.evaluate(() => window.__harness.controller.highlightLine(5));
    expect(await marked()).toEqual(['5']);
    await page.evaluate(() => window.__harness.controller.highlightLine(null));
    expect(await marked()).toEqual([]);
  });
});

test.describe('the pipeline with a frozen Object.prototype (as Tauri freezePrototype does)', () => {
  test('renders the whole guide: YAML, footnotes, emoji, math, colors', async ({ page }) => {
    await page.addInitScript(() => {
      Object.freeze(Object.prototype);
    });
    await mount(page, GUIDE);
    await expect(preview(page).locator('.wd-tag')).toHaveCount(3);
    await expect(preview(page).locator('section.footnotes')).toHaveCount(1);
    await expect(preview(page).locator('math')).toHaveCount(3);
    await expect(
      preview(page).locator('div.code-card[data-lang="typescript"] .tok-keyword').first(),
    ).toBeVisible();
  });
});
