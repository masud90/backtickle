/**
 * The Pandoc / MMD pack in the shell: the guide, citations
 * with BibTeX and CSL JSON bibliographies, the lazy chunks, key completion and the Insert menu.
 */
import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { editor, fixture, HOME, menu, preview, seedMock } from './helpers';

const DIR = `${HOME}/papers`;
const DOC = `${DIR}/citations.md`;
const JSON_DOC = `${DIR}/citations-json.md`;
const expectedTxt = readFileSync(
  new URL('../fixtures/flavors/pandoc/expected/citations.txt', import.meta.url),
  'utf8',
);
const [bodyText, listText] = expectedTxt.split(/\n\nBrown, Alice/) as [string, string];
const paragraphs = bodyText.split(/\n\n/);
const references = `Brown, Alice${listText}`.split(/\n\n/);

const files = () => ({
  [DOC]: fixture('flavors/pandoc/citations.md'),
  [JSON_DOC]: fixture('flavors/pandoc/citations-json.md'),
  [`${DIR}/refs.bib`]: fixture('flavors/pandoc/refs.bib'),
  [`${DIR}/refs.json`]: fixture('flavors/pandoc/refs.json'),
  [`${HOME}/plain.md`]: '# Plain\n\nJust text.\n',
});

async function open(page: Page, path: string, view: 'split' | 'preview' = 'split') {
  await seedMock(page, { files: files(), launch: { openPath: path, view } });
}

/** Records the requests that load a pack chunk or the BibTeX parser. */
function watchChunks(page: Page) {
  const urls: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (
      /packs\/pandoc|bibliography\/bibtex|bibtex-parser|\/bibtex-|editor\/snippets|shell\/snippets|\/snippets-/.test(
        url,
      )
    )
      urls.push(url);
  });
  return {
    pandoc: () => urls.filter((url) => /packs\/pandoc|\/pandoc-/.test(url)),
    snippets: () => urls.filter((url) => /editor\/snippets|shell\/snippets|\/snippets-/.test(url)),
    bibtex: () => urls.filter((url) => /bibliography\/bibtex|bibtex-parser|\/bibtex-/.test(url)),
  };
}

// We keep the hyphen of a page range as written; Pandoc prints an en dash (WP2.2b interpretation).
const text = (value: string | null) =>
  (value ?? '')
    .replace(/\u2013/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

test.describe('Pandoc guide', () => {
  test('renders as Pandoc: no "Renders as GFM" note and no console error', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await seedMock(page, {
      files: { [`${DIR}/notes.mmd`]: 'Title: Notes\n\nBody.\n' },
      launch: { openPath: `${DIR}/notes.mmd`, view: 'split' },
    });
    await page.goto('/');
    await expect(page.getByTestId('document-name')).toHaveText('notes.mmd');
    await menu(page, 'markdown-guide');
    await expect(page.getByTestId('document-name')).toHaveText('Pandoc / MMD Guide');
    await expect(page.getByTestId('flavor-pill')).toContainText('Pandoc / MMD');
    await expect(page.getByTestId('flavor-note')).toHaveCount(0);
    await expect(preview(page).locator('h1, h2').first()).toBeVisible();
    await expect(preview(page)).not.toContainText('Renders as GFM');
    expect(errors).toEqual([]);
  });
});

test.describe('Pandoc citations', () => {
  test('citations.md with refs.bib shows the expected texts and the reference list', async ({
    page,
  }) => {
    const chunks = watchChunks(page);
    await open(page, DOC, 'preview');
    await page.goto('/');
    await expect(page.getByTestId('document-name')).toHaveText('citations.md');
    await expect(page.getByTestId('flavor-pill')).toContainText('Pandoc / MMD');
    const entries = preview(page).locator('div.references#refs > div.reference');
    await expect(entries).toHaveCount(references.length);

    const shown = await preview(page)
      .locator('p')
      .evaluateAll((nodes) =>
        nodes.map((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim()),
      );
    // The missing key and the MultiMarkdown form are marked our way; the rest is Pandoc's.
    for (const paragraph of paragraphs) {
      if (/missing key|MultiMarkdown/.test(paragraph)) continue;
      expect(shown.map(text), paragraph).toContain(text(paragraph));
    }
    await expect(preview(page).locator('span.citation.citation-missing')).toHaveText(
      '(@missingkey?)',
    );
    const listed = await entries.evaluateAll((nodes) =>
      nodes.map((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim()),
    );
    expect(listed.map(text)).toEqual(references.map(text));
    // `link-citations: true`: the citation links to its entry.
    await expect(
      preview(page).locator('span.citation a[href="#ref-smith2020"]').first(),
    ).toBeVisible();
    // The BibTeX parser was loaded for the .bib file; nothing is still pending.
    expect(chunks.bibtex().length).toBeGreaterThan(0);
    await expect(preview(page).locator('.citation.is-pending')).toHaveCount(0);
  });

  test('refs.json loads no BibTeX chunk and gives the same list', async ({ page }) => {
    const chunks = watchChunks(page);
    await open(page, JSON_DOC, 'preview');
    await page.goto('/');
    await expect(page.getByTestId('document-name')).toHaveText('citations-json.md');
    const entries = preview(page).locator('div.references#refs > div.reference');
    await expect(entries).toHaveCount(references.length);
    const listed = await entries.evaluateAll((nodes) =>
      nodes.map((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim()),
    );
    expect(listed.map(text)).toEqual(references.map(text));
    expect(chunks.pandoc().length).toBeGreaterThan(0);
    expect(chunks.bibtex()).toEqual([]);
  });

  test('a GFM document loads neither the Pandoc nor the BibTeX chunk (B30)', async ({ page }) => {
    const chunks = watchChunks(page);
    await open(page, `${HOME}/plain.md`, 'preview');
    await page.goto('/');
    await expect(page.getByTestId('document-name')).toHaveText('plain.md');
    await expect(preview(page).getByRole('heading', { name: 'Plain' })).toBeVisible();
    await expect(page.getByTestId('flavor-pill')).toContainText('GFM');
    expect(chunks.pandoc()).toEqual([]);
    expect(chunks.snippets()).toEqual([]);
    expect(chunks.bibtex()).toEqual([]);
  });
});

/** The relative luminance of an `rgb()` or `rgba()` computed color. */
function contrastOf(page: Page) {
  return page.evaluate(() => {
    const row = document.querySelector('.cm-tooltip-autocomplete li[aria-selected]');
    if (!row) return null;
    const parse = (value: string): number[] => {
      const found = value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
      return [found[0] ?? 0, found[1] ?? 0, found[2] ?? 0, found[3] ?? 1];
    };
    const background = (element: Element | null): number[] => {
      let layers: number[][] = [];
      for (let node = element; node; node = node.parentElement) {
        const color = parse(getComputedStyle(node).backgroundColor);
        if ((color[3] as number) > 0) layers.push(color);
        if (color[3] === 1) break;
      }
      let result = [255, 255, 255];
      for (const layer of layers.reverse()) {
        const alpha = layer[3] as number;
        result = result.map((channel, i) => (layer[i] as number) * alpha + channel * (1 - alpha));
      }
      layers = [];
      return result;
    };
    const luminance = (rgb: number[]): number => {
      const [r, g, b] = rgb.map((channel) => {
        const c = (channel as number) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const fore = parse(getComputedStyle(row).color).slice(0, 3);
    const back = background(row);
    const [light, dark] = [luminance(fore), luminance(back)].sort((a, b) => b - a) as [
      number,
      number,
    ];
    return (light + 0.05) / (dark + 0.05);
  });
}

test.describe('Pandoc editor', () => {
  test('typing [@ lists the keys of the bibliography; choosing one inserts it', async ({
    page,
  }) => {
    await open(page, DOC, 'split');
    await page.goto('/');
    await expect(page.getByTestId('document-name')).toHaveText('citations.md');
    // The bibliography arrives with the first render of the document.
    await expect(preview(page).locator('div.references#refs')).toBeVisible();
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('\n\nSee [@');
    const popup = page.locator('.cm-tooltip-autocomplete');
    await expect(popup).toBeVisible();
    const options = popup.locator('li[role="option"]');
    await expect(options).toHaveCount(8);
    for (const key of ['brown2019', 'garcia2017', 'jones2021', 'lee2018', 'nodate', 'smith2020']) {
      await expect(popup).toContainText(key);
    }
    const box = await popup.boundingBox();
    expect(box?.width).toBeGreaterThan(80);
    expect(box?.height).toBeGreaterThan(40);
    expect(await contrastOf(page)).toBeGreaterThanOrEqual(4.5);
    await page.keyboard.press('ArrowDown');
    expect(await contrastOf(page)).toBeGreaterThanOrEqual(4.5);
    const chosen = text(await popup.locator('li[aria-selected] .cm-completionLabel').textContent());
    // CodeMirror ignores Enter for 75 ms after the list changes (interactionDelay).
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await expect(popup).toHaveCount(0);
    const key = /^(\S+)/.exec(chosen)?.[1] ?? '';
    expect(key).not.toBe('');
    await expect(editor(page)).toContainText(`See [@${key}`);
  });

  test('the Insert menu lists the six Pandoc inserts', async ({ page }) => {
    await open(page, DOC, 'split');
    await page.goto('/');
    await expect(page.getByTestId('document-name')).toHaveText('citations.md');
    await page.getByTestId('tool-insert').click();
    const items = page.getByTestId('insert-menu').getByRole('menuitem');
    await expect(items).toHaveText([
      'Citation',
      'Footnote',
      'Fenced div',
      'Definition list',
      'Superscript',
      'Subscript',
    ]);
  });
});
