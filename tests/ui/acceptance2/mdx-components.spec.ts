/**
 * Phase 2 acceptance, MDX: B23 and B24.
 * Expected values are read from the fixture sources (`tests/fixtures/flavors/mdx/`). Run with
 * WD_UI_PORT=1451.
 */
import { test } from '@playwright/test';
import {
  DOCS,
  editorText,
  expect,
  fixture,
  insertAt,
  launch,
  openDoc,
  preview,
  replaceRange,
  squash,
  texts,
} from './support-b2';

const COMPONENTS = fixture('flavors/mdx/components.mdx');
const path = `${DOCS}/components.mdx`;

async function openComponents(page: import('@playwright/test').Page) {
  await openDoc({ page, path, text: COMPONENTS });
  await expect(preview(page).locator('.footnotes')).toBeAttached();
}

test.describe('B23 MDX rendering', () => {
  test('B23 the document is detected as MDX', async ({ page }) => {
    await openComponents(page);
    await expect(page.getByTestId('status-flavor')).toHaveText('MDX');
  });

  test('B23 import and export lines are collapsed, dimmed and shown as JavaScript', async ({
    page,
  }) => {
    await openComponents(page);
    const esm = preview(page).locator('details.mdx-esm');
    // Two ESM blocks in the fixture: the two imports (2 lines) and the export (4 lines).
    expect((await esm.locator(':scope > summary').allTextContents()).map(squash)).toEqual([
      'import and export, 2 lines',
      'import and export, 4 lines',
    ]);
    for (let i = 0; i < 2; i++) {
      await expect(esm.nth(i)).not.toHaveAttribute('open', '');
      await expect(esm.nth(i).locator('.code-card-lang')).toHaveText('JavaScript');
    }
    // Dimmed: lighter than the body text (opacity below 1, or a different color).
    const dim = await esm.first().evaluate((el) => {
      const own = getComputedStyle(el);
      const body = getComputedStyle(document.querySelector('[data-testid="preview"] p') as Element);
      return Number(own.opacity) < 1 || own.color !== body.color;
    });
    expect(dim).toBe(true);
    // The code inside is the source of the lines.
    await esm.first().locator('summary').click();
    expect(squash(await esm.first().locator('pre code').textContent())).toBe(
      "import { someComponent } from './module' import React from 'react'",
    );
    // Collapsed ESM is not counted in the status bar words (checked by B05); here: not visible text.
    await expect(esm.nth(1).locator('pre')).toBeHidden();
  });

  test('B23 a component is a box with its name, props (literal source) and Markdown children', async ({
    page,
  }) => {
    await openComponents(page);
    const callout = preview(page).locator('div.mdx-component[data-name="Callout"]');
    await expect(callout).toHaveCount(1);
    await expect(callout.locator(':scope > .mdx-component-header .mdx-component-name')).toHaveText(
      'Callout',
    );
    const props = (await callout.locator('.mdx-props > .mdx-prop').allTextContents()).map(squash);
    // type="info" count={3} open: the value is shown as written, a bare prop has no value.
    expect(props).toEqual(['type="info"', 'count={3}', 'open']);
    const children = callout.locator(':scope > .mdx-component-children');
    await expect(children.locator('p strong')).toHaveText('bold');
    expect(await children.locator('li').allTextContents()).toEqual(['List item 1', 'List item 2']);

    const chart = preview(page).locator('div.mdx-component[data-name="Chart"]');
    expect((await chart.locator('.mdx-prop').allTextContents()).map(squash)).toEqual([
      'data={[1, 2, 3]}',
      'title="Sales"',
    ]);
    // A self-closing component has no children text.
    expect(
      squash((await chart.locator('.mdx-component-children').allTextContents()).join('')),
    ).toBe('');
  });

  test('B23 components nest and inline components sit in the line of text', async ({ page }) => {
    await openComponents(page);
    const tabs = preview(page).locator('div.mdx-component[data-name="Tabs"]');
    await expect(tabs.locator('.mdx-component[data-name="Tab"]')).toHaveCount(1);
    await expect(tabs.locator('.mdx-component[data-name="Tab"] .mdx-prop')).toHaveText([
      'label="A"',
    ]);
    const kbd = preview(page).locator('span.mdx-component.is-inline[data-name="Kbd"]');
    await expect(kbd).toHaveCount(1);
    await expect(kbd.locator('.mdx-component-children')).toHaveText('Cmd');
    // It is inside the paragraph "Press ... now.".
    const paragraph = kbd.locator('xpath=ancestor::p');
    expect(squash(await paragraph.textContent())).toMatch(/^Press\s+Kbd\s*Cmd\s+now\.$/);
  });

  test('B23 lower-case HTML renders, with its class namespaced', async ({ page }) => {
    await openComponents(page);
    await expect(preview(page).locator('div.doc-note')).toHaveText('plain');
    await expect(preview(page).locator('div.note')).toHaveCount(0);
    const details = preview(page).locator('details:not(.mdx-esm)');
    await expect(details.locator('summary')).toHaveText('More');
    await expect(details).toContainText('Hidden');
  });

  test('B23 expressions are shown as code and never evaluated', async ({ page }) => {
    await openComponents(page);
    expect(await texts(page, 'code.mdx-expression')).toEqual(['{1 + 1}', '{props.name}']);
    const paragraph = preview(page)
      .locator('p', { has: page.locator('code.mdx-expression') })
      .first();
    expect(squash(await paragraph.textContent())).toBe('{1 + 1}');
  });

  test('B23 GFM inside MDX: table, tasks, strikethrough, footnote and math', async ({ page }) => {
    await openComponents(page);
    const table = preview(page).locator('table');
    expect(await table.locator('th').allTextContents()).toEqual(['Header 1', 'Header 2']);
    expect(await table.locator('td').allTextContents()).toEqual(['Cell 1', 'Cell 2']);
    const boxes = preview(page).locator('span.task-checkbox');
    await expect(boxes).toHaveCount(2);
    await expect(boxes.nth(0)).toHaveAttribute('aria-checked', 'true');
    await expect(boxes.nth(1)).toHaveAttribute('aria-checked', 'false');
    await expect(preview(page).locator('del')).toHaveText('strike');
    await expect(preview(page).locator('.footnotes li')).toContainText('This is a footnote.');
    await expect(preview(page).locator('sup.footnote-ref a')).toHaveAttribute('href', '#fn1');
    await expect(preview(page).locator('.math math')).toHaveCount(1);
  });

  test('B23 a brace comment at the top and the frontmatter produce no visible text', async ({
    page,
  }) => {
    await openComponents(page);
    expect((await preview(page).textContent()) ?? '').not.toContain('Fixture for MDX');
  });
});

// ---- B24 parse errors --------------------------------------------------------------------------

const errorPath = `${DOCS}/error.mdx`;

test.describe('B24 MDX parse errors', () => {
  test('B24 the fixture with an unclosed tag shows the banner with its line', async ({ page }) => {
    // error.mdx: the unclosed <Callout> opens on line 15 (counted from the file).
    const source = fixture('flavors/mdx/error.mdx');
    const line = source.split('\n').findIndex((l) => l.startsWith('<Callout>')) + 1;
    expect(line).toBe(15);
    await launch(page, {
      seed: { files: { [errorPath]: source } },
      open: errorPath,
      view: 'split',
    });
    await expect(page.locator('.mdx-error-banner')).toBeVisible();
    await expect(page.locator('.mdx-error-banner')).toContainText(`MDX error on line ${line}:`);
    await expect(page.locator('.mdx-error-banner button')).toBeVisible();
  });

  test('B24 an error keeps the last good preview; the button moves the caret; fixing removes the banner', async ({
    page,
  }) => {
    await launch(page, {
      seed: { files: { [path]: COMPONENTS } },
      open: path,
      view: 'split',
    });
    await expect(preview(page).locator('.footnotes')).toBeAttached();
    const before = await preview(page).locator('.wd-block').count();
    await expect(page.locator('.mdx-error-banner')).toHaveCount(0);

    // Break it: an unclosed component at the end of the document.
    const base = await editorText(page);
    const brokenLine = base.split('\n').length + 2; // after the final newline and a blank line
    await insertAt(page, base.length, '\n<Broken>\n');
    const added = (await editorText(page)).split('\n').indexOf('<Broken>') + 1;
    expect(added).toBeGreaterThan(brokenLine - 3);
    const bar = page.locator('.mdx-error-banner');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText(`MDX error on line ${added}:`);
    // The last good blocks are still shown.
    expect(await preview(page).locator('.wd-block').count()).toBe(before);
    await expect(preview(page).locator('h1#heading')).toHaveText('Heading');
    await expect(preview(page).locator('div.mdx-component[data-name="Callout"]')).toHaveCount(1);

    // The button moves the caret to the line.
    await bar.getByRole('button').click();
    await expect(page.getByTestId('status-position')).toHaveText(new RegExp(`^Ln ${added}, Col `));

    // Fix it: the banner goes and the new component shows.
    const text = await editorText(page);
    await replaceRange(page, text.indexOf('<Broken>'), text.length, '<Broken>fixed</Broken>\n');
    await expect(bar).toHaveCount(0);
    await expect(
      preview(page).locator(
        'div.mdx-component[data-name="Broken"], span.mdx-component[data-name="Broken"]',
      ),
    ).toHaveCount(1);
  });

  test('B24 a broken expression is reported too, and the banner sits above the blocks', async ({
    page,
  }) => {
    const source = '# Title\n\nSome text.\n\n{1 +}\n';
    await launch(page, {
      seed: { files: { [`${DOCS}/expr.mdx`]: source } },
      open: `${DOCS}/expr.mdx`,
      view: 'split',
    });
    const bar = page.locator('.mdx-error-banner');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('MDX error on line 5:');
    const order = await page.evaluate(() => {
      const b = document.querySelector('.mdx-error-banner') as Element;
      const first = document.querySelector('[data-testid="preview"] .wd-block');
      if (!first) return 'no blocks';
      return b.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING
        ? 'above'
        : 'below';
    });
    expect(['above', 'no blocks']).toContain(order);
  });
});
