/**
 * The Quarto / RMD pack in the shell: the guide, chunk
 * cards, cross-reference links, tabsets by keyboard, folded callouts, label completion and the
 * Insert menu.
 */
import { expect, type Page, test } from '@playwright/test';
import { editor, fixture, HOME, menu, preview, seedMock } from './helpers';

const DIR = `${HOME}/q`;
const files = () => ({
  [`${DIR}/chunks.qmd`]: fixture('flavors/quarto/chunks.qmd'),
  [`${DIR}/layout.qmd`]: fixture('flavors/quarto/layout.qmd'),
  [`${DIR}/crossref.qmd`]: fixture('flavors/quarto/crossref.qmd'),
});

async function open(page: Page, name: string, view: 'split' | 'preview' = 'preview') {
  await seedMock(page, { files: files(), launch: { openPath: `${DIR}/${name}`, view } });
  await page.goto('/');
  await expect(page.getByTestId('document-name')).toHaveText(name);
}

test.describe('Quarto', () => {
  test('the guide renders as Quarto with no console error', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await open(page, 'chunks.qmd', 'split');
    await menu(page, 'markdown-guide');
    await expect(page.getByTestId('document-name')).toHaveText('Quarto / RMD Guide');
    await expect(page.getByTestId('flavor-note')).toHaveCount(0);
    await expect(preview(page).locator('.tabset-tabs').first()).toBeVisible();
    await expect(preview(page).locator('details.callout').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a chunk card shows the label and option pills', async ({ page }) => {
    await open(page, 'chunks.qmd');
    const card = preview(page).locator('.code-chunk[data-label="setup"]');
    await expect(card).toBeVisible();
    await expect(card.locator('.chunk-label')).toHaveText('setup');
    await expect(card.locator('.chunk-option')).toHaveText(['include: FALSE']);
    await expect(preview(page).locator('figure.chunk-figure')).toHaveCount(2);
  });

  test('a cross-reference link scrolls to its figure', async ({ page }) => {
    await open(page, 'crossref.qmd');
    const link = preview(page).locator('a.xref[href="#eq-a"]');
    await expect(link).toHaveText('Equation 1');
    await link.click();
    await expect(preview(page).locator('#eq-a')).toBeInViewport();
  });

  test('tabs move with the arrow keys', async ({ page }) => {
    await open(page, 'layout.qmd');
    const tabs = preview(page).locator('[role="tab"]');
    await expect(tabs).toHaveText(['Tab One', 'Tab Two', 'Tab Three']);
    await tabs.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(preview(page).locator('.tabset-panel').nth(1)).toBeVisible();
    await expect(preview(page).locator('.tabset-panel').first()).toBeHidden();
    await page.keyboard.press('End');
    await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
  });

  test('a collapsed callout opens', async ({ page }) => {
    await open(page, 'layout.qmd');
    const callout = preview(page).locator('details.callout-caution');
    await expect(callout).not.toHaveAttribute('open', '');
    await callout.locator('summary').click();
    await expect(callout).toHaveAttribute('open', '');
  });

  test('@fig- lists the figure labels', async ({ page }) => {
    await open(page, 'crossref.qmd', 'split');
    await expect(preview(page).locator('#fig-a')).toBeVisible();
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('\n\nSee @fig-');
    const popup = page.locator('.cm-tooltip-autocomplete');
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('fig-a');
    await expect(popup).toContainText('fig-b');
    // CodeMirror ignores Enter for 75 ms after the list changes (interactionDelay).
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await expect(editor(page)).toContainText('See @fig-a');
  });

  test('the Insert menu has the Quarto inserts', async ({ page }) => {
    await open(page, 'chunks.qmd', 'split');
    await page.getByTestId('tool-insert').click();
    await expect(page.getByTestId('insert-menu').getByRole('menuitem')).toHaveText([
      'Citation',
      'Footnote',
      'Fenced div',
      'Definition list',
      'Superscript',
      'Subscript',
      'Code chunk: R',
      'Code chunk: Python',
      'Code chunk: Julia',
      'Code chunk: SQL',
      'Callout',
      'Cross-reference',
      'Tabset',
      'Figure with label',
    ]);
  });
});
