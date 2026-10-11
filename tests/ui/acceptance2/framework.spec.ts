/**
 * Phase 2 acceptance, framework: B01 to B04.
 * Expected values come from the spec and the fixtures, not from the app's output.
 */

import { test } from '@playwright/test';
import {
  DOCS,
  editor,
  editorText,
  expect,
  fixture,
  HOME,
  launch,
  menu,
  openFiles,
  preview,
  setView,
  squash,
  VAULT_ROOT,
  vaultSeed,
  watchErrors,
} from './common';

const GUIDES: Array<{ flavor: string; title: string; pill: string }> = [
  { flavor: 'commonmark', title: 'CommonMark Guide', pill: 'CommonMark' },
  { flavor: 'gfm', title: 'Markdown Guide', pill: 'GFM' },
  { flavor: 'pandoc', title: 'Pandoc / MMD Guide', pill: 'Pandoc / MMD' },
  { flavor: 'quarto', title: 'Quarto / RMD Guide', pill: 'Quarto / RMD' },
  { flavor: 'obsidian', title: 'Obsidian Guide', pill: 'Obsidian' },
  { flavor: 'mdx', title: 'MDX Guide', pill: 'MDX' },
];

/** A file that detection gives each flavor (CommonMark by the pill). */
const START: Record<string, { path: string; text: string }> = {
  commonmark: { path: `${DOCS}/start-cm.md`, text: '# CM\n\nText.\n' },
  gfm: { path: `${DOCS}/start-gfm.md`, text: '# GFM\n\nText.\n' },
  pandoc: { path: `${DOCS}/start.mmd`, text: 'Title: Start\n\nText.\n' },
  quarto: { path: `${DOCS}/start.qmd`, text: '# Q\n\nText.\n' },
  obsidian: { path: `${VAULT_ROOT}/Home.md`, text: '' },
  mdx: { path: `${DOCS}/start.mdx`, text: '# M\n\nText.\n' },
};

test.describe('B01 the six guides', () => {
  for (const { flavor, title, pill } of GUIDES) {
    test(`B01 ${flavor}: the guide renders with no console error and no "Renders as GFM" note`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      const start = START[flavor] as { path: string; text: string };
      const seed = flavor === 'obsidian' ? vaultSeed() : { files: { [start.path]: start.text } };
      await launch(page, { seed, open: start.path, view: 'split' });
      if (flavor === 'commonmark') {
        await page.getByTestId('flavor-pill').click();
        await page
          .getByTestId('flavor-menu')
          .getByRole('menuitemradio', { name: /^CommonMark/ })
          .click();
      }
      await expect(page.getByTestId('status-flavor')).toHaveText(pill);
      await menu(page, 'markdown-guide');
      await expect(page.getByTestId('document-name')).toHaveText(title);
      await expect(page.getByTestId('flavor-pill')).toContainText(pill);
      await expect(page.getByTestId('flavor-note')).toHaveCount(0);
      await expect(preview(page)).not.toContainText('Renders as GFM');
      await expect(preview(page).locator('h1, h2').first()).toBeVisible();
      // The guide shows real content for its flavor, not an empty preview.
      expect(squash(await preview(page).textContent()).length).toBeGreaterThan(500);
      expect(errors).toEqual([]);
    });
  }
});

test.describe('B02 detection', () => {
  const DETECT: Array<[string, string, string]> = [
    ['report.qmd', 'flavors/report.qmd', 'Quarto / RMD'],
    ['analysis.Rmd', 'flavors/analysis.Rmd', 'Quarto / RMD'],
    ['notes.mmd', 'flavors/notes.mmd', 'Pandoc / MMD'],
    ['component.mdx', 'flavors/component.mdx', 'MDX'],
    ['pandoc-hint.md', 'flavors/pandoc-hint.md', 'Pandoc / MMD'],
    ['quarto-hint.md', 'flavors/quarto-hint.md', 'Quarto / RMD'],
    ['plain.md', 'flavors/plain.md', 'GFM'],
  ];

  for (const [name, source, flavor] of DETECT) {
    test(`B02 ${name} is detected as ${flavor}, marked auto`, async ({ page }) => {
      const path = `${DOCS}/${name}`;
      await launch(page, {
        seed: { files: { [path]: fixture(source) } },
        open: path,
        view: 'split',
      });
      await expect(page.getByTestId('status-flavor')).toHaveText(flavor);
      await expect(page.getByTestId('flavor-pill')).toContainText(flavor);
      await expect(page.getByTestId('flavor-auto')).toBeVisible();
      await expect(page.getByTestId('flavor-note')).toHaveCount(0);
    });
  }

  test('B02 a .md note in the fixture vault is detected as Obsidian', async ({ page }) => {
    await launch(page, {
      seed: vaultSeed(),
      open: `${VAULT_ROOT}/Projects/Plan.md`,
      view: 'split',
    });
    await expect(page.getByTestId('status-flavor')).toHaveText('Obsidian');
    await expect(page.getByTestId('flavor-auto')).toBeVisible();
  });

  test('B02 the same .md outside a vault is GFM', async ({ page }) => {
    const path = `${DOCS}/plan.md`;
    await launch(page, { seed: { files: { [path]: '# Plan\n' } }, open: path, view: 'split' });
    await expect(page.getByTestId('status-flavor')).toHaveText('GFM');
  });

  test('B02 the pill choice wins over the extension, the vault and a frontmatter hint', async ({
    page,
  }) => {
    const qmd = `${DOCS}/report.qmd`;
    const hint = `${DOCS}/pandoc-hint.md`;
    await launch(page, {
      seed: {
        ...vaultSeed(),
        files: {
          ...vaultSeed().files,
          [qmd]: fixture('flavors/report.qmd'),
          [hint]: fixture('flavors/pandoc-hint.md'),
        },
      },
      open: qmd,
      view: 'split',
    });
    const choose = async (label: RegExp) => {
      await page.getByTestId('flavor-pill').click();
      await page.getByTestId('flavor-menu').getByRole('menuitemradio', { name: label }).click();
    };
    await expect(page.getByTestId('status-flavor')).toHaveText('Quarto / RMD');
    await choose(/^GitHub Flavored/);
    await expect(page.getByTestId('status-flavor')).toHaveText('GFM');
    await expect(page.getByTestId('flavor-auto')).toHaveCount(0);

    await openFiles(page, [hint]);
    await expect(page.getByTestId('status-flavor')).toHaveText('Pandoc / MMD');
    await choose(/^Quarto/);
    await expect(page.getByTestId('status-flavor')).toHaveText('Quarto / RMD');

    await openFiles(page, [`${VAULT_ROOT}/Home.md`]);
    await expect(page.getByTestId('status-flavor')).toHaveText('Obsidian');
    await choose(/^MDX/);
    await expect(page.getByTestId('status-flavor')).toHaveText('MDX');

    // A choice survives closing and reopening the document.
    await menu(page, 'close-tab');
    await openFiles(page, [`${VAULT_ROOT}/Home.md`]);
    await expect(page.getByTestId('status-flavor')).toHaveText('MDX');
  });
});

const INSERTS: Record<string, { open: string; labels: RegExp[] }> = {
  pandoc: {
    open: 'flavors/pandoc/citations.md',
    labels: [/Citation/, /Footnote/, /Fenced div/, /Definition list/, /Superscript/, /Subscript/],
  },
  quarto: {
    open: 'flavors/quarto/chunks.qmd',
    labels: [
      /Citation/,
      /Footnote/,
      /Fenced div/,
      /Definition list/,
      /Superscript/,
      /Subscript/,
      /Code chunk.*R/,
      /Code chunk.*Python/,
      /Code chunk.*Julia/,
      /Code chunk.*SQL/,
      /Callout/,
      /Cross-reference/,
      /Tabset/,
      /Figure with label/,
    ],
  },
  obsidian: {
    open: '',
    labels: [/Wikilink/, /Embed/, /Callout/, /Highlight/, /Tag/, /Comment/],
  },
  mdx: {
    open: 'flavors/component.mdx',
    labels: [/Import/, /Component/, /Expression/],
  },
};

async function openInsertDoc(page: import('@playwright/test').Page, flavor: string) {
  const spec = INSERTS[flavor] as { open: string };
  if (flavor === 'obsidian') {
    await launch(page, { seed: vaultSeed(), open: `${VAULT_ROOT}/Notes/Note A.md`, view: 'split' });
  } else {
    const ext = spec.open.split('.').pop();
    const path = `${DOCS}/ins-${flavor}.${ext}`;
    await launch(page, {
      seed: { files: { [path]: `${fixture(spec.open)}\nEnd of the document.\n` } },
      open: path,
      view: 'split',
    });
  }
}

test.describe('B03 the Insert menu', () => {
  for (const flavor of Object.keys(INSERTS)) {
    test(`B03 ${flavor}: the menu lists the flavor's inserts`, async ({ page }) => {
      await openInsertDoc(page, flavor);
      await page.getByTestId('tool-insert').click();
      const items = page.getByTestId('insert-menu').getByRole('menuitem');
      const spec = INSERTS[flavor] as { labels: RegExp[] };
      await expect(items).toHaveCount(spec.labels.length);
      for (let i = 0; i < spec.labels.length; i++) {
        await expect(items.nth(i)).toHaveText(spec.labels[i] as RegExp);
      }
    });

    test(`B03 ${flavor}: every insert is a single undo step`, async ({ page }) => {
      await openInsertDoc(page, flavor);
      const spec = INSERTS[flavor] as { labels: RegExp[] };
      await expect.poll(() => editorText(page)).not.toBe('');
      const original = await editorText(page);
      for (let i = 0; i < spec.labels.length; i++) {
        await editor(page).click();
        await page.keyboard.press('ControlOrMeta+End');
        await page.getByTestId('tool-insert').click();
        const item = page.getByTestId('insert-menu').getByRole('menuitem').nth(i);
        const label = squash(await item.textContent());
        await item.click();
        // An insert that opens a second menu is not expected; the menu closes and text changes.
        await expect(page.getByTestId('insert-menu'), label).toHaveCount(0);
        await expect
          .poll(() => editorText(page), { message: `${label} changes the text` })
          .not.toBe(original);
        await page.keyboard.press('ControlOrMeta+z');
        expect(await editorText(page), `${label}: one undo restores the text`).toBe(original);
      }
    });
  }

  for (const [name, text, path] of [
    ['CommonMark', '# T\n', `${DOCS}/cm.md`],
    ['GFM', '# T\n', `${DOCS}/gfm.md`],
  ] as const) {
    test(`B03 ${name}: there is no Insert menu`, async ({ page }) => {
      await launch(page, { seed: { files: { [path]: text } }, open: path, view: 'split' });
      if (name === 'CommonMark') {
        await page.getByTestId('flavor-pill').click();
        await page
          .getByTestId('flavor-menu')
          .getByRole('menuitemradio', { name: /^CommonMark/ })
          .click();
        await expect(page.getByTestId('status-flavor')).toHaveText('CommonMark');
      }
      await expect(page.getByTestId('tool-heading')).toBeVisible();
      await expect(page.getByTestId('tool-insert')).toHaveCount(0);
    });
  }

  test('B03 the Insert menu is disabled in Preview and enabled again in Split', async ({
    page,
  }) => {
    await openInsertDoc(page, 'pandoc');
    await expect(page.getByTestId('tool-insert')).toBeEnabled();
    await setView(page, 'preview');
    await expect(page.getByTestId('tool-insert')).toBeDisabled();
    await setView(page, 'split');
    await expect(page.getByTestId('tool-insert')).toBeEnabled();
  });
});

test.describe('B04 autocomplete', () => {
  const BIB = `${HOME}/papers/refs.bib`;
  const KEYS = ['brown2019', 'garcia2017', 'jones2021', 'lee2018', 'nodate', 'smith2020'];

  for (const [flavor, ext] of [
    ['pandoc', 'md'],
    ['quarto', 'qmd'],
  ] as const) {
    test(`B04 ${flavor}: [@ lists the bibliography keys and choosing one inserts it`, async ({
      page,
    }) => {
      const path = `${HOME}/papers/doc.${ext}`;
      const text =
        flavor === 'quarto'
          ? '---\nformat: html\nbibliography: refs.bib\n---\n\n# Doc\n\nText [@smith2020].\n'
          : '---\nbibliography: refs.bib\nlink-citations: true\n---\n\n# Doc\n\nText [@smith2020].\n';
      await launch(page, {
        seed: { files: { [path]: text, [BIB]: fixture('flavors/pandoc/refs.bib') } },
        open: path,
        view: 'split',
      });
      await expect(page.getByTestId('status-flavor')).toHaveText(
        flavor === 'quarto' ? 'Quarto / RMD' : 'Pandoc / MMD',
      );
      await expect(preview(page).locator('div.references#refs')).toBeVisible();
      await editor(page).click();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.type('\nSee [@');
      const popup = page.locator('.cm-tooltip-autocomplete');
      await expect(popup).toBeVisible();
      for (const key of KEYS) await expect(popup).toContainText(key);
      await page.keyboard.type('nod');
      await expect(popup.locator('li[role="option"]')).toHaveCount(1);
      // CodeMirror ignores Enter for 75 ms after the list changes (interactionDelay).
      await page.waitForTimeout(150);
      await page.keyboard.press('Enter');
      await expect(popup).toHaveCount(0);
      expect(await editorText(page)).toContain('See [@nodate');
    });
  }

  test('B04 quarto: @fig- lists the figure labels and choosing one inserts it', async ({
    page,
  }) => {
    const path = `${DOCS}/crossref.qmd`;
    await launch(page, {
      seed: { files: { [path]: fixture('flavors/quarto/crossref.qmd') } },
      open: path,
      view: 'split',
    });
    await expect(preview(page).locator('#fig-a')).toBeVisible();
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('\n\nSee @fig-');
    const popup = page.locator('.cm-tooltip-autocomplete');
    await expect(popup).toBeVisible();
    await expect(popup.locator('li[role="option"]')).toHaveCount(2);
    await expect(popup).toContainText('fig-a');
    await expect(popup).toContainText('fig-b');
    await page.keyboard.type('b');
    // CodeMirror ignores Enter for 75 ms after the list changes (interactionDelay).
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    expect(await editorText(page)).toContain('See @fig-b');
  });

  test('B04 obsidian: [[ lists the vault notes and choosing one inserts the name', async ({
    page,
  }) => {
    await launch(page, { seed: vaultSeed(), open: `${VAULT_ROOT}/Home.md`, view: 'split' });
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('\n\n[[');
    const popup = page.locator('.cm-tooltip-autocomplete');
    await expect(popup).toBeVisible();
    for (const name of ['Cycle A', 'Cycle B', 'Home', 'Note A'])
      await expect(popup).toContainText(name);
    // The hidden, trash and node_modules folders are not part of the vault.
    await expect(popup).not.toContainText('Secret');
    await expect(popup).not.toContainText('README');
    await page.keyboard.type('Note');
    // CodeMirror ignores Enter for 75 ms after the list changes (interactionDelay).
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    expect(await editorText(page)).toContain('[[Note A]]');
  });
});
