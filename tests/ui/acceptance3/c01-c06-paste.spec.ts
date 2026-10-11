/**
 * Phase 3 acceptance C01 to C06 (smart paste), in the whole app on the
 * mock platform. Expected Markdown comes from the hand-written fixtures in tests/fixtures/paste;
 * the other expected strings come from the rules of 2.5. Paste events are real ClipboardEvents
 * dispatched on the editor content with the formats a source puts on the pasteboard.
 */
import { type Page, test } from '@playwright/test';
import {
  choose,
  DOCS,
  editor,
  editorText,
  expect,
  fixture,
  launch,
  menu,
  setSelection,
  watchRequests,
} from '../acceptance2/common';

const paste = (name: string) => fixture(`paste/${name}`);
/** Runs of spaces are the only allowed difference (fixture README). */
const norm = (text: string) => text.replace(/[ ]+/g, ' ').trim();

interface PasteData {
  plain?: string;
  html?: string;
  uri?: string;
}

/** Opens a document in the editor view; the file extension decides the flavor. */
async function openDoc(page: Page, text: string, name = 'paste.md', clipboard?: string) {
  const path = `${DOCS}/${name}`;
  await page.setViewportSize({ width: 1280, height: 820 });
  await launch(page, {
    seed: { files: { [path]: text }, ...(clipboard === undefined ? {} : { clipboard }) },
    open: path,
    view: 'editor',
  });
  await expect(editor(page)).toBeVisible();
}

async function pasteEvent(page: Page, data: PasteData): Promise<void> {
  await page.evaluate((d) => {
    const transfer = new DataTransfer();
    if (d.plain !== undefined) transfer.setData('text/plain', d.plain);
    if (d.html !== undefined) transfer.setData('text/html', d.html);
    if (d.uri !== undefined) transfer.setData('text/uri-list', d.uri);
    const event = new ClipboardEvent('paste', {
      clipboardData: transfer,
      bubbles: true,
      cancelable: true,
    });
    document.querySelector('[data-testid="editor"] .cm-content')?.dispatchEvent(event);
  }, data);
}

/** The paste stays plain: the text is what an ordinary paste gives, and still is after a pause. */
async function expectPlain(page: Page, expected: string): Promise<void> {
  await expect.poll(() => editorText(page)).toBe(expected);
  await page.waitForTimeout(400);
  expect(await editorText(page)).toBe(expected);
}

const undo = async (page: Page) => {
  await page.keyboard.press('ControlOrMeta+z');
};

test.describe('C01 URL over a selection', () => {
  const url = 'https://example.org/page';

  test('C01 a one-line selection becomes a link, and undo gives the plain URL', async ({
    page,
  }) => {
    await openDoc(page, 'see here now');
    await setSelection(page, 4, 8);
    await pasteEvent(page, { plain: url });
    await expect.poll(() => editorText(page)).toBe(`see [here](${url}) now`);
    await undo(page);
    expect(await editorText(page)).toBe(`see ${url} now`);
  });

  test('C01 mailto and http are links too', async ({ page }) => {
    await openDoc(page, 'write to me');
    await setSelection(page, 9, 11);
    await pasteEvent(page, { plain: 'mailto:me@example.org' });
    await expect.poll(() => editorText(page)).toBe('write to [me](mailto:me@example.org)');
  });

  test('C01 without a selection the URL pastes as text', async ({ page }) => {
    await openDoc(page, 'a b');
    await setSelection(page, 1);
    await pasteEvent(page, { plain: url });
    await expectPlain(page, `a${url} b`);
  });

  test('C01 over a multi-line selection the URL replaces the text', async ({ page }) => {
    await openDoc(page, 'one\ntwo');
    await setSelection(page, 0, 7);
    await pasteEvent(page, { plain: url });
    await expectPlain(page, url);
  });

  test('C01 over text that is already a link the URL pastes as text', async ({ page }) => {
    await openDoc(page, '[a link](https://example.org)');
    await setSelection(page, 1, 7);
    await pasteEvent(page, { plain: url });
    await expectPlain(page, `[${url}](https://example.org)`);
  });

  test('C01 inside a fenced code block the URL pastes as text', async ({ page }) => {
    await openDoc(page, '```\ncode\n```');
    await setSelection(page, 4, 8);
    await pasteEvent(page, { plain: url });
    await expectPlain(page, `\`\`\`\n${url}\n\`\`\``);
  });
});

test.describe('C02 a web page', () => {
  test('C02 pastes as the expected Markdown in one undo step; undo gives the plain text', async ({
    page,
  }) => {
    await openDoc(page, '');
    await setSelection(page, 0);
    await pasteEvent(page, {
      plain: 'plain fallback',
      html: paste('web.html'),
      uri: paste('web.source-url.txt').trim(),
    });
    await expect.poll(async () => (await editorText(page)) !== 'plain fallback').toBe(true);
    expect(norm(await editorText(page))).toBe(norm(paste('web.expected.md')));
    // Scripts, styles and comments are gone.
    expect(await editorText(page)).not.toMatch(/tracker|font-family|synthetic|<script|<style/);
    await undo(page);
    expect(await editorText(page)).toBe('plain fallback');
    await undo(page);
    expect(await editorText(page)).toBe('');
  });
});

test.describe('C03 Word and Outlook', () => {
  for (const name of ['word', 'outlook'] as const) {
    test(`C03 the ${name} fixture pastes without mso remnants or empty paragraphs`, async ({
      page,
    }) => {
      await openDoc(page, '');
      await setSelection(page, 0);
      await pasteEvent(page, { plain: 'fallback', html: paste(`${name}.html`) });
      await expect.poll(async () => (await editorText(page)) !== 'fallback').toBe(true);
      const out = await editorText(page);
      expect(norm(out)).toBe(norm(paste(`${name}.expected.md`)));
      expect(out).not.toMatch(/mso|<o:p>|StartFragment|\[if|&nbsp;/i);
      // No run of three line breaks: empty paragraphs would leave them.
      expect(out).not.toMatch(/\n\n\n/);
    });
  }

  test('C03 Word list paragraphs become nested list items', async ({ page }) => {
    await openDoc(page, '');
    await setSelection(page, 0);
    await pasteEvent(page, { plain: 'fallback', html: paste('word.html') });
    await expect.poll(async () => (await editorText(page)) !== 'fallback').toBe(true);
    const lines = (await editorText(page)).split('\n');
    const nested = lines.filter((line) => /^\s{2,}[-*] /.test(line));
    const top = lines.filter((line) => /^[-*] /.test(line));
    expect(top.length).toBeGreaterThan(0);
    expect(nested.length).toBeGreaterThan(0);
  });
});

test.describe('C04 spreadsheet cells', () => {
  test('C04 Excel HTML gives a pipe table with a header', async ({ page }) => {
    await openDoc(page, '');
    await setSelection(page, 0);
    await pasteEvent(page, { plain: paste('excel.tsv'), html: paste('excel.html') });
    await expect.poll(async () => (await editorText(page)).startsWith('| Item')).toBe(true);
    expect(await editorText(page)).toBe(paste('excel.expected.md').trimEnd());
  });

  test('C04 tab-separated text alone gives the same table; undo restores the tabs', async ({
    page,
  }) => {
    await openDoc(page, '');
    await setSelection(page, 0);
    await pasteEvent(page, { plain: paste('excel.tsv') });
    await expect.poll(async () => (await editorText(page)).startsWith('| Item')).toBe(true);
    expect(await editorText(page)).toBe(paste('excel.expected.md').trimEnd());
    await undo(page);
    expect(await editorText(page)).toBe(paste('excel.tsv'));
  });

  test('C04 ragged tab-separated text pastes as text', async ({ page }) => {
    await openDoc(page, '');
    await setSelection(page, 0);
    await pasteEvent(page, { plain: paste('ragged.tsv') });
    await expectPlain(page, paste('ragged.tsv'));
  });

  test('C04 a pipe in a cell is escaped', async ({ page }) => {
    await openDoc(page, '');
    await setSelection(page, 0);
    await pasteEvent(page, { plain: 'h1\th2\nx|y\tz' });
    await expect.poll(async () => (await editorText(page)).includes('---')).toBe(true);
    expect(await editorText(page)).toContain('x\\|y');
  });
});

test.describe('C05 flavor and context', () => {
  test('C05 CommonMark: a table becomes an HTML table block and strikethrough is plain text', async ({
    page,
  }) => {
    await openDoc(page, '');
    await choose(page, /CommonMark/);
    await setSelection(page, 0);
    await pasteEvent(page, {
      plain: 'x',
      html: '<table><tr><th>A</th></tr><tr><td>1</td></tr></table><p>a <del>b</del></p>',
    });
    await expect.poll(async () => (await editorText(page)) !== 'x').toBe(true);
    const out = await editorText(page);
    expect(out).toContain('<table>');
    expect(out).toContain('<th>A</th>');
    expect(out).toContain('a b');
    expect(out).not.toContain('~~');
    expect(out).not.toContain('| A |');
  });

  test('C05 GFM keeps the pipe table and strikethrough', async ({ page }) => {
    await openDoc(page, '');
    await setSelection(page, 0);
    await pasteEvent(page, {
      plain: 'x',
      html: '<table><tr><th>A</th></tr><tr><td>1</td></tr></table><p>a <del>b</del></p>',
    });
    await expect.poll(async () => (await editorText(page)) !== 'x').toBe(true);
    const out = await editorText(page);
    expect(out).toContain('| A |');
    expect(out).toContain('~~b~~');
  });

  test('C05 inside a fence the paste is plain', async ({ page }) => {
    await openDoc(page, '```\ncode\n```');
    await setSelection(page, 4);
    await pasteEvent(page, { plain: 'x', html: '<b>x</b>' });
    await expectPlain(page, '```\nxcode\n```');
  });

  test('C05 inside a chunk the paste is plain', async ({ page }) => {
    const text = '```{r}\nplot(1)\n```\n';
    await openDoc(page, text, 'paste.qmd');
    await setSelection(page, 7);
    await pasteEvent(page, { plain: 'x', html: '<b>x</b>' });
    await expectPlain(page, '```{r}\nxplot(1)\n```\n');
  });

  test('C05 inside frontmatter the paste is plain', async ({ page }) => {
    await openDoc(page, '---\ntitle: a\n---\n\nbody');
    await setSelection(page, 10);
    await pasteEvent(page, { plain: 'x', html: '<b>x</b>' });
    await expectPlain(page, '---\ntitle:x a\n---\n\nbody');
  });

  test('C05 inside inline code the paste is plain', async ({ page }) => {
    await openDoc(page, 'a `code` b');
    await setSelection(page, 4);
    await pasteEvent(page, { plain: 'x', html: '<b>x</b>' });
    await expectPlain(page, 'a `cxode` b');
  });

  test('C05 Paste and Match Style inserts the clipboard text unchanged', async ({ page }) => {
    await openDoc(page, 'start ', 'paste.md', '**raw** <b>text</b>');
    await setSelection(page, 6);
    await menu(page, 'paste-plain');
    await expect.poll(() => editorText(page)).toBe('start **raw** <b>text</b>');
  });
});

test.describe('C06 the converter is loaded on the first rich paste only', () => {
  test('C06 no converter request on the welcome screen, on a GFM document or on a table paste', async ({
    page,
  }) => {
    const requests = watchRequests(page);
    const converter = () => requests.some((url) => /editor\/paste\/convert/.test(url));

    await launch(page);
    await page.waitForLoadState('networkidle');
    expect(converter()).toBe(false);

    await openDoc(page, 'a');
    await page.waitForLoadState('networkidle');
    expect(converter()).toBe(false);

    // Tab-separated text is handled without the converter.
    await setSelection(page, 1);
    await pasteEvent(page, { plain: 'a\tb\nc\td' });
    await expect.poll(async () => (await editorText(page)).includes('---')).toBe(true);
    expect(converter()).toBe(false);

    // The first HTML paste loads it.
    await pasteEvent(page, { plain: 'x', html: '<b>x</b>' });
    await expect.poll(converter).toBe(true);
  });
});
