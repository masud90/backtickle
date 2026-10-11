/**
 * Phase 2 acceptance, Pandoc / MMD: B06 to B12.
 * Expected values: the spec, the fixtures, and `tests/fixtures/flavors/pandoc/expected/` (made by
 * Pandoc 3.8.3). Page ranges keep their hyphen in Writedown (accepted), so both sides are
 * compared with en dashes folded to hyphens.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import {
  choose,
  DOCS,
  FIXTURES,
  fixture,
  openDoc,
  PIXEL,
  preview,
  squash,
  texts,
  wordsShown,
} from './common';

const hyphen = (value: string) => squash(value).replace(/–/g, '-');
const BIB = (name: string) => fixture(`flavors/pandoc/${name}`);
const expectedText = (name: string) =>
  readFileSync(join(FIXTURES, 'flavors', 'pandoc', 'expected', name), 'utf8');

const PANDOC = /^Pandoc/;

// ---- B06 title blocks --------------------------------------------------------------------------

test.describe('B06 title block', () => {
  test('B06 from YAML: title, subtitle, two authors with affiliations, date and abstract', async ({
    page,
  }) => {
    await openDoc({
      page,
      path: `${DOCS}/title-yaml.md`,
      text: fixture('flavors/pandoc/title-yaml.md'),
      pill: PANDOC,
    });
    const header = preview(page).locator('header.wd-title-block');
    await expect(header).toHaveCount(1);
    await expect(header.locator('h1.title')).toHaveText('Learning and Evidence in Practice');
    await expect(header.locator('p.subtitle')).toHaveText('A Comprehensive Study');
    const authors = header.locator('p.author');
    await expect(authors).toHaveCount(2);
    await expect(authors.nth(0)).toContainText('Jane Smith');
    await expect(authors.nth(0).locator('span.affiliation')).toHaveText('Institute for Research');
    await expect(authors.nth(1)).toContainText('Robert Jones');
    await expect(authors.nth(1).locator('span.affiliation')).toHaveText('Center for Analysis');
    await expect(header.locator('p.date')).toHaveText('2024-10-06');
    await expect(header.locator('div.abstract')).toContainText(
      'This document presents findings from a comprehensive study of learning outcomes across multiple contexts and populations.',
    );
    // The title block replaces the GFM frontmatter header.
    await expect(preview(page).locator('header.wd-frontmatter')).toHaveCount(0);
  });

  test('B06 from % lines: title, one author and date', async ({ page }) => {
    await openDoc({
      page,
      path: `${DOCS}/title-percent.md`,
      text: fixture('flavors/pandoc/title-percent.md'),
      pill: PANDOC,
    });
    const header = preview(page).locator('header.wd-title-block');
    await expect(header).toHaveCount(1);
    await expect(header.locator('h1.title')).toHaveText('Learning and Evidence in Practice');
    await expect(header.locator('p.author')).toHaveText(['Jane Smith']);
    await expect(header.locator('p.date')).toHaveText('2024-10-06');
    await expect(header.locator('p.subtitle')).toHaveCount(0);
    // The "%" lines are not left in the body.
    await expect(preview(page)).not.toContainText('% Jane Smith');
    await expect(preview(page)).toContainText('Introduction and main content here.');
  });

  test('B06 from an MMD header in a .mmd file', async ({ page }) => {
    await openDoc({
      page,
      path: `${DOCS}/title-mmd.mmd`,
      text: fixture('flavors/pandoc/title-mmd.mmd'),
    });
    await expect(page.getByTestId('status-flavor')).toHaveText('Pandoc / MMD');
    const header = preview(page).locator('header.wd-title-block');
    await expect(header).toHaveCount(1);
    await expect(header.locator('h1.title')).toHaveText('Learning and Evidence in Practice');
    await expect(header.locator('p.author')).toHaveText(['Jane Smith']);
    await expect(header.locator('p.date')).toHaveText('2024-10-06');
    await expect(preview(page)).not.toContainText('Title: Learning');
  });

  test('B06 the title block is a block at the first line and not in the word count', async ({
    page,
  }) => {
    await openDoc({
      page,
      path: `${DOCS}/title-count.md`,
      text: '---\ntitle: Many words in this title\nauthor: Some Author\n---\n\nBody words only.\n',
      pill: PANDOC,
    });
    await expect(preview(page).locator('header.wd-title-block h1.title')).toBeVisible();
    // Only "Body words only." counts.
    await expect.poll(() => wordsShown(page)).toBe(3);
  });
});

// ---- B07 citations -----------------------------------------------------------------------------

const [bodyText, listText] = expectedText('citations.txt').split(/\n\nBrown, Alice/) as [
  string,
  string,
];
const EXPECTED_PARAGRAPHS = bodyText.split(/\n\n/);
const EXPECTED_REFERENCES = `Brown, Alice${listText}`.split(/\n\n/);

const refFiles = (): Record<string, string> => ({
  [`${DOCS}/refs.bib`]: BIB('refs.bib'),
  [`${DOCS}/refs.json`]: BIB('refs.json'),
  [`${DOCS}/refs.yaml`]: BIB('refs.yaml'),
});

async function referenceList(page: Page): Promise<string[]> {
  return (await texts(page, 'div.references#refs > div.reference')).map(hyphen);
}

test.describe('B07 citations', () => {
  test('B07 the ten citation forms render the expected texts (Pandoc 3.8.3 output)', async ({
    page,
  }) => {
    await openDoc({
      page,
      path: `${DOCS}/citations.md`,
      text: fixture('flavors/pandoc/citations.md'),
      extra: refFiles(),
    });
    await expect(page.getByTestId('status-flavor')).toHaveText('Pandoc / MMD');
    await expect(preview(page).locator('div.references#refs')).toBeVisible();
    expect(EXPECTED_PARAGRAPHS).toHaveLength(10);
    const shown = (await texts(page, 'p')).map(hyphen);
    for (const paragraph of EXPECTED_PARAGRAPHS) {
      // Two forms differ from Pandoc on purpose: the missing key (shows "@key?") and the
      // MultiMarkdown form (Pandoc does not read it; Writedown does). They are checked below.
      if (/missing key|MultiMarkdown/.test(paragraph)) continue;
      expect(shown, paragraph).toContain(hyphen(paragraph));
    }
    expect(shown).toContain('MultiMarkdown (MMD) form: (Brown and White 2019)');
  });

  test('B07 a missing key is marked with the key and a question mark', async ({ page }) => {
    await openDoc({
      page,
      path: `${DOCS}/citations.md`,
      text: fixture('flavors/pandoc/citations.md'),
      extra: refFiles(),
    });
    const missing = preview(page).locator('span.citation.citation-missing');
    await expect(missing).toHaveCount(1);
    await expect(missing).toHaveAttribute('data-cites', 'missingkey');
    await expect(missing).toContainText('@missingkey');
    await expect(missing).toContainText('?');
  });

  test('B07 the reference list has the expected entries in the expected order', async ({
    page,
  }) => {
    await openDoc({
      page,
      path: `${DOCS}/citations.md`,
      text: fixture('flavors/pandoc/citations.md'),
      extra: refFiles(),
    });
    await expect(preview(page).locator('div.references#refs > div.reference')).toHaveCount(
      EXPECTED_REFERENCES.length,
    );
    expect(await referenceList(page)).toEqual(EXPECTED_REFERENCES.map(hyphen));
    // Each entry has its id (ref-<key>).
    await expect(preview(page).locator('div.reference#ref-smith2020b')).toContainText('2020a');
    await expect(preview(page).locator('div.reference#ref-smith2020')).toContainText('2020b');
  });

  test('B07 link-citations: true links each citation to its entry', async ({ page }) => {
    await openDoc({
      page,
      path: `${DOCS}/citations.md`,
      text: fixture('flavors/pandoc/citations.md'),
      extra: refFiles(),
    });
    const link = preview(page).locator('span.citation a[href="#ref-smith2020"]').first();
    await expect(link).toBeVisible();
    await expect(
      preview(page).locator('span.citation a[href="#ref-brown2019"]').first(),
    ).toBeVisible();
  });

  test('B07 without link-citations the citations are plain text', async ({ page }) => {
    await openDoc({
      page,
      path: `${DOCS}/nolink.md`,
      text: '---\nbibliography: refs.bib\n---\n\nSee [@smith2020].\n',
      extra: refFiles(),
      pill: PANDOC,
    });
    await expect(preview(page).locator('span.citation').first()).toBeVisible();
    await expect(preview(page).locator('span.citation a')).toHaveCount(0);
    await expect(preview(page).locator('div.references#refs')).toBeVisible();
  });

  test('B07 suppress-bibliography: true hides the reference list but keeps the citations', async ({
    page,
  }) => {
    await openDoc({
      page,
      path: `${DOCS}/citations-options.md`,
      text: fixture('flavors/pandoc/citations-options.md'),
      extra: refFiles(),
    });
    await expect(page.getByTestId('status-flavor')).toHaveText('Pandoc / MMD');
    await expect(preview(page).locator('span.citation').first()).toBeVisible();
    await expect(preview(page).locator('div.references')).toHaveCount(0);
    await expect(preview(page).locator('div.reference')).toHaveCount(0);
    const shown = (await texts(page, 'p')).map(hyphen);
    const expected = expectedText('citations-options.txt').split(/\n\n/);
    for (const paragraph of expected) {
      if (/missing key|MultiMarkdown/.test(paragraph)) continue;
      expect(shown, paragraph).toContain(hyphen(paragraph));
    }
  });

  test('B07 nocite lists an uncited key; nocite "@*" lists every entry', async ({ page }) => {
    await openDoc({
      page,
      path: `${DOCS}/nocite.md`,
      text: '---\nbibliography: refs.bib\nnocite: |\n  @jones2021\n---\n\nOnly [@smith2020].\n',
      extra: refFiles(),
      pill: PANDOC,
    });
    await expect(preview(page).locator('div.reference#ref-jones2021')).toBeVisible();
    await expect(preview(page).locator('div.reference#ref-smith2020')).toBeVisible();
    await expect(preview(page).locator('div.reference')).toHaveCount(2);
    await expect(preview(page).locator('div.reference#ref-lee2018')).toHaveCount(0);
  });

  test('B07 nocite: "@*" lists the whole bibliography', async ({ page }) => {
    await openDoc({
      page,
      path: `${DOCS}/nocite-all.md`,
      text: '---\nbibliography: refs.bib\nnocite: "@*"\n---\n\nSome text.\n',
      extra: refFiles(),
      pill: PANDOC,
    });
    await expect(preview(page).locator('div.reference')).toHaveCount(EXPECTED_REFERENCES.length);
  });

  for (const [name, fixtureName] of [
    ['CSL YAML (refs.yaml)', 'citations-yaml.md'],
    ['CSL JSON (refs.json)', 'citations-json.md'],
  ] as const) {
    test(`B07 ${name} gives the same texts and list as BibTeX`, async ({ page }) => {
      await openDoc({
        page,
        path: `${DOCS}/${fixtureName}`,
        text: fixture(`flavors/pandoc/${fixtureName}`),
        extra: refFiles(),
      });
      await expect(page.getByTestId('status-flavor')).toHaveText('Pandoc / MMD');
      await expect(preview(page).locator('div.references#refs')).toBeVisible();
      expect(await referenceList(page)).toEqual(EXPECTED_REFERENCES.map(hyphen));
      const shown = (await texts(page, 'p')).map(hyphen);
      for (const paragraph of EXPECTED_PARAGRAPHS) {
        if (/missing key|MultiMarkdown/.test(paragraph)) continue;
        expect(shown, paragraph).toContain(hyphen(paragraph));
      }
    });
  }

  test('B07 inline `references:` in the metadata are read like a bibliography', async ({
    page,
  }) => {
    const text = [
      '---',
      'references:',
      '  - id: doe2001',
      '    type: book',
      '    title: A Book',
      '    author:',
      '      - family: Doe',
      '        given: Jan',
      '    issued:',
      '      date-parts: [[2001]]',
      '    publisher: Press',
      '---',
      '',
      'As cited [@doe2001].',
      '',
    ].join('\n');
    await openDoc({ page, path: `${DOCS}/inline-refs.md`, text, pill: PANDOC });
    await expect(preview(page).locator('span.citation').first()).toHaveText('(Doe 2001)');
    await expect(preview(page).locator('div.reference#ref-doe2001')).toContainText(
      'Doe, Jan. 2001.',
    );
  });
});

// ---- B08 syntax --------------------------------------------------------------------------------

test.describe('B08 Pandoc syntax', () => {
  test.beforeEach(async ({ page }) => {
    await openDoc({
      page,
      path: `${DOCS}/syntax.md`,
      text: fixture('flavors/pandoc/syntax.md'),
      pill: PANDOC,
    });
  });

  test('B08 definition lists', async ({ page }) => {
    const list = preview(page).locator('dl').first();
    await expect(list.locator('dt')).toHaveText(['Term One', 'Term Two']);
    await expect(list.locator('dd')).toHaveText([
      'This is the definition of the first term.',
      'This is the first definition of term two.',
      'This is the second definition of term two.',
    ]);
  });

  test('B08 superscript, subscript and strikeout', async ({ page }) => {
    await expect(preview(page).locator('sup', { hasText: /^2$/ })).toHaveCount(1);
    await expect(preview(page).locator('sub')).toHaveText('2');
    await expect(preview(page).locator('del', { hasText: 'struck through' })).toHaveCount(1);
    await expect(preview(page).locator('p', { hasText: 'The formula is' })).toHaveText(
      'The formula is H2O and also CO2.',
    );
  });

  test('B08 abbreviations get their titles', async ({ page }) => {
    await expect(preview(page).locator('abbr')).toHaveCount(2);
    await expect(preview(page).locator('abbr[title="Hyper Text Markup Language"]')).toHaveText(
      'HTML',
    );
    await expect(preview(page).locator('abbr[title="World Wide Web Consortium"]')).toHaveText(
      'W3C',
    );
    // The definition lines are not shown as text.
    await expect(preview(page)).not.toContainText('*[HTML]');
  });

  test('B08 line blocks keep their lines', async ({ page }) => {
    const block = preview(page).locator('div.line-block');
    await expect(block).toHaveCount(1);
    await expect(block.locator('br')).toHaveCount(2);
    const lines = (await block.innerText()).split('\n').map(squash);
    expect(lines).toEqual([
      'The first line of poetry',
      'And the second line continues here',
      'A third line for the verse',
    ]);
  });

  test('B08 fancy lists take their marker types and start numbers', async ({ page }) => {
    const lists = preview(page).locator('ol.fancy-list:not(.example)');
    await expect(lists).toHaveCount(4);
    // Pandoc 3.8.3 makes one list per marker style: default, a, i (start 4), A.
    await expect(lists.nth(1)).toHaveAttribute('type', 'a');
    await expect(lists.nth(2)).toHaveAttribute('type', 'i');
    await expect(lists.nth(2)).toHaveAttribute('start', '4');
    await expect(lists.nth(3)).toHaveAttribute('type', 'A');
    await expect(lists.nth(3)).toContainText('Fourth item with capital letters');
  });

  test('B08 example lists number across the list and (@good) refers to its number', async ({
    page,
  }) => {
    const items = preview(page).locator('ol.fancy-list.example > li');
    await expect(items).toHaveCount(2);
    // Pandoc: the second example (@good) is example 2.
    await expect(preview(page).locator('p', { hasText: 'Later we reference' })).toHaveText(
      'Later we reference the earlier example (2).',
    );
  });

  test('B08 inline footnotes are numbered with the regular ones', async ({ page }) => {
    await expect(preview(page).locator('sup.footnote-ref')).toHaveCount(2);
    const notes = (await texts(page, 'section.footnotes li')).map((value) =>
      value.replace(/\s*↩︎?$/, ''),
    );
    expect(notes).toEqual(['An inline note with markdown.', 'And a regular footnote here.']);
  });

  test('B08 smart punctuation (Pandoc 3.8.3 output)', async ({ page }) => {
    await expect(preview(page).locator('p', { hasText: 'He said' })).toHaveText(
      'He said, “Quotes like these are smart.” And ‘single quotes’ too. Dashes like this – and this — matter. Also ellipses…',
    );
  });
});

// ---- B09 tables --------------------------------------------------------------------------------

test.describe('B09 tables', () => {
  let tables: ReturnType<Page['locator']>;
  test.beforeEach(async ({ page }) => {
    await openDoc({
      page,
      path: `${DOCS}/tables.md`,
      text: fixture('flavors/pandoc/tables.md'),
      pill: PANDOC,
    });
    tables = preview(page).locator('table');
    await expect(tables).toHaveCount(5);
  });

  const rows = (page: Page, index: number) =>
    preview(page)
      .locator('table')
      .nth(index)
      .locator('tr')
      .evaluateAll((trs) =>
        trs.map((tr) =>
          Array.from(tr.querySelectorAll('th, td')).map((c) =>
            (c.textContent ?? '').replace(/\s+/g, ' ').trim(),
          ),
        ),
      );

  test('B09 pipe table: caption and alignments', async ({ page }) => {
    await expect(tables.nth(0).locator('caption')).toHaveText('Caption for pipe table');
    expect(await rows(page, 0)).toEqual([
      ['Left', 'Center', 'Right'],
      ['L1', 'C1', 'R1'],
      ['L2', 'C2', 'R2'],
    ]);
    await expect(tables.nth(0).locator('th.align-left')).toHaveText('Left');
    await expect(tables.nth(0).locator('th.align-center')).toHaveText('Center');
    await expect(tables.nth(0).locator('th.align-right')).toHaveText('Right');
  });

  test('B09 simple table with a "Table:" caption', async ({ page }) => {
    await expect(tables.nth(1).locator('caption')).toHaveText('Simple table caption');
    expect(await rows(page, 1)).toEqual([
      ['Left', 'Center', 'Right'],
      ['L1', 'C1', 'R1'],
      ['L2', 'C2', 'R2'],
    ]);
  });

  test('B09 multiline table (Pandoc 3.8.3: one row per source line without blank lines)', async ({
    page,
  }) => {
    expect(await rows(page, 2)).toEqual([
      ['Left', 'Center', 'Right'],
      ['L1 with', 'C1 with', 'R1 with'],
      ['multiple', 'multiple', 'multiple'],
      ['lines', 'lines', 'lines'],
      ['L2', 'C2', 'R2'],
    ]);
  });

  test('B09 grid table with a two-line cell', async ({ page }) => {
    expect(await rows(page, 3)).toEqual([
      ['Left', 'Center', 'Right'],
      ['L1', 'C1', 'R1'],
      ['L2 with two rows', 'C2', 'R2'],
    ]);
    await expect(tables.nth(3).locator('thead th')).toHaveCount(3);
  });

  test('B09 MMD table with its bracket caption and the span row', async ({ page }) => {
    await expect(tables.nth(4).locator('caption')).toHaveText('MMD table caption');
    const body = await rows(page, 4);
    expect(body.slice(0, 3)).toEqual([
      ['Left', 'Center', 'Right'],
      ['L1', 'C1', 'R1'],
      ['L2', 'C2', 'R2'],
    ]);
    expect(body[3]?.join(' ')).toContain('Spans two columns');
    await expect(preview(page)).not.toContainText('[MMD table caption]');
  });

  test('B09 a table whose cells contain inline Markdown', async ({ page }) => {
    await openDoc({
      page,
      path: `${DOCS}/cells.md`,
      text: '| A | B |\n|---|---|\n| **bold** | `code` |\n| [link](https://example.org) | *em* |\n\n: Inline cells\n',
      pill: PANDOC,
    });
    const table = preview(page).locator('table');
    await expect(table.locator('caption')).toHaveText('Inline cells');
    await expect(table.locator('td strong')).toHaveText('bold');
    await expect(table.locator('td code')).toHaveText('code');
    await expect(table.locator('td em')).toHaveText('em');
    await expect(table.locator('td a')).toHaveAttribute('href', 'https://example.org');
  });
});

// ---- B10 attributes ----------------------------------------------------------------------------

test.describe('B10 attributes and namespaced classes', () => {
  test.beforeEach(async ({ page }) => {
    await openDoc({
      page,
      path: `${DOCS}/syntax.md`,
      text: fixture('flavors/pandoc/syntax.md'),
      pill: PANDOC,
      images: { [`${DOCS}/img.png`]: PIXEL },
    });
  });

  test('B10 a heading keeps its id and its class is namespaced', async ({ page }) => {
    const heading = preview(page).locator('h2#custom-id');
    await expect(heading).toHaveText('Custom Heading');
    await expect(heading).toHaveClass(/(^|\s)doc-doc-class(\s|$)/);
    await expect(heading).not.toHaveClass(/(^|\s)doc-class(\s|$)/);
  });

  test('B10 an image takes width and a span its class (namespaced)', async ({ page }) => {
    const image = preview(page).locator('figure img');
    await expect(image).toHaveAttribute('data-wd-width', '50%');
    expect(await image.evaluate((el) => (el as HTMLElement).style.width)).toBe('50%');
    await expect(preview(page).locator('span.doc-smallcaps')).toHaveText('small caps');
  });

  test('B10 a fenced div keeps its id and classes; nesting works', async ({ page }) => {
    const box = preview(page).locator('div.fenced-div#box');
    await expect(box).toHaveClass(/(^|\s)doc-note(\s|$)/);
    await expect(box.locator('div.fenced-div.doc-inner')).toContainText(
      'And this is content inside a nested div.',
    );
  });

  test('B10 .callout, .task-checkbox and .wd-block from the document do not become app elements', async ({
    page,
  }) => {
    const div = preview(page).locator('div.fenced-div', {
      hasText: 'This div tries application-specific classes.',
    });
    await expect(div).toHaveCount(1);
    await expect(div).toHaveClass(/doc-callout/);
    await expect(div).toHaveClass(/doc-task-checkbox/);
    await expect(div).toHaveClass(/doc-wd-block/);
    const own = await div.evaluate((el) => Array.from(el.classList));
    expect(own).not.toContain('callout');
    expect(own).not.toContain('task-checkbox');
    expect(own).not.toContain('wd-block');
    // No real callout or task checkbox exists in this document.
    await expect(preview(page).locator('.callout')).toHaveCount(0);
    await expect(preview(page).locator('.task-checkbox')).toHaveCount(0);
    // Every .wd-block is a top-level block: none is nested inside another one.
    expect(await preview(page).locator('.wd-block .wd-block').count()).toBe(0);
  });

  test('B10 key=value pairs other than width and height are dropped', async ({ page }) => {
    await openDoc({
      page,
      path: `${DOCS}/kv.md`,
      text: '[text]{.mark foo=bar data-x=1 onclick="window.__kv=1"}\n',
      pill: PANDOC,
    });
    const span = preview(page).locator('p span').first();
    await expect(span).toHaveText('text');
    expect(await span.getAttribute('foo')).toBeNull();
    expect(await span.getAttribute('data-x')).toBeNull();
    expect(await span.getAttribute('onclick')).toBeNull();
  });
});

// ---- B11 CriticMarkup --------------------------------------------------------------------------

test.describe('B11 CriticMarkup', () => {
  const SOURCE = 'Alpha {++beta++} {--gamma--} {~~delta~>epsilon~~} {==zeta==} {>>eta<<} theta.\n';

  test('B11 the five forms render as ins, del, substitution, mark and comment', async ({
    page,
  }) => {
    await openDoc({ page, path: `${DOCS}/critic.md`, text: SOURCE, pill: PANDOC });
    const p = preview(page).locator('p').first();
    await expect(p.locator('ins.critic')).toHaveText('beta');
    await expect(p.locator('del.critic')).toHaveText('gamma');
    const sub = p.locator('span.critic-sub');
    await expect(sub.locator('del')).toHaveText('delta');
    await expect(sub.locator('ins')).toHaveText('epsilon');
    await expect(p.locator('mark.critic')).toHaveText('zeta');
    await expect(p.locator('span.critic-comment')).toHaveText('eta');
    await expect(p).not.toContainText('{++');
    await expect(p).not.toContainText('{>>');
  });

  test('B11 word count: additions, highlights and the new text of a substitution count; deletions and comments do not', async ({
    page,
  }) => {
    await openDoc({ page, path: `${DOCS}/critic-count.md`, text: SOURCE, pill: PANDOC });
    // Independent count: Alpha, beta, epsilon, zeta, theta.
    await expect.poll(() => wordsShown(page)).toBe(5);
  });
});

// ---- B12 raw blocks ----------------------------------------------------------------------------

test.describe('B12 raw blocks', () => {
  const SOURCE = [
    'Intro.',
    '',
    '```{=html}',
    '<b id="rawb" onclick="window.__rawClick=1">Bold raw</b><script>window.__rawScript=1</script>',
    '<img src="x" onerror="window.__rawError=1">',
    '```',
    '',
    '```{=latex}',
    '\\emph{Emphasis in LaTeX}',
    '```',
    '',
    '```{=openxml}',
    '<w:p><w:r><w:t>Word</w:t></w:r></w:p>',
    '```',
    '',
  ].join('\n');

  test('B12 {=html} is shown as HTML after sanitizing', async ({ page }) => {
    await openDoc({ page, path: `${DOCS}/raw.md`, text: SOURCE, pill: PANDOC });
    const bold = preview(page).locator('b#rawb');
    await expect(bold).toHaveText('Bold raw');
    expect(await bold.getAttribute('onclick')).toBeNull();
    await expect(preview(page).locator('script')).toHaveCount(0);
    expect(await preview(page).locator('img[onerror]').count()).toBe(0);
    const executed = await page.evaluate(() =>
      ['__rawClick', '__rawScript', '__rawError'].filter((key) => key in window),
    );
    expect(executed).toEqual([]);
  });

  test('B12 {=latex} is a labelled code card with the source', async ({ page }) => {
    await openDoc({ page, path: `${DOCS}/raw.md`, text: SOURCE, pill: PANDOC });
    const card = preview(page).locator('.code-card', { hasText: 'Emphasis in LaTeX' });
    await expect(card).toHaveCount(1);
    await expect(card.locator('.code-card-lang')).toHaveText('Raw LaTeX');
    await expect(card.locator('pre code')).toContainText('\\emph{Emphasis in LaTeX}');
  });

  test('B12 {=openxml} is a labelled code card too, never rendered', async ({ page }) => {
    await openDoc({ page, path: `${DOCS}/raw.md`, text: SOURCE, pill: PANDOC });
    const card = preview(page).locator('.code-card', { hasText: '<w:p>' });
    await expect(card).toHaveCount(1);
    await expect(card.locator('.code-card-lang')).toHaveText(/^Raw /);
    await expect(preview(page).locator('w\\:p')).toHaveCount(0);
  });
});

void choose;
