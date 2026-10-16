/** List markers in the preview: Tailwind's reset removes them, the preview puts them back. */
import { expect, test } from '@playwright/test';
import { HOME, preview, seedMock } from './helpers';

const DOC = `${HOME}/Documents/lists.md`;

const markers = (elements: Element[]) =>
  elements.map((element) => [element.tagName, getComputedStyle(element).listStyleType]);

test('bullets and numbers show, nested bullets change shape, task lists stay plain', async ({
  page,
}) => {
  await seedMock(page, {
    files: { [DOC]: '- one\n  - two\n    - three\n\n1. first\n2. second\n\n- [ ] task\n' },
    launch: { openPath: DOC, view: 'preview' },
  });
  await page.goto('/');
  await expect(preview(page)).toContainText('second');

  expect(await preview(page).locator('ul, ol').evaluateAll(markers)).toEqual([
    ['UL', 'disc'],
    ['UL', 'circle'],
    ['UL', 'square'],
    ['OL', 'decimal'],
    ['UL', 'none'],
  ]);
});

test('a Pandoc fancy list keeps its letters and roman numerals', async ({ page }) => {
  await seedMock(page, {
    files: { [DOC]: 'a. alpha\nb. beta\n\nA) upper\nB) upper too\n\niv. four\nv. five\n' },
    launch: { openPath: DOC, view: 'preview' },
    settings: { defaultFlavor: 'pandoc', preview: { autoDetectFlavor: false } },
  });
  await page.goto('/');
  await expect(preview(page)).toContainText('five');

  expect(await preview(page).locator('ol').evaluateAll(markers)).toEqual([
    ['OL', 'lower-alpha'],
    ['OL', 'upper-alpha'],
    ['OL', 'lower-roman'],
  ]);
});
