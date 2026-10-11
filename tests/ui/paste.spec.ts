/**
 * Smart paste in real WebKit, with synthetic
 * ClipboardEvents that carry the fixtures of tests/fixtures/paste.
 */
import { expect, type Page, test } from '@playwright/test';
import { editor, fixture, menu, seedMock } from './helpers';

interface Api {
  getText(): string;
  setText(text: string): void;
  setFlavor(flavor: string): void;
  undo(): boolean;
  focus(): void;
  view: { dispatch(spec: unknown): void };
}
const HARNESS = '/tests/harness/editor.html';
const paste = (name: string) => fixture(`paste/${name}`);
/** Runs of spaces are the only allowed difference (fixture README). */
const norm = (text: string) => text.replace(/[ ]+/g, ' ').trim();

async function openEditor(page: Page, text = '', flavor = 'gfm'): Promise<void> {
  await page.goto(HARNESS);
  await page.waitForFunction(() => (window as unknown as { __ready: boolean }).__ready === true);
  await page.evaluate(
    ([doc, f]) => {
      const api = (window as unknown as { __editor: Api }).__editor;
      api.setFlavor(f as string);
      api.setText(doc as string);
      api.focus();
    },
    [text, flavor],
  );
}

const select = (page: Page, anchor: number, head: number) =>
  page.evaluate(
    ([a, h]) =>
      (window as unknown as { __editor: Api }).__editor.view.dispatch({
        selection: { anchor: a, head: h },
      }),
    [anchor, head],
  );

const text = (page: Page) =>
  page.evaluate(() => (window as unknown as { __editor: Api }).__editor.getText());

const undo = (page: Page) =>
  page.evaluate(() => (window as unknown as { __editor: Api }).__editor.undo());

/** Dispatches a paste event with the given clipboard formats. */
async function paste_(page: Page, data: { plain?: string; html?: string; uri?: string }) {
  await page.evaluate((d) => {
    const dt = new DataTransfer();
    if (d.plain !== undefined) dt.setData('text/plain', d.plain);
    if (d.html !== undefined) dt.setData('text/html', d.html);
    if (d.uri !== undefined) dt.setData('text/uri-list', d.uri);
    const event = new ClipboardEvent('paste', {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    });
    document.querySelector('.cm-content')?.dispatchEvent(event);
  }, data);
}

/** The paste stayed plain: the text is the expected one and still is after the converter would be done. */
async function plainResult(page: Page, expected: string) {
  expect(await text(page)).toBe(expected);
  await page.waitForTimeout(300);
  expect(await text(page)).toBe(expected);
}

/** Lets the lazy converter finish. */
const settle = (page: Page, expected: (current: string) => boolean) =>
  expect.poll(async () => expected(await text(page))).toBe(true);

test.describe('C01 URL over a selection', () => {
  const url = 'https://example.org/page';
  test('a one-line selection becomes a link', async ({ page }) => {
    await openEditor(page, 'see here now');
    await select(page, 4, 8);
    await paste_(page, { plain: url });
    await settle(page, (t) => t === `see [here](${url}) now`);
    await undo(page);
    expect(await text(page)).toBe(`see ${url} now`);
  });
  test('no selection, several lines, a link and code paste the URL as text', async ({ page }) => {
    await openEditor(page, 'a b');
    await select(page, 1, 1);
    await paste_(page, { plain: url });
    await plainResult(page, `a${url} b`);

    await openEditor(page, 'one\ntwo');
    await select(page, 0, 7);
    await paste_(page, { plain: url });
    await plainResult(page, url);

    await openEditor(page, '[a link](https://example.org)');
    await select(page, 1, 7);
    await paste_(page, { plain: url });
    await plainResult(page, `[${url}](https://example.org)`);

    await openEditor(page, '```\ncode\n```');
    await select(page, 4, 8);
    await paste_(page, { plain: url });
    await plainResult(page, `\`\`\`\n${url}\n\`\`\``);
  });
});

test.describe('C02 to C03 HTML', () => {
  test('C02 the web page fixture pastes as the expected Markdown, in one undo step', async ({
    page,
  }) => {
    await openEditor(page);
    await paste_(page, {
      plain: 'plain fallback',
      html: paste('web.html'),
      uri: paste('web.source-url.txt').trim(),
    });
    await settle(page, (t) => t !== 'plain fallback');
    expect(norm(await text(page))).toBe(norm(paste('web.expected.md')));
    expect(await text(page)).not.toMatch(/tracker|font-family/);
    await undo(page);
    expect(await text(page)).toBe('plain fallback');
    await undo(page);
    expect(await text(page)).toBe('');
  });

  for (const name of ['word', 'outlook']) {
    test(`C03 the ${name} fixture pastes clean`, async ({ page }) => {
      await openEditor(page);
      await paste_(page, { plain: 'fallback', html: paste(`${name}.html`) });
      await settle(page, (t) => t !== 'fallback');
      const out = await text(page);
      expect(norm(out)).toBe(norm(paste(`${name}.expected.md`)));
      expect(out).not.toMatch(/mso|<o:p>|StartFragment|\[if/i);
    });
  }
});

test.describe('C04 spreadsheet cells', () => {
  test('Excel HTML gives a pipe table', async ({ page }) => {
    await openEditor(page);
    await paste_(page, { plain: paste('excel.tsv'), html: paste('excel.html') });
    await settle(page, (t) => t.startsWith('| Item'));
    expect(await text(page)).toBe(paste('excel.expected.md').trimEnd());
  });
  test('TSV text gives the same table', async ({ page }) => {
    await openEditor(page);
    await paste_(page, { plain: paste('excel.tsv') });
    await settle(page, (t) => t.startsWith('| Item'));
    expect(await text(page)).toBe(paste('excel.expected.md').trimEnd());
    await undo(page);
    expect(await text(page)).toBe(paste('excel.tsv'));
  });
  test('ragged TSV pastes as text', async ({ page }) => {
    await openEditor(page);
    await paste_(page, { plain: paste('ragged.tsv') });
    await plainResult(page, paste('ragged.tsv'));
  });
});

test.describe('C05 flavor and context', () => {
  test('CommonMark gets an HTML table block and no strikethrough', async ({ page }) => {
    await openEditor(page, '', 'commonmark');
    await paste_(page, {
      plain: 'x',
      html: '<table><tr><th>A</th></tr><tr><td>1</td></tr></table><p>a <del>b</del></p>',
    });
    await settle(page, (t) => t !== 'x');
    const out = await text(page);
    expect(out).toContain('<table>');
    expect(out).toContain('<th>A</th>');
    expect(out).toContain('a b');
    expect(out).not.toContain('~~');
  });
  test('inside a fence and frontmatter the paste stays plain', async ({ page }) => {
    await openEditor(page, '```\ncode\n```');
    await select(page, 4, 4);
    await paste_(page, { plain: 'x', html: '<b>x</b>' });
    await plainResult(page, '```\nxcode\n```');

    await openEditor(page, '---\ntitle: a\n---\n\nbody');
    await select(page, 10, 10);
    await paste_(page, { plain: 'x', html: '<b>x</b>' });
    await plainResult(page, '---\ntitle:x a\n---\n\nbody');

    await openEditor(page, 'a `code` b');
    await select(page, 4, 4);
    await paste_(page, { plain: 'x', html: '<b>x</b>' });
    await plainResult(page, 'a `cxode` b');
  });
  test('outside code the same HTML converts', async ({ page }) => {
    await openEditor(page, 'body');
    await select(page, 4, 4);
    await paste_(page, { plain: 'x', html: '<b>x</b>' });
    await settle(page, (t) => t === 'body**x**');
  });
  test('Paste and Match Style inserts the clipboard text', async ({ page }) => {
    await seedMock(page, {
      clipboard: '**raw** text',
      launch: { openPath: '/Users/mock/a.md', view: 'split' },
      files: { '/Users/mock/a.md': 'start ' },
    });
    await page.goto('/');
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await menu(page, 'paste-plain');
    await expect(editor(page)).toContainText('start **raw** text');
  });
});

test.describe('C06 the converter is a lazy chunk', () => {
  test('it loads on the first rich paste only', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await openEditor(page, 'a');
    await paste_(page, { plain: 'a\tb\nc\td' });
    await settle(page, (t) => t.includes('| ---'));
    expect(requests.some((u) => /paste\/convert/.test(u))).toBe(false);
    await paste_(page, { plain: 'x', html: '<b>x</b>' });
    await expect.poll(() => requests.some((u) => /paste\/convert/.test(u))).toBe(true);
  });
  test('the welcome screen and a GFM document do not load it', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await seedMock(page, { launch: { welcome: true } });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(requests.some((u) => /paste\/convert/.test(u))).toBe(false);

    await seedMock(page, {
      launch: { openPath: '/Users/mock/a.md', view: 'split' },
      files: { '/Users/mock/a.md': '# A\n' },
    });
    await page.goto('/');
    await expect(editor(page)).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(requests.some((u) => /paste\/convert/.test(u))).toBe(false);
  });
});
