/**
 * The preview in the main window: task boxes,
 * links, images, flavors and the numbers in the status bar. Mock platform, real WebKit.
 */
import { expect, type Page, test } from '@playwright/test';
import type { MockSeed } from '../../src/lib/platform-mock';
import { editor, fixture, HOME, menu, preview, seedMock } from './helpers';

const LINKS = `${HOME}/links`;
const INDEX = `${LINKS}/index.md`;
const SECOND = `${LINKS}/second.md`;
const PLAIN = `${HOME}/flavors/plain.md`;
const PDF = `${LINKS}/files/report.pdf`;
const IMAGE = `${LINKS}/images/sample.png`;
/** A 1 by 1 pixel PNG. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const LINK_SEED: MockSeed = {
  files: {
    [INDEX]: fixture('links/index.md'),
    [SECOND]: fixture('links/second.md'),
    [PLAIN]: fixture('flavors/plain.md'),
  },
  existing: [PDF],
  images: { [IMAGE]: PNG },
};

const previewScroll = (page: Page) => page.getByTestId('preview-scroll');

async function openWith(page: Page, seed: MockSeed, path: string, view?: 'split' | 'editor') {
  await seedMock(page, { ...seed, launch: { openPath: path, ...(view ? { view } : {}) } });
  await page.goto('/');
  await expect(page.getByTestId('document-name')).toHaveText(path.split('/').pop() ?? '');
}

test.describe('A16 task boxes', () => {
  const TASKS = `${HOME}/tasks.md`;
  const text = '# Tasks\n\n- [ ] first\n- [x] second\n  - [ ] nested\n\n1. [ ] numbered\n';

  async function openTasks(page: Page) {
    await openWith(page, { files: { [TASKS]: text } }, TASKS, 'split');
    await expect(preview(page).locator('.task-checkbox')).toHaveCount(4);
  }

  const box = (page: Page, line: number) =>
    preview(page).locator(`.task-checkbox[data-task-line="${line}"]`);

  test('A16 a click toggles [ ] and [x] in the source, once per click', async ({ page }) => {
    await openTasks(page);

    await box(page, 2).click();

    await expect(editor(page)).toContainText('- [x] first');
    await expect(box(page, 2)).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('dirty-dot')).toBeVisible();

    await box(page, 2).click();

    await expect(editor(page)).toContainText('- [ ] first');
    await expect(box(page, 2)).toHaveAttribute('aria-checked', 'false');
    // The two clicks are two edits: the text is back to the saved one.
    await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  });

  test('A16 nested and numbered items toggle too', async ({ page }) => {
    await openTasks(page);

    await box(page, 4).click();
    await box(page, 6).click();

    await expect(editor(page)).toContainText('  - [x] nested');
    await expect(editor(page)).toContainText('1. [x] numbered');
  });

  test('A16 a toggle is one undo step', async ({ page }) => {
    await openTasks(page);

    await box(page, 3).click();
    await expect(editor(page)).toContainText('- [ ] second');

    await menu(page, 'undo');

    await expect(editor(page)).toContainText('- [x] second');
    await expect(box(page, 3)).toHaveAttribute('aria-checked', 'true');
  });

  test('A16 Space on a focused box does the same, once', async ({ page }) => {
    await openTasks(page);

    await box(page, 2).focus();
    await page.keyboard.press('Space');

    await expect(editor(page)).toContainText('- [x] first');
    await expect(box(page, 2)).toHaveAttribute('aria-checked', 'true');
    // The box was replaced by the render; the focus moved to its successor, so Space works again.
    await page.keyboard.press('Space');
    await expect(editor(page)).toContainText('- [ ] first');
  });

  test('A16 in Preview view the boxes work without the editor on screen', async ({ page }) => {
    await openWith(page, { files: { [TASKS]: text } }, TASKS);
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'preview');

    await box(page, 2).click();
    await expect(box(page, 2)).toHaveAttribute('aria-checked', 'true');
    await menu(page, 'save');

    await expect
      .poll(() => page.evaluate(() => window.__BACKTICKLE_MOCK__?.saves.at(-1)?.text))
      .toContain('- [x] first');
  });
});

test.describe('A19 links', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 360 });
    await openWith(page, LINK_SEED, INDEX);
  });

  const link = (page: Page, name: string) => preview(page).getByRole('link', { name, exact: true });
  const mock = <T>(page: Page, read: (m: NonNullable<Window['__BACKTICKLE_MOCK__']>) => T) =>
    page.evaluate(`(${read.toString()})(window.__BACKTICKLE_MOCK__)`) as Promise<T>;

  test('A19 an external link calls openExternal and does not navigate the page', async ({
    page,
  }) => {
    const before = page.url();

    await link(page, 'example.org').click();

    await expect.poll(() => mock(page, (m) => m.externalUrls)).toEqual(['https://example.org/']);
    expect(page.url()).toBe(before);
    await expect(page.getByTestId('document-name')).toHaveText('index.md');
  });

  test('A19 a #anchor link scrolls the preview to the heading', async ({ page }) => {
    await expect(previewScroll(page)).toHaveJSProperty('scrollTop', 0);
    const before = page.url();

    await link(page, 'local heading').click();

    await expect
      .poll(() => previewScroll(page).evaluate((el) => el.scrollTop))
      .toBeGreaterThan(100);
    const offset = await page.evaluate(() => {
      const heading = document.querySelector('[data-testid="preview"] #section-1');
      const pane = document.querySelector('[data-testid="preview-scroll"]');
      if (!heading || !pane) return Number.NaN;
      return heading.getBoundingClientRect().top - pane.getBoundingClientRect().top;
    });
    expect(offset).toBeGreaterThanOrEqual(-1);
    expect(offset).toBeLessThan(120);
    expect(page.url()).toBe(before);
    expect(await mock(page, (m) => m.externalUrls)).toEqual([]);
  });

  test('A19 a relative .md link opens a tab through openLinkedDocument, and activates it when open', async ({
    page,
  }) => {
    await link(page, 'second document').click();

    await expect(page.getByTestId('document-name')).toHaveText('second.md');
    await expect(page.getByTestId('tab-strip').getByRole('tab')).toHaveText([
      'index.md',
      'second.md',
    ]);
    await expect(preview(page).getByRole('heading', { name: 'Second Document' })).toBeVisible();

    await page.getByTestId('tab-strip').getByRole('tab', { name: 'index.md' }).click();
    await link(page, 'second document').click();

    await expect(page.getByTestId('document-name')).toHaveText('second.md');
    await expect(page.getByTestId('tab-strip').getByRole('tab')).toHaveCount(2);
  });

  test('A19 a link with an anchor opens the document and shows the heading', async ({ page }) => {
    await link(page, 'specific section').click();

    await expect(page.getByTestId('document-name')).toHaveText('second.md');
    const heading = preview(page).getByRole('heading', { name: 'Details' });
    await expect(heading).toBeInViewport();
  });

  test('A19 a link into another folder opens that document', async ({ page }) => {
    await link(page, 'file in parent folder').click();

    await expect(page.getByTestId('document-name')).toHaveText('plain.md');
  });

  test('A19 a link to another kind of file asks, then reveals it in Finder', async ({ page }) => {
    await page.evaluate(() => window.__BACKTICKLE_MOCK__?.setAnswers({ ask: true }));

    await link(page, 'PDF document').click();

    await expect.poll(() => mock(page, (m) => m.reveals)).toEqual([PDF]);
    const [ask] = await mock(page, (m) => m.asks);
    expect(ask?.ok).toBe('Show in Finder');
    await expect(page.getByTestId('document-name')).toHaveText('index.md');
  });

  test('A19 declining the question reveals nothing', async ({ page }) => {
    await page.evaluate(() => window.__BACKTICKLE_MOCK__?.setAnswers({ ask: false }));

    await link(page, 'PDF document').click();

    await expect.poll(() => mock(page, (m) => m.asks.length)).toBe(1);
    expect(await mock(page, (m) => m.reveals)).toEqual([]);
  });

  test('A19 a link in an untitled document explains that the file must be saved first', async ({
    page,
  }) => {
    await menu(page, 'new');
    await menu(page, 'view-split');
    await editor(page).click();
    await page.keyboard.type('[other](other.md)');

    await menu(page, 'view-preview');
    await preview(page).getByRole('link', { name: 'other' }).click();

    await expect(page.getByRole('alert')).toContainText('Save this document first');
  });

  test('A19 a middle-click or a click with a modifier never navigates either', async ({ page }) => {
    const before = page.url();

    await link(page, 'example.org').click({ button: 'middle' });
    await link(page, 'example.org').click({ modifiers: ['Shift'] });

    await page.waitForTimeout(100);
    expect(page.url()).toBe(before);
  });
});

test.describe('A20 images', () => {
  test('A20 a relative image is requested through resolveImage and shown', async ({ page }) => {
    await openWith(page, LINK_SEED, INDEX);

    const image = preview(page).locator('img[alt="Sample image"]');
    await expect(image).toHaveAttribute('src', PNG);
    await expect
      .poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
  });

  test('A20 an image that cannot be resolved shows the placeholder', async ({ page }) => {
    const path = `${HOME}/pics.md`;
    await openWith(
      page,
      { files: { [path]: '# Pics\n\n![Lost picture](missing/lost.png)\n' } },
      path,
    );

    const placeholder = preview(page).locator('.wd-image-missing');
    await expect(placeholder).toBeVisible();
    await expect(placeholder).toContainText('Lost picture');
    await expect(preview(page).locator('img')).toHaveCount(0);
  });

  test('A20 an untitled document has no folder, so a local image shows the placeholder', async ({
    page,
  }) => {
    await seedMock(page, { launch: { welcome: true } });
    await page.goto('/');
    await menu(page, 'new');
    await menu(page, 'view-split');
    await editor(page).click();
    await page.keyboard.type('![local](pic.png)');
    await menu(page, 'view-preview');

    await expect(preview(page).locator('.wd-image-missing')).toBeVisible();
  });
});

test.describe('A21 flavors', () => {
  const FLAVOR_FILES: Array<[string, string, string]> = [
    ['report.qmd', 'Quarto / RMD', 'flavors/report.qmd'],
    ['analysis.Rmd', 'Quarto / RMD', 'flavors/analysis.Rmd'],
    ['notes.mmd', 'Pandoc / MMD', 'flavors/notes.mmd'],
    ['pandoc-hint.md', 'Pandoc / MMD', 'flavors/pandoc-hint.md'],
    ['quarto-hint.md', 'Quarto / RMD', 'flavors/quarto-hint.md'],
  ];

  for (const [name, label, source] of FLAVOR_FILES) {
    // Every flavor has its own pack since Phase 2: no "Renders as GFM" note.
    test(`A21 ${name} shows ${label} with "auto" and no note`, async ({ page }) => {
      const path = `${HOME}/flavors/${name}`;
      await openWith(page, { files: { [path]: fixture(source) } }, path);

      const pill = page.getByTestId('flavor-pill');
      await expect(pill).toContainText(label);
      await expect(page.getByTestId('flavor-auto')).toBeVisible();
      await expect(page.getByTestId('flavor-note')).toHaveCount(0);
    });
  }

  test('A21 component.mdx shows MDX with "auto" and no Renders as GFM note', async ({ page }) => {
    const path = `${HOME}/flavors/component.mdx`;
    await openWith(page, { files: { [path]: fixture('flavors/component.mdx') } }, path);

    await expect(page.getByTestId('flavor-pill')).toContainText('MDX');
    await expect(page.getByTestId('flavor-auto')).toBeVisible();
    await expect(page.getByTestId('flavor-note')).toHaveCount(0);
  });

  test('A21 a .md file in an Obsidian vault shows Obsidian', async ({ page }) => {
    const path = `${HOME}/vault/notes/idea.md`;
    await openWith(
      page,
      { files: { [path]: fixture('flavors/vault/notes/idea.md') }, vaults: [`${HOME}/vault`] },
      path,
    );

    await expect(page.getByTestId('flavor-pill')).toContainText('Obsidian');
    await expect(page.getByTestId('flavor-auto')).toBeVisible();
    await expect(page.getByTestId('status-flavor')).toHaveText('Obsidian');
  });

  test('A21 a plain .md file is GFM, detected', async ({ page }) => {
    await openWith(page, LINK_SEED, PLAIN);

    await expect(page.getByTestId('flavor-pill')).toContainText('GFM');
    await expect(page.getByTestId('flavor-auto')).toBeVisible();
    await expect(page.getByTestId('flavor-note')).toHaveCount(0);
  });

  test('A21 the menu lists the six flavors and says which ones render as GFM for now', async ({
    page,
  }) => {
    await openWith(page, LINK_SEED, PLAIN);

    await page.getByTestId('flavor-pill').click();

    const items = page.getByRole('menuitemradio');
    await expect(items).toHaveCount(6);
    await expect(items.filter({ hasText: 'Renders as GFM for now' })).toHaveCount(0);
    await expect(
      page.getByRole('menuitemradio', { name: /GitHub Flavored Markdown/ }),
    ).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('flavor-menu')).toHaveCount(0);
  });

  test('A21 a flavor chosen in the pill is stored and wins when the file is opened again', async ({
    page,
  }) => {
    await openWith(page, { ...LINK_SEED, recents: [PLAIN] }, PLAIN);
    await page.getByTestId('flavor-pill').click();

    await page.getByRole('menuitemradio', { name: 'CommonMark' }).click();

    await expect(page.getByTestId('flavor-pill')).toContainText('CommonMark');
    await expect(page.getByTestId('flavor-auto')).toHaveCount(0);
    await expect(page.getByTestId('status-flavor')).toHaveText('CommonMark');

    await menu(page, 'close-tab');
    await page.getByTestId('recent-item').click();

    await expect(page.getByTestId('document-name')).toHaveText('plain.md');
    await expect(page.getByTestId('flavor-pill')).toContainText('CommonMark');
    await expect(page.getByTestId('flavor-auto')).toHaveCount(0);

    // "Detect automatically" forgets the choice.
    await page.getByTestId('flavor-pill').click();
    await page.getByRole('menuitem', { name: 'Detect automatically' }).click();
    await expect(page.getByTestId('flavor-pill')).toContainText('GFM');
    await expect(page.getByTestId('flavor-auto')).toBeVisible();
  });

  test('A21 CommonMark renders a GFM table as plain text, GFM as a table', async ({ page }) => {
    const path = `${HOME}/table.md`;
    await openWith(page, { files: { [path]: '| a | b |\n| - | - |\n| 1 | 2 |\n' } }, path);
    await expect(preview(page).locator('table')).toHaveCount(1);

    await page.getByTestId('flavor-pill').click();
    await page.getByRole('menuitemradio', { name: 'CommonMark' }).click();

    await expect(preview(page).locator('table')).toHaveCount(0);
    await expect(preview(page)).toContainText('| a | b |');
  });

  test('A21 a flavor chosen in the pill renders with its own pack, without a note', async ({
    page,
  }) => {
    const path = `${HOME}/table.md`;
    await openWith(page, { files: { [path]: '| a | b |\n| - | - |\n| 1 | 2 |\n' } }, path);

    await page.getByTestId('flavor-pill').click();
    await page.getByRole('menuitemradio', { name: /Quarto/ }).click();

    await expect(page.getByTestId('flavor-pill')).toContainText('Quarto');
    await expect(page.getByTestId('flavor-note')).toHaveCount(0);
    await expect(preview(page).locator('table')).toHaveCount(1);
  });

  test('A21 on the welcome screen the pill sets the default flavor for new documents', async ({
    page,
  }) => {
    await seedMock(page, { launch: { welcome: true } });
    await page.goto('/');

    await page.getByTestId('flavor-pill').click();
    await page.getByRole('menuitemradio', { name: 'CommonMark' }).click();

    await expect
      .poll(() => page.evaluate(() => window.__BACKTICKLE_MOCK__?.settings.defaultFlavor))
      .toBe('commonmark');
    await menu(page, 'new');
    await expect(page.getByTestId('flavor-pill')).toContainText('CommonMark');
  });
});

test.describe('A22 words, characters and reading time', () => {
  const words = new Intl.Segmenter('en', { granularity: 'word' });
  const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const grouped = new Intl.NumberFormat('en-US');

  /** The numbers the definitions give for the prose blocks listed next to the fixture. */
  function oracle(name: string) {
    const { blocks } = JSON.parse(fixture(`stats/${name}.md.prose.json`)) as { blocks: string[] };
    let wordCount = 0;
    let characters = 0;
    let withoutSpaces = 0;
    for (const block of blocks) {
      for (const part of words.segment(block)) if (part.isWordLike) wordCount++;
      for (const part of graphemes.segment(block)) {
        characters++;
        if (part.segment.trim() !== '') withoutSpaces++;
      }
    }
    const minutes = Math.ceil(wordCount / 238);
    const reading = wordCount === 0 ? '0 min' : wordCount < 238 ? '< 1 min' : `${minutes} min`;
    return { wordCount, characters, withoutSpaces, reading };
  }

  for (const name of ['english', 'cjk', 'arabic', 'mixed']) {
    test(`A22 ${name}: words, characters and reading time follow the definitions`, async ({
      page,
    }) => {
      const path = `${HOME}/${name}.md`;
      await openWith(page, { files: { [path]: fixture(`stats/${name}.md`) } }, path);
      const expected = oracle(name);

      await expect(page.getByTestId('status-words')).toHaveText(
        `Words: ${grouped.format(expected.wordCount)}`,
      );
      await expect(page.getByTestId('status-characters')).toHaveText(
        `Characters: ${grouped.format(expected.characters)}`,
      );
      await expect(page.getByTestId('status-characters')).toHaveAttribute(
        'title',
        `${grouped.format(expected.withoutSpaces)} without spaces`,
      );
      await expect(page.getByTestId('status-reading')).toHaveText(
        `Reading Time: ${expected.reading}`,
      );
    });
  }

  test('A22 the numbers follow editing in Split view and in Editor view', async ({ page }) => {
    const path = `${HOME}/count.md`;
    await openWith(page, { files: { [path]: 'one two three\n' } }, path, 'split');
    await expect(page.getByTestId('status-words')).toHaveText('Words: 3');

    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('four five');
    await expect(page.getByTestId('status-words')).toHaveText('Words: 5');

    await menu(page, 'view-editor');
    await page.keyboard.type(' six');
    await expect(page.getByTestId('status-words')).toHaveText('Words: 6');
  });

  test('A22 a selection shows "N of total"', async ({ page }) => {
    const path = `${HOME}/count.md`;
    await openWith(
      page,
      { files: { [path]: 'one two three\n\nfour five six seven\n' } },
      path,
      'split',
    );
    await expect(page.getByTestId('status-words')).toHaveText('Words: 7');

    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.press('Shift+End');

    await expect(page.getByTestId('status-words')).toHaveText('Words: 3 of 7');

    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('status-words')).toHaveText('Words: 7');
  });

  test('A22 the reading time uses the words per minute of the settings', async ({ page }) => {
    const path = `${HOME}/long.md`;
    const text = `${'word '.repeat(480)}\n`;
    await openWith(page, { files: { [path]: text }, settings: { readingWpm: 238 } }, path);
    await expect(page.getByTestId('status-reading')).toHaveText('Reading Time: 3 min');

    await page.evaluate(() => window.__BACKTICKLE_MOCK__?.settingsChanged({ readingWpm: 480 }));

    await expect(page.getByTestId('status-reading')).toHaveText('Reading Time: 1 min');
  });
});
