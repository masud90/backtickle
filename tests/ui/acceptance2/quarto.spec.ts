/**
 * Phase 2 acceptance, Quarto / RMD: B13 to B18.
 * Numbers in the expectations are counted from the fixtures by hand (see each test). Nothing is
 * ever executed: B13 patches the platform to record every call.
 */
import { expect, type Page, test } from '@playwright/test';
import { DOCS, fixture, HOME, launch, openDoc, openFiles, preview, squash, texts } from './common';

const q = (name: string) => fixture(`flavors/quarto/${name}`);

// ---- B13 chunks --------------------------------------------------------------------------------

const CHUNK_SOURCE = [
  '---',
  'title: Chunk test',
  '---',
  '',
  '```{r setup, echo=FALSE, message=FALSE}',
  '#| warning: false',
  '#| fig-width: 6',
  'x <- 1 + 2',
  '```',
  '',
  '```{python}',
  '#| label: py-one',
  '#| echo: false',
  'y = [1, 2]',
  '```',
  '',
].join('\n');

test.describe('B13 chunks', () => {
  test('B13 header: language, label and one pill per option (header and #| lines)', async ({
    page,
  }) => {
    await openDoc({ page, path: `${DOCS}/chunk.qmd`, text: CHUNK_SOURCE });
    const first = preview(page).locator('.code-chunk[data-lang="r"]');
    await expect(first).toHaveCount(1);
    await expect(first.locator('.code-card-lang')).toHaveText('R');
    await expect(first).toHaveAttribute('data-label', 'setup');
    await expect(first.locator('.chunk-label')).toHaveText('setup');
    const pills = (await first.locator('.chunk-option').allTextContents()).map(squash);
    expect(pills).toEqual(
      expect.arrayContaining(['echo: FALSE', 'message: FALSE', 'warning: false', 'fig-width: 6']),
    );
    expect(pills).toHaveLength(4);
  });

  test('B13 the #| lines are removed from the code and the code stays', async ({ page }) => {
    await openDoc({ page, path: `${DOCS}/chunk.qmd`, text: CHUNK_SOURCE });
    const code = preview(page).locator('.code-chunk[data-lang="r"] pre code');
    await expect(code).toHaveText('x <- 1 + 2');
    await expect(preview(page).locator('.code-chunk[data-lang="python"] pre code')).toHaveText(
      'y = [1, 2]',
    );
    await expect(preview(page).locator('pre code', { hasText: '#|' })).toHaveCount(0);
  });

  test('B13 a #| label option names the chunk', async ({ page }) => {
    await openDoc({ page, path: `${DOCS}/chunk.qmd`, text: CHUNK_SOURCE });
    const python = preview(page).locator('.code-chunk[data-lang="python"]');
    await expect(python).toHaveAttribute('data-label', 'py-one');
    await expect(python.locator('.chunk-label')).toHaveText('py-one');
    await expect(python.locator('.chunk-option')).toHaveText(['echo: false']);
  });

  test('B13 languages: R, Python, Julia, SQL and Bash are colored; an unknown one is plain text', async ({
    page,
  }) => {
    await openDoc({ page, path: `${DOCS}/chunks.qmd`, text: q('chunks.qmd') });
    const labels: Record<string, string> = {
      r: 'R',
      python: 'Python',
      julia: 'Julia',
      sql: 'SQL',
      bash: 'Bash',
      ojs: 'Ojs',
      stata: 'Stata',
    };
    for (const lang of Object.keys(labels)) {
      const cards = preview(page).locator(`.code-chunk[data-lang="${lang}"]`);
      expect(await cards.count(), lang).toBeGreaterThan(0);
      await expect(cards.first().locator('.code-card-lang'), lang).toHaveText(
        labels[lang] as string,
      );
    }
    for (const lang of ['r', 'python', 'julia', 'sql', 'bash']) {
      const tokens = preview(page).locator(
        `.code-chunk[data-lang="${lang}"] pre code span[class^="tok-"]`,
      );
      await expect.poll(() => tokens.count(), { message: `${lang} is colored` }).toBeGreaterThan(0);
    }
    expect(
      await preview(page)
        .locator('.code-chunk[data-lang="stata"] pre code span[class^="tok-"]')
        .count(),
    ).toBe(0);
  });

  test('B13 a header with option pills: include=FALSE and fig-cap from chunks.qmd', async ({
    page,
  }) => {
    await openDoc({ page, path: `${DOCS}/chunks.qmd`, text: q('chunks.qmd') });
    const setup = preview(page).locator('.code-chunk[data-label="setup"]');
    await expect(setup.locator('.chunk-option')).toHaveText(['include: FALSE']);
    const scatter = preview(page).locator('.code-chunk[data-label="fig-scatter"]');
    await expect(scatter.locator('.chunk-option')).toHaveText([
      'fig-cap: A scatter plot',
      'fig-width: 6',
    ]);
  });

  test('B13 inline code is marked and nothing is run', async ({ page }) => {
    await openDoc({ page, path: `${DOCS}/chunks.qmd`, text: q('chunks.qmd') });
    const inline = preview(page).locator('code.inline-chunk');
    await expect(inline).toHaveCount(2);
    await expect(inline.nth(0)).toHaveAttribute('data-lang', 'r');
    await expect(inline.nth(0)).toHaveText('nrow(df)');
    await expect(inline.nth(1)).toHaveAttribute('data-lang', 'python');
    await expect(inline.nth(1)).toHaveText('len(x)');
  });

  test('B13 nothing is executed: no output, no file, no process, no external call', async ({
    page,
  }) => {
    await launch(page, {
      seed: {
        files: { [`${DOCS}/side-effect.qmd`]: q('side-effect.qmd') },
      },
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    // Record every platform call from here on, then open the document.
    await page.evaluate(async () => {
      const module = await import(/* @vite-ignore */ '/src/lib/platform.ts'.toString());
      const platform = await module.getPlatform();
      const calls: string[] = [];
      (window as unknown as { __calls: string[] }).__calls = calls;
      for (const key of Object.keys(platform)) {
        const original = platform[key];
        if (typeof original !== 'function') continue;
        platform[key] = (...args: unknown[]) => {
          calls.push(key);
          return original.apply(platform, args);
        };
      }
    });
    await openFiles(page, [`${DOCS}/side-effect.qmd`]);
    await expect(preview(page).locator('.code-chunk')).toHaveCount(2);
    await page.waitForTimeout(500);

    // The chunks stay code: no output element, and the generated text never appears.
    await expect(preview(page).locator('.chunk-output, .output, .cell-output')).toHaveCount(0);
    await expect(preview(page).locator('.code-chunk').first()).toContainText('writeLines');
    const prose = await preview(page).evaluate((root) => {
      const clone = root.cloneNode(true) as HTMLElement;
      for (const card of clone.querySelectorAll('.code-card')) card.remove();
      return clone.textContent ?? '';
    });
    expect(squash(prose)).not.toMatch(/\bran\b/);

    const calls = await page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
    const names = await page.evaluate(async () => {
      const module = await import(/* @vite-ignore */ '/src/lib/platform.ts'.toString());
      return Object.keys(await module.getPlatform());
    });
    // The platform has no call that starts a process, and none was used to write.
    expect(
      names.filter((name) => /exec|spawn|^run|shell|process|command|eval/i.test(name)),
    ).toEqual([]);
    expect(calls).not.toContain('openExternal');
    expect(calls).not.toContain('saveDocument');
    expect(calls).not.toContain('saveDialog');
    expect(calls.length).toBeGreaterThan(0);

    const control = await page.evaluate((docs) => {
      const mock = window.__WRITEDOWN_MOCK__ as unknown as {
        saves: unknown[];
        externalUrls: string[];
        reveals: string[];
        file(path: string): unknown;
      };
      return {
        saves: mock.saves.length,
        external: mock.externalUrls.length,
        reveals: mock.reveals.length,
        r: mock.file(`${docs}/SIDE_EFFECT_R`) ?? null,
        py: mock.file(`${docs}/SIDE_EFFECT_PY`) ?? null,
        rRoot: mock.file('SIDE_EFFECT_R') ?? null,
        pyRoot: mock.file('SIDE_EFFECT_PY') ?? null,
      };
    }, DOCS);
    expect(control).toEqual({
      saves: 0,
      external: 0,
      reveals: 0,
      r: null,
      py: null,
      rRoot: null,
      pyRoot: null,
    });
    // Only the app itself was fetched: nothing left the machine.
    expect(requests.filter((url) => !/^(http:\/\/localhost|data:|blob:|about:)/.test(url))).toEqual(
      [],
    );
    expect(errors).toEqual([]);
  });
});

// ---- B14 cross-references ----------------------------------------------------------------------

/** The text of the first paragraph that contains the given words. */
const paragraphWith = (page: Page, words: string) =>
  preview(page).locator('p', { hasText: words }).first();

test.describe('B14 cross-references', () => {
  // Counted from crossref.qmd: headings (number-sections: true) are Introduction 1, Methods 1.1,
  // Figure Cross-references 2, Table Cross-references 3, Equation Cross-references 4; figures
  // fig-a 1 and fig-b 2; tables tbl-a 1 and tbl-b 2; the one equation eq-a is (1).
  test('B14 with number-sections: sections, figures, tables, equations, capitalized and number-only forms', async ({
    page,
  }) => {
    await openDoc({ page, path: `${DOCS}/crossref.qmd`, text: q('crossref.qmd') });
    const heading = (id: string) => preview(page).locator(`h1#${id}, h2#${id}`);
    await expect(heading('sec-intro')).toHaveText('1 Introduction');
    await expect(heading('sec-method')).toHaveText('1.1 Methods');
    await expect(heading('figure-cross-references')).toHaveText('2 Figure Cross-references');
    await expect(heading('table-cross-references')).toHaveText('3 Table Cross-references');
    await expect(heading('equation-cross-references')).toHaveText('4 Equation Cross-references');

    await expect(preview(page).locator('figure#fig-a figcaption')).toHaveText('Figure 1: Figure A');
    await expect(preview(page).locator('figure#fig-b figcaption')).toHaveText('Figure 2: Figure B');
    await expect(preview(page).locator('table#tbl-a caption')).toHaveText(
      'Table 1: Table A Caption',
    );
    await expect(preview(page).locator('table#tbl-b caption')).toHaveText(
      'Table 2: Table B Caption',
    );
    await expect(preview(page).locator('#eq-a .eq-number')).toHaveText('(1)');

    await expect(paragraphWith(page, 'introduction section')).toHaveText(
      'This is the introduction section with a reference to Section 1.1.',
    );
    await expect(paragraphWith(page, 'This section references')).toHaveText(
      'This section references Figure Figure 1 and Table Table 1.',
    );
    await expect(preview(page).locator('a.xref[href="#fig-a"]')).toHaveText('Figure 1');
    await expect(preview(page).locator('a.xref[href="#tbl-a"]').first()).toHaveText('Table 1');
    // @Fig-b capitalized; [-@tbl-a] the number only.
    await expect(preview(page).locator('a.xref[href="#fig-b"]')).toHaveText('Figure 2');
    await expect(preview(page).locator('a.xref[href="#tbl-a"]').nth(1)).toHaveText('1');
    await expect(paragraphWith(page, 'Reference to Equation')).toContainText('Equation 1');
    await expect(preview(page).locator('a.xref[href="#eq-a"]')).toHaveText('Equation 1');
    await expect(preview(page).locator('a.xref[href="#sec-method"]').last()).toHaveText(
      'Section 1.1',
    );
  });

  test('B14 without number-sections a section reference shows the heading text', async ({
    page,
  }) => {
    await openDoc({ page, path: `${DOCS}/crossref-plain.qmd`, text: q('crossref-plain.qmd') });
    await expect(preview(page).locator('h1#sec-intro')).toHaveText('Introduction');
    await expect(preview(page).locator('h2#sec-method')).toHaveText('Methods');
    // Figures, tables and equations number the same way.
    await expect(preview(page).locator('figure#fig-b figcaption')).toHaveText('Figure 2: Figure B');
    await expect(preview(page).locator('a.xref[href="#eq-a"]')).toHaveText('Equation 1');
  });

  test('B14 without number-sections a section reference reads "Section 1.1" (numbers counted, not shown)', async ({
    page,
  }) => {
    await openDoc({ page, path: `${DOCS}/crossref-plain.qmd`, text: q('crossref-plain.qmd') });
    await expect(preview(page).locator('a.xref[href="#sec-method"]').first()).toHaveText(
      'Section 1.1',
    );
  });

  test('B14 a missing target is marked, not linked', async ({ page }) => {
    await openDoc({ page, path: `${DOCS}/crossref.qmd`, text: q('crossref.qmd') });
    const missing = preview(page).locator('span.xref.xref-missing');
    await expect(missing).toHaveCount(1);
    await expect(missing).toHaveText('?@fig-missing');
    await expect(preview(page).locator('a.xref[href="#fig-missing"]')).toHaveCount(0);
  });

  test('B14 a cross-reference link scrolls to its target', async ({ page }) => {
    await openDoc({ page, path: `${DOCS}/crossref.qmd`, text: q('crossref.qmd'), view: 'preview' });
    await page.setViewportSize({ width: 1200, height: 500 });
    await preview(page).locator('a.xref[href="#eq-a"]').click();
    await expect(preview(page).locator('#eq-a')).toBeInViewport();
  });

  test('B14 bookdown \\@ref() gives the number only', async ({ page }) => {
    await openDoc({ page, path: `${DOCS}/bookdown.Rmd`, text: q('bookdown.Rmd') });
    await expect(page.getByTestId('status-flavor')).toHaveText('Quarto / RMD');
    // Counted: one chunk figure (1), one table (1), one equation (1), the first section (1).
    await expect(preview(page).locator('a.xref[href="#fig-scatter"]')).toHaveText('1');
    await expect(paragraphWith(page, 'Reference to Figure')).toHaveText('Reference to Figure 1.');
    await expect(preview(page).locator('a.xref[href="#tab-summary"]')).toHaveText('1');
    await expect(paragraphWith(page, 'Reference to Table')).toHaveText('Reference to Table 1.');
    await expect(preview(page).locator('a.xref[href="#eq-mean"]')).toHaveText('1');
    await expect(paragraphWith(page, 'Reference to Equation')).toHaveText(
      'Reference to Equation 1.',
    );
    await expect(preview(page).locator('a.xref[href="#results"]')).toHaveText('1');
    await expect(preview(page).locator('table#tab-summary caption')).toHaveText('Table 1: Summary');
    await expect(preview(page).locator('#eq-mean .eq-number')).toHaveText('(1)');
    await expect(preview(page)).not.toContainText('\\@ref');
  });

  test('B14 crossref metadata sets the prefixes; a capitalized form capitalizes the prefix', async ({
    page,
  }) => {
    const text = [
      '---',
      'crossref:',
      '  fig-prefix: fig.',
      '  tbl-prefix: tab.',
      '---',
      '',
      '![Cap](a.png){#fig-x}',
      '',
      'See @fig-x, @Fig-x and [-@fig-x].',
      '',
    ].join('\n');
    await openDoc({ page, path: `${DOCS}/prefix.qmd`, text });
    const links = preview(page).locator('a.xref[href="#fig-x"]');
    await expect(links).toHaveCount(3);
    await expect(links.nth(0)).toHaveText('fig. 1');
    await expect(links.nth(1)).toHaveText('Fig. 1');
    await expect(links.nth(2)).toHaveText('1');
  });
});

// ---- B15 callouts, tabsets, columns ------------------------------------------------------------

test.describe('B15 callouts, tabsets and columns', () => {
  test.beforeEach(async ({ page }) => {
    await openDoc({ page, path: `${DOCS}/layout.qmd`, text: q('layout.qmd') });
  });

  test('B15 five callout types with default, custom and heading titles', async ({ page }) => {
    for (const [type, title] of [
      ['note', 'Note'],
      ['warning', 'Warning'],
      ['important', 'Custom'],
      ['tip', 'Tip Title'],
      ['caution', 'Caution'],
    ] as const) {
      const callout = preview(page).locator(`.callout-${type}`).first();
      await expect(callout, type).toHaveCount(1);
      await expect(callout.locator('.callout-title'), type).toHaveText(title);
    }
    await expect(preview(page).locator('.callout-tip')).toContainText(
      'This is a tip callout with a heading title.',
    );
    // The heading that supplied the title is not repeated in the body or the outline.
    await expect(preview(page).locator('.callout-tip h2')).toHaveCount(0);
  });

  test('B15 collapse="true" starts closed, collapse="false" starts open, others are not details', async ({
    page,
  }) => {
    const closed = preview(page).locator('details.callout-caution');
    await expect(closed).toHaveCount(1);
    await expect(closed).not.toHaveAttribute('open', '');
    const open = preview(page).locator('details.callout-warning');
    await expect(open).toHaveCount(1);
    await expect(open).toHaveAttribute('open', '');
    await expect(preview(page).locator('details.callout')).toHaveCount(2);
    await closed.locator('summary').click();
    await expect(closed).toHaveAttribute('open', '');
    await closed.locator('summary').click();
    await expect(closed).not.toHaveAttribute('open', '');
  });

  test('B15 tabset: tab titles from the headings, first panel shown, arrow keys move', async ({
    page,
  }) => {
    const tabs = preview(page).locator('[role="tablist"] [role="tab"]');
    await expect(tabs).toHaveText(['Tab One', 'Tab Two', 'Tab Three']);
    const panels = preview(page).locator('.tabset-panel');
    await expect(panels.nth(0)).toBeVisible();
    await expect(panels.nth(1)).toBeHidden();
    await expect(panels.nth(2)).toBeHidden();
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await tabs.nth(0).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(1)).toBeFocused();
    await expect(panels.nth(1)).toBeVisible();
    await expect(panels.nth(0)).toBeHidden();
    await expect(panels.nth(1)).toContainText('Content for the second tab here.');
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
    await expect(panels.nth(2)).toBeVisible();
    // Only the selected tab is in the tab order.
    await expect(tabs.nth(0)).toHaveAttribute('tabindex', '-1');
    await expect(tabs.nth(2)).toHaveAttribute('tabindex', '0');
  });

  test('B15 a tab title heading is not a heading of the document', async ({ page }) => {
    await expect(preview(page).locator('.tabset-panel h2')).toHaveCount(0);
    await expect(preview(page).locator('.tabset h2')).toHaveCount(0);
  });

  test('B15 columns take their widths', async ({ page }) => {
    const columns = preview(page).locator('.columns > .column');
    await expect(columns).toHaveCount(2);
    await expect(columns.nth(0)).toHaveAttribute('data-wd-width', '40%');
    await expect(columns.nth(1)).toHaveAttribute('data-wd-width', '60%');
    expect(await columns.nth(0).evaluate((el) => (el as HTMLElement).style.width)).toBe('40%');
    expect(await columns.nth(1).evaluate((el) => (el as HTMLElement).style.width)).toBe('60%');
    const [a, b] = await Promise.all([columns.nth(0).boundingBox(), columns.nth(1).boundingBox()]);
    expect(a && b && Math.abs(b.width / a.width - 1.5) < 0.1).toBe(true);
  });
});

// ---- B16 shortcodes ----------------------------------------------------------------------------

const PARTS = (): Record<string, string> => ({
  [`${DOCS}/_part-a.qmd`]: q('_part-a.qmd'),
  [`${DOCS}/_part-b.qmd`]: q('_part-b.qmd'),
  [`${DOCS}/_cycle-x.qmd`]: q('_cycle-x.qmd'),
  [`${DOCS}/_cycle-y.qmd`]: q('_cycle-y.qmd'),
});

test.describe('B16 shortcodes', () => {
  test.beforeEach(async ({ page }) => {
    await openDoc({
      page,
      path: `${DOCS}/shortcodes.qmd`,
      text: q('shortcodes.qmd'),
      extra: PARTS(),
    });
  });

  test('B16 pagebreak, meta, kbd and an unknown shortcode', async ({ page }) => {
    await expect(preview(page).locator('hr.pagebreak')).toHaveCount(1);
    await expect(paragraphWith(page, 'Meta subtitle')).toHaveText('Meta subtitle: From meta');
    await expect(preview(page).locator('kbd')).toHaveText('Cmd-S');
    const unknown = preview(page).locator('code.shortcode');
    await expect(unknown).toHaveCount(1);
    await expect(unknown).toContainText('video https://example.org/v.mp4');
  });

  test('B16 include renders the included file in place', async ({ page }) => {
    const include = preview(page).locator('.include[data-src="_part-a.qmd"]');
    await expect(include).toHaveCount(1);
    await expect(include.locator('h1')).toHaveText('Part A Heading');
    await expect(include).toContainText('This is content from part A.');
  });

  test('B16 a nested include (part A includes part B) is rendered without an edit', async ({
    page,
  }) => {
    const nested = preview(page).locator(
      '.include[data-src="_part-a.qmd"] .include[data-src="_part-b.qmd"]',
    );
    await expect(nested).toContainText('This is content from part B.', { timeout: 3000 });
  });

  test('B16 after one edit the nested include is rendered', async ({ page }) => {
    await page.getByTestId('view-split').click();
    await page.getByTestId('editor').click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' x');
    const nested = preview(page).locator(
      '.include[data-src="_part-a.qmd"] .include[data-src="_part-b.qmd"]',
    );
    await expect(nested).toContainText('This is content from part B.');
  });

  test('B16 a missing include is a muted "not found" card, not an error', async ({ page }) => {
    await openDoc({
      page,
      path: `${DOCS}/missing.qmd`,
      text: '# Doc\n\n{{< include _nowhere.qmd >}}\n\nAfter.\n',
    });
    const card = preview(page).locator('.include-card');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('Include not found: _nowhere.qmd');
    await expect(preview(page)).toContainText('After.');
  });

  test('B16 an include cycle is a muted "include cycle" card (after one edit)', async ({
    page,
  }) => {
    await openDoc({
      page,
      path: `${DOCS}/cycle.qmd`,
      text: q('cycle.qmd'),
      extra: PARTS(),
      view: 'split',
    });
    await page.getByTestId('editor').click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('\n\nMore text.');
    await expect(preview(page).locator('.include-card')).toContainText(/Include cycle/);
    await expect(preview(page).locator('h1#cycle-x')).toHaveCount(1);
    await expect(preview(page).locator('h1#cycle-y')).toHaveCount(1);
  });

  test('B16 an include cycle is shown without an edit', async ({ page }) => {
    await openDoc({
      page,
      path: `${DOCS}/cycle.qmd`,
      text: q('cycle.qmd'),
      extra: PARTS(),
    });
    await expect(preview(page).locator('.include-card')).toContainText(/Include cycle/, {
      timeout: 3000,
    });
  });

  test('B16 included text counts as words and blocks carry the shortcode line', async ({
    page,
  }) => {
    // The include shortcode is on line 15 (0-based): the included blocks share its position.
    const wrapper = preview(page).locator('.wd-block:has(.include[data-src="_part-a.qmd"])');
    await expect(wrapper).toHaveAttribute('data-line', '15');
  });
});

// ---- B17 _quarto.yml ---------------------------------------------------------------------------

const PROJECT = `${HOME}/fx/quarto/project`;
const BIB = `${HOME}/fx/pandoc/refs.bib`;

test.describe('B17 _quarto.yml', () => {
  const files = (): Record<string, string> => ({
    [`${PROJECT}/_quarto.yml`]: q('project/_quarto.yml'),
    [BIB]: fixture('flavors/pandoc/refs.bib'),
  });

  test('B17 the project supplies the bibliography without an edit', async ({ page }) => {
    await openDoc({
      page,
      path: `${PROJECT}/chapter.qmd`,
      text: q('project/chapter.qmd'),
      extra: files(),
    });
    // Pandoc 3.8.3 with this bibliography: "(Smith 2020)" and "(Jones 2021)", two entries.
    const citations = preview(page).locator('span.citation');
    await expect(citations).toHaveText(['(Smith 2020)', '(Jones 2021)']);
    await expect(preview(page).locator('div.reference')).toHaveText([
      'Jones, Robert. 2021. Comprehensive Guide to Methods. Academic Press.',
      'Smith, Jane. 2020. “Learning from Evidence.” Journal of Studies, ahead of print. https://doi.org/10.1234/example.doi.',
    ]);
    await expect(preview(page).locator('span.citation-missing')).toHaveCount(0);
  });

  test('B17 the project supplies the bibliography after one edit: citations and reference list (Pandoc output)', async ({
    page,
  }) => {
    await openDoc({
      page,
      path: `${PROJECT}/chapter.qmd`,
      text: q('project/chapter.qmd'),
      extra: files(),
      view: 'split',
    });
    await page.getByTestId('editor').click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('\n\nMore.');
    // Pandoc 3.8.3 with this bibliography: "(Smith 2020)" and "(Jones 2021)", two entries.
    const citations = preview(page).locator('span.citation');
    await expect(citations).toHaveText(['(Smith 2020)', '(Jones 2021)']);
    await expect(preview(page).locator('div.reference')).toHaveText([
      'Jones, Robert. 2021. Comprehensive Guide to Methods. Academic Press.',
      'Smith, Jane. 2020. “Learning from Evidence.” Journal of Studies, ahead of print. https://doi.org/10.1234/example.doi.',
    ]);
    await expect(preview(page).locator('span.citation-missing')).toHaveCount(0);
  });

  test('B17 the project supplies number-sections', async ({ page }) => {
    await openDoc({
      page,
      path: `${PROJECT}/chapter.qmd`,
      text: q('project/chapter.qmd'),
      extra: files(),
    });
    await expect(preview(page).locator('h1', { hasText: 'Introduction' })).toHaveText(
      '1 Introduction',
    );
    await expect(preview(page).locator('h1', { hasText: 'Second Section' })).toHaveText(
      '2 Second Section',
    );
  });

  test('B17 the same document outside the project has neither', async ({ page }) => {
    await openDoc({
      page,
      path: `${DOCS}/chapter.qmd`,
      text: q('project/chapter.qmd'),
      extra: { [`${DOCS}/refs.bib`]: fixture('flavors/pandoc/refs.bib') },
    });
    await expect(preview(page).locator('h1', { hasText: 'Introduction' })).toHaveText(
      'Introduction',
    );
    await expect(preview(page).locator('span.citation').first()).toContainText('@smith2020');
    await expect(preview(page).locator('span.citation.citation-missing')).toHaveCount(2);
  });

  test("B17 the document's own settings win over the project", async ({ page }) => {
    const text = [
      '---',
      'number-sections: false',
      'bibliography: own.bib',
      '---',
      '',
      '# Own',
      '',
      'Cites [@jones2021].',
      '',
    ].join('\n');
    await openDoc({
      page,
      path: `${PROJECT}/own.qmd`,
      text,
      extra: {
        ...files(),
        [`${PROJECT}/own.bib`]:
          '@book{jones2021, author = {Own, Olga}, title = {Own Book}, year = {2001}, publisher = {P}}',
      },
    });
    await expect(preview(page).locator('h1', { hasText: 'Own' })).toHaveText('Own');
    await expect(preview(page).locator('span.citation').first()).toHaveText('(Own 2001)');
  });

  test('B17 a _quarto.yml above the document is found (up to 8 levels)', async ({ page }) => {
    const deep = `${PROJECT}/a/b/c`;
    await openDoc({
      page,
      path: `${deep}/deep.qmd`,
      text: '# Deep\n\n## Deeper\n',
      extra: files(),
    });
    await expect(preview(page).locator('h1', { hasText: 'Deep' }).first()).toHaveText('1 Deep');
    await expect(preview(page).locator('h2')).toHaveText('1.1 Deeper');
  });

  test('B17 the search stops at the home folder', async ({ page }) => {
    await openDoc({
      page,
      path: `${DOCS}/home-stop.qmd`,
      text: '# Home stop\n',
      extra: { [`${HOME}/_quarto.yml`]: 'number-sections: true\n' },
    });
    await expect(preview(page).locator('h1')).toHaveText('Home stop');
  });

  test('B17 crossref settings of the project apply', async ({ page }) => {
    await openDoc({
      page,
      path: `${PROJECT}/fig.qmd`,
      text: '![Cap](a.png){#fig-x}\n\nSee @fig-x.\n',
      extra: {
        [`${PROJECT}/_quarto.yml`]: 'crossref:\n  fig-prefix: Plate\n',
      },
    });
    await expect(preview(page).locator('a.xref[href="#fig-x"]')).toHaveText('Plate 1');
  });
});

// ---- B18 figure chunks -------------------------------------------------------------------------

test.describe('B18 figure chunks', () => {
  test('B18 chunks.qmd: two figure chunks give numbered placeholders', async ({ page }) => {
    await openDoc({ page, path: `${DOCS}/chunks.qmd`, text: q('chunks.qmd') });
    const figures = preview(page).locator('figure.chunk-figure');
    await expect(figures).toHaveCount(2);
    await expect(figures.nth(0)).toHaveAttribute('id', 'fig-scatter');
    await expect(figures.nth(0).locator('figcaption')).toHaveText('Figure 1: A scatter plot');
    await expect(figures.nth(0).locator('.chunk-output-placeholder')).toHaveText(
      'Figure output is not shown: code is never run',
    );
    await expect(figures.nth(1)).toHaveAttribute('id', 'fig-hist');
    await expect(figures.nth(1).locator('figcaption')).toHaveText('Figure 2: A histogram');
    // The placeholder follows its chunk's code card.
    await expect(
      preview(page).locator('.code-chunk[data-label="fig-scatter"] + figure.chunk-figure'),
    ).toHaveCount(1);
  });

  test('B18 a cross-reference reaches a figure chunk, and numbering is shared with images', async ({
    page,
  }) => {
    const text = [
      '![An image](a.png){#fig-img}',
      '',
      '```{r}',
      '#| label: fig-chunk',
      '#| fig-cap: "From a chunk"',
      'plot(1)',
      '```',
      '',
      'See @fig-img and @fig-chunk, and [-@fig-chunk].',
      '',
    ].join('\n');
    await openDoc({ page, path: `${DOCS}/figs.qmd`, text });
    await expect(preview(page).locator('figure#fig-img figcaption')).toHaveText(
      'Figure 1: An image',
    );
    await expect(preview(page).locator('figure#fig-chunk figcaption')).toHaveText(
      'Figure 2: From a chunk',
    );
    const links = preview(page).locator('a.xref');
    await expect(links).toHaveText(['Figure 1', 'Figure 2', '2']);
    await expect(links.nth(1)).toHaveAttribute('href', '#fig-chunk');
  });

  test('B18 a figure chunk with fig-cap alone (no label) still gives a placeholder', async ({
    page,
  }) => {
    await openDoc({
      page,
      path: `${DOCS}/nolabel.qmd`,
      text: '```{r}\n#| fig-cap: "No label"\nplot(1)\n```\n',
    });
    await expect(preview(page).locator('figure.chunk-figure')).toHaveCount(1);
    await expect(preview(page).locator('figure.chunk-figure figcaption')).toContainText('No label');
  });

  test('B18 bookdown fig.cap chunks are figures that \\@ref reaches', async ({ page }) => {
    await openDoc({ page, path: `${DOCS}/bookdown.Rmd`, text: q('bookdown.Rmd') });
    await expect(preview(page).locator('figure.chunk-figure#fig-scatter figcaption')).toHaveText(
      'Figure 1: A scatter',
    );
    await expect(preview(page).locator('a.xref[href="#fig-scatter"]')).toHaveText('1');
  });

  test('B18 a chunk without a figure option has no placeholder', async ({ page }) => {
    await openDoc({ page, path: `${DOCS}/chunks.qmd`, text: q('chunks.qmd') });
    await expect(preview(page).locator('.code-chunk[data-label="r-chunk-1"] + figure')).toHaveCount(
      0,
    );
  });
});

test.describe('Spec rules of 3640349', () => {
  const BIB_FILES = { [`${DOCS}/refs.bib`]: fixture('flavors/pandoc/refs.bib') };

  test('B07 reference-section-title gives an h2 heading in Quarto', async ({ page }) => {
    await openDoc({
      page,
      path: `${DOCS}/title-refs.qmd`,
      text: '---\nbibliography: refs.bib\nreference-section-title: Works cited\n---\n\nSee [@smith2020].\n',
      extra: BIB_FILES,
    });
    await expect(preview(page).locator('h2', { hasText: 'Works cited' })).toHaveCount(1);
    await expect(preview(page).locator('h1', { hasText: 'Works cited' })).toHaveCount(0);
  });

  test('B07 a page range shortens its digits as Pandoc does', async ({ page }) => {
    await openDoc({
      page,
      path: `${DOCS}/range.qmd`,
      text: '---\nbibliography: refs.bib\n---\n\nSee [@brown2019, pp. 105-110].\n',
      extra: BIB_FILES,
    });
    await expect(preview(page).locator('span.citation').first()).toContainText('105-10)');
  });

  test('B06 a Quarto title block formats an ISO date', async ({ page }) => {
    await openDoc({
      page,
      path: `${DOCS}/date.qmd`,
      text: '---\ntitle: T\ndate: 2026-10-06\n---\n\nBody.\n',
    });
    await expect(preview(page).locator('header.wd-title-block p.date')).toHaveText(
      'October 6, 2026',
    );
  });
});

void texts;
void openFiles;
