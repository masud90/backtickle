/**
 * Phase 4 acceptance D11 to D20 (WP4.8a1): editor, saving and preview settings applied in the main
 * window on the mock platform. Expected values come from
 * from arithmetic on the chosen settings (line box = font size x line height).
 */
import { type Page, test } from '@playwright/test';
import {
  dirtyDot,
  editor,
  editorText,
  expect,
  launch,
  menu,
  mockCall,
  mockRead,
  preview,
  type SavedCall,
  saves,
  selectionOf,
  setSelection,
  typeAtEnd,
} from '../acceptance/support';

const HOME = '/Users/mock';
const NOTE = `${HOME}/Documents/note.md`;
const change = (page: Page, patch: object) => mockCall(page, 'settingsChanged', patch);

async function openNote(page: Page, text: string, settings: object = {}, extra: object = {}) {
  await page.setViewportSize({ width: 1280, height: 820 });
  await launch(page, {
    seed: { files: { [NOTE]: text }, settings, ...extra },
    open: NOTE,
    view: 'split',
  });
  await expect(editor(page)).toBeVisible();
}

const lineBox = (page: Page) =>
  page
    .locator('.cm-line')
    .first()
    .evaluate((el) => getComputedStyle(el).lineHeight);

test.describe('D11 font family, size and line height', () => {
  test('D11 line box is size x height; font stack follows the family', async ({ page }) => {
    await openNote(page, '# Title\n\nBody\n');
    expect(Math.abs(Number.parseFloat(await lineBox(page)) - 13 * 1.7)).toBeLessThan(0.5);
    await change(page, { editor: { fontSize: 20, lineHeight: 1.5 } });
    await expect.poll(() => lineBox(page)).toBe('30px');
    for (const [family, needle] of [
      ['menlo', 'Menlo'],
      ['sf-mono', 'ui-monospace'],
      ['jetbrains-mono', 'JetBrains Mono'],
    ] as const) {
      await change(page, { editor: { fontFamily: family } });
      await expect
        .poll(() => page.locator('.cm-scroller').evaluate((el) => getComputedStyle(el).fontFamily))
        .toContain(needle);
    }
  });

  test('D11 cursor, selection and undo history survive a font change', async ({ page }) => {
    await openNote(page, 'alpha beta gamma\n');
    await typeAtEnd(page, 'XYZ');
    const doc = await editorText(page);
    await setSelection(page, 6, 10);
    await change(page, { editor: { fontFamily: 'menlo', fontSize: 18, lineHeight: 2.2 } });
    await expect.poll(() => lineBox(page)).toBe(`${Math.round(18 * 2.2)}px`);
    const selection = await selectionOf(page);
    expect([selection.from, selection.to, selection.text]).toEqual([6, 10, 'beta']);
    expect(await editorText(page)).toBe(doc);
    await page.keyboard.press('ControlOrMeta+z');
    expect(await editorText(page)).toBe('alpha beta gamma\n');
  });
});

test.describe('D12 editor switches', () => {
  test('D12 insertSpaces off: Tab types a tab character; on: spaces', async ({ page }) => {
    await openNote(page, 'x\n', { editor: { insertSpaces: false } });
    await typeAtEnd(page, 'a');
    await page.keyboard.press('Tab');
    // Tab indents the line (indentWithTab): the tab goes to the line start.
    expect(await editorText(page)).toBe('x\n\ta');
  });

  test('D12 insertSpaces on: Tab indents with spaces only (tab size 2)', async ({ page }) => {
    await openNote(page, 'x\n', { editor: { insertSpaces: true } });
    await typeAtEnd(page, 'a');
    await page.keyboard.press('Tab');
    expect(await editorText(page)).toBe('x\n  a');
  });

  for (const [typed, expected] of [
    ['(', '()'],
    ['[', '[]'],
    ['"', '""'],
    ['**', '****'],
    ['`', '``'],
  ] as const) {
    test(`D12 autoPair on: ${typed} gives ${expected}`, async ({ page }) => {
      await openNote(page, 'start\n\n', { editor: { autoPair: true } });
      await typeAtEnd(page, typed);
      expect((await editorText(page)).endsWith(`\n\n${expected}`)).toBe(true);
    });
  }

  test('D12 autoPair off pairs nothing', async ({ page }) => {
    await openNote(page, 'start\n\n');
    await typeAtEnd(page, '([');
    expect((await editorText(page)).endsWith('\n\n([')).toBe(true);
  });

  test('D12 autoPair does not pair in frontmatter', async ({ page }) => {
    await openNote(page, '---\ntitle: x\n---\n\nbody\n', { editor: { autoPair: true } });
    const at = '---\ntitle: x'.length;
    await setSelection(page, at);
    await page.keyboard.type('(');
    expect(await editorText(page)).toBe('---\ntitle: x(\n---\n\nbody\n');
  });

  test('D12 autoPair does not pair in a fenced block', async ({ page }) => {
    await openNote(page, '```js\ncode\n```\n', { editor: { autoPair: true } });
    await setSelection(page, '```js\ncode'.length);
    await page.keyboard.type('(');
    expect(await editorText(page)).toBe('```js\ncode(\n```\n');
  });

  test('D12 continueLists: on continues the marker, off is a plain newline', async ({ page }) => {
    await openNote(page, '- one\n');
    await typeAtEnd(page, '- two');
    await page.keyboard.press('Enter');
    await page.keyboard.type('three');
    expect((await editorText(page)).endsWith('- two\n- three')).toBe(true);
    await change(page, { editor: { continueLists: false } });
    await page.keyboard.press('Enter');
    await page.keyboard.type('four');
    expect((await editorText(page)).endsWith('- three\nfour')).toBe(true);
  });

  test('D12 paneHeaders and currentLine switch both off and on', async ({ page }) => {
    await openNote(page, '# A\n\ntext\n');
    await editor(page).click();
    await expect(page.getByTestId('editor-header')).toBeVisible();
    await expect(page.getByTestId('preview-header')).toBeVisible();
    await expect(page.locator('.cm-activeLine')).toHaveCount(1);
    await expect(page.locator('.cm-activeLineGutter')).toHaveCount(1);
    await change(page, { editor: { paneHeaders: false, currentLine: false } });
    await expect(page.getByTestId('editor-header')).toHaveCount(0);
    await expect(page.getByTestId('preview-header')).toHaveCount(0);
    await expect(page.locator('.cm-activeLine')).toHaveCount(0);
    await expect(page.locator('.cm-activeLineGutter')).toHaveCount(0);
  });
});

test.describe('D13 auto-save', () => {
  test('D13 saves about 2 s after the last keystroke, the timer restarts, the dot clears', async ({
    page,
  }) => {
    await openNote(page, 'x\n', { saving: { autoSave: true } });
    await typeAtEnd(page, 'a');
    await expect(dirtyDot(page)).toBeVisible();
    await page.waitForTimeout(1200);
    await page.keyboard.type('b');
    const typedAt = Date.now();
    await page.waitForTimeout(1200);
    expect((await saves(page)).length).toBe(0);
    await expect.poll(async () => (await saves(page)).length, { timeout: 5000 }).toBe(1);
    const elapsed = Date.now() - typedAt;
    expect(elapsed).toBeGreaterThanOrEqual(1700);
    expect(elapsed).toBeLessThan(4000);
    expect((await saves(page))[0]?.text).toBe('x\nab');
    await expect(dirtyDot(page)).toHaveCount(0);
  });

  test('D13 saves at once on tab switch', async ({ page }) => {
    const other = `${HOME}/Documents/other.md`;
    await openNote(
      page,
      'x\n',
      { saving: { autoSave: true } },
      { files: { [NOTE]: 'x\n', [other]: 'o\n' } },
    );
    await typeAtEnd(page, 'q');
    await mockCall(page, 'openFiles', [other]);
    await expect.poll(async () => (await saves(page)).length, { timeout: 1500 }).toBe(1);
  });

  test('D13 saves at once on window blur', async ({ page }) => {
    await openNote(page, 'x\n', { saving: { autoSave: true } });
    await typeAtEnd(page, 'q');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect.poll(async () => (await saves(page)).length, { timeout: 1500 }).toBe(1);
  });

  test('D13 never saves an untitled document', async ({ page }) => {
    await launch(page, { seed: { settings: { saving: { autoSave: true } } } });
    await menu(page, 'new');
    await expect(editor(page)).toBeVisible();
    await typeAtEnd(page, 'draft');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForTimeout(2600);
    expect((await saves(page)).length).toBe(0);
    await expect(dirtyDot(page)).toBeVisible();
  });
});

test.describe('D14 auto-save and an outside change', () => {
  test('D14 no write while the banner shows; Keep Mine then saves', async ({ page }) => {
    await openNote(page, '# Mine\n', { saving: { autoSave: true } }, { ask: false });
    await typeAtEnd(page, 'edit');
    await page.evaluate(
      ([p, t]) => window.__WRITEDOWN_MOCK__?.externallyModify(p as string, t as string),
      [NOTE, '# Theirs\n'],
    );
    const banner = page.getByTestId('banner-external');
    await expect(banner).toBeVisible({ timeout: 6000 });
    await page.waitForTimeout(2600);
    expect((await saves(page)).length).toBe(0);
    await banner.getByRole('button', { name: 'Keep Mine' }).click();
    await expect.poll(async () => (await saves(page)).length).toBe(1);
    expect((await saves(page))[0]?.text.endsWith('edit')).toBe(true);
  });
});

test.describe('D15 line endings and final newline', () => {
  async function saveNew(page: Page, typed: string, target: string): Promise<SavedCall> {
    await menu(page, 'new');
    await expect(editor(page)).toBeVisible();
    await typeAtEnd(page, typed);
    await mockCall(page, 'setAnswers', { saveDialog: target });
    const before = (await saves(page)).length;
    await menu(page, 'save');
    await expect.poll(async () => (await saves(page)).length).toBe(before + 1);
    return (await saves(page)).at(-1) as SavedCall;
  }

  test('D15 a new document: CRLF, no final newline by default (4 bytes for a CRLF b)', async ({
    page,
  }) => {
    await launch(page, { seed: { settings: { saving: { newLineEnding: 'crlf' } } } });
    const saved = await saveNew(page, 'a\nb', `${HOME}/Documents/n.md`);
    expect(saved.format.lineEnding).toBe('crlf');
    expect(saved.text).toBe('a\nb');
    expect(saved.result.bytes).toBe(4);
  });

  test('D15 newFinalNewline on adds exactly one', async ({ page }) => {
    await launch(page, { seed: { settings: { saving: { newFinalNewline: true } } } });
    expect((await saveNew(page, 'a', `${HOME}/Documents/one.md`)).text).toBe('a\n');
    expect((await saveNew(page, 'b\n', `${HOME}/Documents/two.md`)).text).toBe('b\n');
  });

  test('D15 an existing LF file keeps LF and its missing final newline', async ({ page }) => {
    await launch(page, {
      seed: {
        files: { [NOTE]: 'one\ntwo' },
        settings: { saving: { newLineEnding: 'crlf', newFinalNewline: true } },
      },
      open: NOTE,
      view: 'editor',
    });
    await expect.poll(() => editorText(page)).toBe('one\ntwo');
    await typeAtEnd(page, '!');
    await menu(page, 'save');
    await expect.poll(async () => (await saves(page)).length).toBe(1);
    const saved = (await saves(page))[0] as SavedCall;
    expect(saved.format.lineEnding).toBe('lf');
    expect(saved.text).toBe('one\ntwo!');
  });
});

test.describe('D16 default folder', () => {
  test('D16 the Save dialog of an untitled document gets the default folder', async ({ page }) => {
    await launch(page, { seed: { settings: { saving: { defaultFolder: `${HOME}/Documents` } } } });
    await menu(page, 'new');
    await typeAtEnd(page, 'a');
    await menu(page, 'save');
    await expect
      .poll(async () =>
        (await mockRead<Array<{ directory: string | null }>>(page, 'saveDialogs')).map(
          (d) => d.directory,
        ),
      )
      .toEqual([`${HOME}/Documents`]);
  });
});

const pill = (page: Page) => page.getByTestId('flavor-pill');

test.describe('D17 flavor detection switch', () => {
  const ROOT = `${HOME}/Vault`;
  const vault = {
    files: { [`${ROOT}/a.md`]: '# A\n', [`${ROOT}/b.qmd`]: '# B\n' },
    vault: { root: ROOT },
    vaults: [ROOT],
  };

  test('D17 on: a note in a vault is Obsidian with the auto mark', async ({ page }) => {
    await launch(page, { seed: vault, open: `${ROOT}/a.md`, view: 'split' });
    await expect(pill(page)).toContainText('Obsidian');
    await expect(page.getByTestId('flavor-auto')).toBeVisible();
  });

  test('D17 off: the same note opens as the default flavor, no auto mark', async ({ page }) => {
    await launch(page, {
      seed: { ...vault, settings: { preview: { autoDetectFlavor: false } } },
      open: `${ROOT}/a.md`,
      view: 'split',
    });
    await expect(pill(page)).toContainText('GFM');
    await expect(page.getByTestId('flavor-auto')).toHaveCount(0);
  });

  test('D17 off: .qmd is still Quarto', async ({ page }) => {
    await launch(page, {
      seed: { ...vault, settings: { preview: { autoDetectFlavor: false } } },
      open: `${ROOT}/b.qmd`,
      view: 'split',
    });
    await expect(pill(page)).toContainText('Quarto');
  });
});

const para = (page: Page) => preview(page).locator('p').first();
const computed = (page: Page, prop: string) =>
  para(page).evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

test.describe('D18 reading font, size and width', () => {
  const TEXT = '# Title\n\nBody text.\n';

  test('D18 size, family and width change the article; zoom multiplies', async ({ page }) => {
    await openNote(page, TEXT);
    expect(await computed(page, 'font-size')).toBe('15px');
    await change(page, { preview: { fontSize: 22, font: 'literata', columnWidth: 960 } });
    await expect.poll(() => computed(page, 'font-size')).toBe('22px');
    expect((await computed(page, 'font-family')).toLowerCase()).toContain('literata');
    expect(await preview(page).evaluate((el) => getComputedStyle(el).maxWidth)).toBe('960px');
    await change(page, { view: { zoom: 1.5 } });
    await expect.poll(() => computed(page, 'font-size')).toBe('33px');
  });

  test('D18 headings scale with the size', async ({ page }) => {
    await openNote(page, TEXT);
    const h1 = preview(page).locator('h1').first();
    const before = Number.parseFloat(await h1.evaluate((el) => getComputedStyle(el).fontSize));
    await change(page, { preview: { fontSize: 24 } });
    await expect
      .poll(async () => Number.parseFloat(await h1.evaluate((el) => getComputedStyle(el).fontSize)))
      .toBeGreaterThan(before);
  });

  test('D18 HTML export uses the chosen font size, family and width', async ({ page }) => {
    await openNote(page, TEXT, { preview: { fontSize: 22, font: 'system', columnWidth: 960 } });
    await mockCall(page, 'setAnswers', { saveDialog: `${HOME}/Documents/out.html` });
    await menu(page, 'export-html');
    await expect
      .poll(
        () => page.evaluate(() => window.__WRITEDOWN_MOCK__?.exports.at(-1)?.contents ?? null),
        {
          timeout: 30_000,
        },
      )
      .not.toBeNull();
    const html = (await page.evaluate(
      () => window.__WRITEDOWN_MOCK__?.exports.at(-1)?.contents,
    )) as string;
    expect(html).toContain('22px');
    expect(html).toContain('960px');
    expect(html).toContain('-apple-system');
  });
});

test.describe('D19 flavor-dependent options', () => {
  test('D19 hashtag pills: GFM on, CommonMark never', async ({ page }) => {
    await openNote(page, 'A #tag here.\n', { preview: { hashtagPills: true } });
    await expect(preview(page).locator('span.tag')).toHaveText('#tag');
  });

  test('D19 hashtag pills: CommonMark stays strict', async ({ page }) => {
    await openNote(page, 'A #tag here.\n', {
      defaultFlavor: 'commonmark',
      preview: { hashtagPills: true },
    });
    await expect(preview(page).locator('p').first()).toContainText('#tag');
    await expect(preview(page).locator('span.tag')).toHaveCount(0);
  });

  test('D19 Obsidian comments dimmed, still not counted as words', async ({ page }) => {
    const ROOT = `${HOME}/Vault`;
    await launch(page, {
      seed: {
        files: { [`${ROOT}/n.md`]: 'Visible words %%hidden notes here%% end.\n' },
        vault: { root: ROOT },
        vaults: [ROOT],
      },
      open: `${ROOT}/n.md`,
      view: 'split',
    });
    await expect(preview(page).locator('.wd-comment')).toHaveCount(0);
    const words = async () =>
      (await page.getByTestId('status-words').textContent())?.replace(/\s+/g, ' ');
    await expect.poll(words).toBe('Words: 3');
    const before = await words();
    await change(page, { preview: { obsidianCommentsDimmed: true } });
    await expect(preview(page).locator('.wd-comment')).toContainText('hidden notes here');
    expect(await words()).toBe(before);
  });

  test('D19 smart punctuation off in Pandoc gives straight quotes', async ({ page }) => {
    const path = `${HOME}/Documents/p.mmd`;
    await launch(page, {
      seed: { files: { [path]: 'She said "hello" -- fine.\n' } },
      open: path,
      view: 'preview',
    });
    await expect(preview(page)).toContainText('“hello”');
    await change(page, { preview: { smartPunctuation: false } });
    await expect(preview(page)).toContainText('"hello" --');
    await expect(preview(page)).not.toContainText('“');
  });

  test('D19 math off shows the source text', async ({ page }) => {
    await openNote(page, 'Inline $a+b$ and\n\n$$\nc^2\n$$\n');
    await expect(preview(page).locator('.math').first()).toBeVisible();
    await change(page, { preview: { math: false } });
    await expect(preview(page).locator('.math')).toHaveCount(0);
    await expect(preview(page)).toContainText('$a+b$');
    await expect(preview(page)).toContainText('c^2');
  });
});

test.describe('D20 remote images', () => {
  const SOURCE = [
    '![one](https://img.example.test/1.png)',
    '![two](https://img.example.test/2.png)',
    '[![three](https://img.example.test/3.png)](https://example.test/page)',
  ].join('\n\n');

  async function watch(page: Page): Promise<string[]> {
    const hits: string[] = [];
    await page.route('https://img.example.test/**', (route) => {
      hits.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'image/gif',
        body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
      });
    });
    return hits;
  }

  test('D20 off: no request, placeholders with alt text and host; on again loads them', async ({
    page,
  }) => {
    const hits = await watch(page);
    await openNote(page, SOURCE, { preview: { remoteImages: false } });
    const holders = preview(page).locator('.wd-image-remote-off');
    await expect(holders).toHaveCount(3);
    for (const [i, alt] of ['one', 'two', 'three'].entries()) {
      await expect(holders.nth(i)).toContainText(alt);
      await expect(holders.nth(i)).toContainText('img.example.test');
    }
    await page.waitForTimeout(600);
    expect(hits).toEqual([]);
    await change(page, { preview: { remoteImages: true } });
    await expect(preview(page).locator('.wd-image-remote-off')).toHaveCount(0);
    await expect.poll(() => hits.length).toBeGreaterThanOrEqual(3);
  });

  test('D20 HTML export keeps the remote address as written', async ({ page }) => {
    await watch(page);
    await openNote(page, SOURCE, { preview: { remoteImages: false } });
    await mockCall(page, 'setAnswers', { saveDialog: `${HOME}/Documents/out.html` });
    await menu(page, 'export-html');
    await expect
      .poll(
        () => page.evaluate(() => window.__WRITEDOWN_MOCK__?.exports.at(-1)?.contents ?? null),
        {
          timeout: 30_000,
        },
      )
      .not.toBeNull();
    const html = (await page.evaluate(
      () => window.__WRITEDOWN_MOCK__?.exports.at(-1)?.contents,
    )) as string;
    expect(html).toContain('https://img.example.test/1.png');
  });
});
