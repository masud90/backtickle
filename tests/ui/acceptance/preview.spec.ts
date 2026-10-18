/**
 * Acceptance cases A15 to A22: preview, links, images, flavors
 * and statistics. Expected values come from the specification, the fixtures and independent
 * computations (an Intl.Segmenter oracle evaluated in the same engine as the page).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Page, test } from '@playwright/test';
import {
  activeName,
  blocks,
  dirtyDot,
  editorText,
  expect,
  FIXTURES,
  fixture,
  fixtureDataUrl,
  gfmGuide,
  launch,
  menu,
  mockRead,
  openFiles,
  previewReady,
  selectText,
  setAnswers,
  setSelection,
  settingsOf,
  setView,
  TEST_TIMEOUT,
  typeAtEnd,
} from './support';

test.setTimeout(TEST_TIMEOUT);

const DOCS = '/Users/mock/docs';
const LINKS = '/Users/mock/links';

const tabNamed = (page: Page, name: string) =>
  page.getByTestId('tab-strip').getByRole('tab', { name: new RegExp(name.replace(/\./g, '\\.')) });

// ---- A15 ---------------------------------------------------------------------------------------

/** GitHub-style slugs, computed here from the guide source (independent of the app). */
function expectedHeadings(source: string): Array<{ level: number; text: string; id: string }> {
  const out: Array<{ level: number; text: string; id: string }> = [];
  const seen = new Map<string, number>();
  let fence: string | null = null;
  const lines = source.replace(/^---\n[\s\S]*?\n---\n/, '').split('\n');
  for (const line of lines) {
    const open = /^(`{3,}|~{3,})/.exec(line);
    if (fence === null && open) {
      fence = open[1] as string;
      continue;
    }
    if (fence !== null) {
      if (line.startsWith(fence) && line.trim() === fence) fence = null;
      continue;
    }
    const match = /^(#{1,6}) +(.+?) *#*$/.exec(line);
    if (!match) continue;
    const text = (match[2] as string).trim();
    const base = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/\s+/g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    out.push({
      level: (match[1] as string).length,
      text,
      id: count === 0 ? base : `${base}-${count}`,
    });
  }
  return out;
}

test('A15 The GFM guide renders every element with the contract classes', async ({ page }) => {
  await launch(page);
  await menu(page, 'markdown-guide');
  await expect(activeName(page)).toHaveText('Markdown Guide');
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'preview');
  // The footnotes block renders last: when it is there, the whole guide is in.
  await expect(page.locator('[data-testid="preview"] .footnotes')).toBeAttached();
  const root = page.locator('article.wd-preview');
  await expect(root).toHaveCount(1);

  // Frontmatter header: tags as pills, version and author as muted text, no second H1.
  const front = root.locator('header.wd-frontmatter');
  await expect(front).toHaveCount(1);
  for (const tag of ['markdown', 'gfm', 'reference']) await expect(front).toContainText(tag);
  await expect(front).toContainText('Version 1.0.0');
  await expect(front).toContainText('Backtickle');
  await expect(root.locator('h1')).toHaveCount(1);
  await expect(root.locator('h1')).toHaveText('Markdown Guide');

  // Every block is a wrapper with line attributes.
  const wrappers = await blocks(page).evaluateAll((els) =>
    els.map((el) => [
      el.getAttribute('data-line'),
      el.getAttribute('data-end-line'),
      el.getAttribute('data-key'),
    ]),
  );
  expect(wrappers.length).toBeGreaterThan(20);
  for (const [line, end, key] of wrappers) {
    expect(Number.isInteger(Number(line))).toBe(true);
    expect(Number(end)).toBeGreaterThanOrEqual(Number(line));
    expect(key).toBeTruthy();
  }

  // Alerts of all five types, each with an icon and a title.
  for (const kind of ['note', 'tip', 'important', 'warning', 'caution']) {
    const callout = root.locator(`div.callout.callout-${kind}`);
    await expect(callout, `callout ${kind}`).toHaveCount(1);
    await expect(callout.locator('p.callout-title span.callout-icon[data-icon]')).toHaveCount(1);
    await expect(callout.locator('p.callout-title')).toContainText(new RegExp(kind, 'i'));
  }

  // Task boxes: five in the guide, three of them checked, all keyboard reachable spans.
  const boxes = root.locator('li.task-list-item > span.task-checkbox[role="checkbox"]');
  await expect(boxes).toHaveCount(5);
  for (let i = 0; i < 5; i++) {
    const box = boxes.nth(i);
    await expect(box).toHaveAttribute('aria-checked', /^(true|false)$/);
    await expect(box).toHaveAttribute('tabindex', '0');
    await expect(box).toHaveAttribute('data-task-line', /^\d+$/);
  }
  await expect(root.locator('span.task-checkbox[aria-checked="true"]')).toHaveCount(3);
  await expect(root.locator('input')).toHaveCount(0);

  // Code cards: language label, header, actions with a Copy button, pre > code.
  for (const lang of ['typescript', 'python', 'r', 'sql', 'bash']) {
    const card = root.locator(`div.code-card[data-lang="${lang}"]`);
    await expect(card, `code card ${lang}`).toHaveCount(1);
    await expect(card.locator('div.code-card-header span.code-card-lang')).toHaveText(
      new RegExp(`^${lang}$`, 'i'),
    );
    await expect(
      card.locator('span.code-card-actions').getByRole('button', { name: /copy/i }),
    ).toHaveCount(1);
    await expect(card.locator('pre > code')).toHaveCount(1);
  }
  // Tokens are colored with Lezer classes after sanitizing.
  await expect(
    root.locator('div.code-card[data-lang="typescript"] [class*="tok-"]').first(),
  ).toBeAttached();

  // Table alignment: left, center and right columns (computed style, whatever the class names).
  const aligns = await root.evaluate((article) => {
    const table = Array.from(article.querySelectorAll('table')).find((t) =>
      t.textContent?.includes('Left aligned'),
    );
    if (!table) return null;
    const cells = (selector: string) =>
      Array.from(table.querySelectorAll(selector)).map((c) => getComputedStyle(c).textAlign);
    return { head: cells('thead th'), first: cells('tbody tr:first-child td') };
  });
  expect(aligns).not.toBeNull();
  const norm = (list: string[] | undefined) =>
    (list ?? []).map((a) => (a === 'start' ? 'left' : a === 'end' ? 'right' : a));
  expect(norm(aligns?.head)).toEqual(['left', 'center', 'right']);
  expect(norm(aligns?.first)).toEqual(['left', 'center', 'right']);

  // Math as MathML: one inline formula, two display formulas ($$ and a math fence).
  const inline = root.locator('span.math.math-inline[data-tex]');
  await expect(inline).toHaveCount(1);
  await expect(inline).toHaveAttribute('data-tex', 'E = mc^2');
  await expect(inline.locator('math')).toHaveCount(1);
  const display = root.locator('div.math.math-display[data-tex]');
  await expect(display).toHaveCount(2);
  await expect(display.nth(0).locator('math')).toHaveCount(1);
  await expect(display.nth(1).locator('math')).toHaveCount(1);
  await expect(display.nth(0)).toHaveAttribute(
    'data-tex',
    /\\int_0\^1 x\^2\\,dx = \\frac\{1\}\{3\}/,
  );
  await expect(root.locator('.katex-html')).toHaveCount(0);

  // Emoji shortcodes become characters.
  const emoji = root
    .locator('p', { hasText: 'emoji shortcodes like' })
    .filter({ hasText: 'in your Markdown' });
  await expect(emoji).toHaveCount(1);
  await expect(emoji).toContainText('\u{1F389}');
  await expect(emoji).toContainText('\u{1F680}');
  await expect(emoji).not.toContainText(':tada:');

  // Heading ids follow the GitHub rules: compare every heading with an independent computation.
  const headings = await root.evaluate((article) =>
    Array.from(article.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h) => ({
      level: Number(h.tagName.slice(1)),
      text: h.textContent?.trim() ?? '',
      id: h.id,
    })),
  );
  expect(headings).toEqual(expectedHeadings(gfmGuide()));

  // Footnotes: two references, a footnotes block with both texts, and it is the last block.
  await expect(root.locator('sup.footnote-ref')).toHaveCount(2);
  const notes = root.locator('.footnotes');
  await expect(notes).toContainText('This is the first footnote content.');
  await expect(notes).toContainText('This is the second footnote content with more detail.');
  const lastBlockHasNotes = await blocks(page)
    .last()
    .evaluate((el) => el.querySelector('.footnotes') !== null);
  expect(lastBlockHasNotes).toBe(true);

  // The rest of the GFM elements.
  await expect(root.locator('blockquote blockquote')).toHaveCount(1);
  await expect(root.locator('ol ol')).toHaveCount(1);
  await expect(root.locator('del, s').first()).toContainText('strikethrough');
  await expect(root.locator('hr:not(.footnotes-sep)')).toHaveCount(1);
  await expect(root.locator('details > summary')).toHaveText('Click to expand');
  await expect(root.locator('a[href="https://example.org"]')).toHaveCount(2); // inline link and autolink
  await expect(root.locator('a[href="#headings"]')).toHaveCount(1);
  const image = root.locator('img[src^="data:image/png"]');
  await expect(image).toHaveCount(1);
  // Images load lazily: bring it into view first.
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(8);
});

// ---- A16 ---------------------------------------------------------------------------------------

const TASKS = [
  '- [ ] one',
  '- [x] two',
  '* [ ] star',
  '1. [ ] numbered',
  '- [ ] parent',
  '  - [ ] child',
];
const flip = (line: string) =>
  line.includes('[ ]') ? line.replace('[ ]', '[x]') : line.replace('[x]', '[ ]');

test('A16 Clicking a task box toggles the source once per click, is undoable; Space on a focused box does the same', async ({
  page,
}) => {
  const path = `${DOCS}/tasks.md`;
  // The file has CRLF line endings: the toggles must work on that origin too.
  await launch(page, {
    seed: { files: { [path]: `${TASKS.join('\r\n')}\r\n` } },
    open: path,
    view: 'preview',
  });
  const boxes = page.locator('[data-testid="preview"] span.task-checkbox');
  await expect(boxes).toHaveCount(6);
  const original = `${TASKS.join('\n')}\n`;
  expect(await editorText(page)).toBe(original);

  for (let i = 0; i < TASKS.length; i++) {
    const expected = TASKS.map((line, j) => (j === i ? flip(line) : line));
    await boxes.nth(i).click();
    await expect
      .poll(() => editorText(page), { message: `box ${i} toggles its line once` })
      .toBe(`${expected.join('\n')}\n`);
    await expect(boxes.nth(i)).toHaveAttribute(
      'aria-checked',
      TASKS[i]?.includes('[ ]') ? 'true' : 'false',
    );
    await expect(dirtyDot(page)).toBeVisible();
    // Undo restores the source in one step.
    await menu(page, 'undo');
    await expect.poll(() => editorText(page)).toBe(original);
    await expect(dirtyDot(page)).toHaveCount(0);
  }

  // A second click on the same box toggles it back.
  await boxes.nth(0).click();
  await expect
    .poll(() => editorText(page))
    .toBe(`${['- [x] one', ...TASKS.slice(1)].join('\n')}\n`);
  await boxes.nth(0).click();
  await expect.poll(() => editorText(page)).toBe(original);

  // Space on a focused box.
  await boxes.nth(1).focus();
  await page.keyboard.press('Space');
  await expect
    .poll(() => editorText(page))
    .toBe(`${TASKS.map((line, j) => (j === 1 ? flip(line) : line)).join('\n')}\n`);
  await page.keyboard.press('Space');
  await expect.poll(() => editorText(page)).toBe(original);
  // Nothing was lost on the way: the document is clean again once the text is the original.
  await expect(dirtyDot(page)).toHaveCount(0);
});

// ---- A17 ---------------------------------------------------------------------------------------

const LINE_DOC = [
  '# Title', // 0
  '', // 1
  'First paragraph.', // 2
  '', // 3
  '- item a', // 4
  '- item b', // 5
  '', // 6
  '> quote', // 7
  '', // 8
  '```js', // 9
  'code', // 10
  '```', // 11
  '', // 12
  '| a | b |', // 13
  '| - | - |', // 14
  '| 1 | 2 |', // 15
  '', // 16
  'Text with a note[^1].', // 17
  '', // 18
  '[^1]: The note.', // 19
  '', // 20
  'Last paragraph.', // 21
  '',
].join('\n');

test('A17 Blocks carry increasing source lines; after an edit only the changed block is replaced', async ({
  page,
}) => {
  const path = `${DOCS}/lines.md`;
  await launch(page, { seed: { files: { [path]: LINE_DOC } }, open: path, view: 'split' });
  await expect(page.locator('[data-testid="preview"] .footnotes')).toBeAttached();

  const read = () =>
    blocks(page).evaluateAll((els) =>
      els.map((el) => ({
        line: Number(el.getAttribute('data-line')),
        end: Number(el.getAttribute('data-end-line')),
        text: (el.textContent ?? '').trim().slice(0, 24),
        notes: el.querySelector('.footnotes') !== null,
      })),
    );
  const before = await read();
  // Title, paragraph, list, quote, code, table, paragraph with the note, last paragraph, footnotes.
  expect(before.map((b) => b.line)).toEqual([0, 2, 4, 7, 9, 13, 17, 21, 19]);
  expect(before.slice(0, 8).map((b) => b.end)).toEqual([0, 2, 5, 7, 11, 15, 17, 21]);
  expect(before.at(-1)?.notes).toBe(true);
  // Increasing everywhere except the footnotes block, which renders last with its own line.
  const main = before.slice(0, -1).map((b) => b.line);
  expect([...main].sort((a, b) => a - b)).toEqual(main);

  // Remember the DOM elements.
  await blocks(page).evaluateAll((els) => {
    (window as unknown as { __kept: Element[] }).__kept = els;
  });
  const identity = () =>
    blocks(page).evaluateAll((els) =>
      els.map((el, i) => el === (window as unknown as { __kept: Element[] }).__kept[i]),
    );

  // Edit inside the first paragraph: only that block's element is replaced.
  const firstEnd = LINE_DOC.indexOf('First paragraph.') + 'First paragraph.'.length;
  await setSelection(page, firstEnd);
  await page.keyboard.type(' more');
  await expect(blocks(page).nth(1)).toContainText('First paragraph. more');
  const same = await identity();
  expect(same.length).toBe(before.length);
  expect(same.map((kept, i) => (kept ? null : i)).filter((i) => i !== null)).toEqual([1]);

  // A new line inside the paragraph shifts the lines of what follows; those elements are kept
  // and their line attributes follow in place.
  await page.keyboard.press('Enter');
  await page.keyboard.type('and a second line');
  await expect(blocks(page).nth(1)).toContainText('and a second line');
  const after = await read();
  expect(after.slice(2, 8).map((b) => b.line)).toEqual([5, 8, 10, 14, 18, 22]);
  expect(after[1]?.line).toBe(2);
  expect(after[1]?.end).toBe(3);
  const kept = await identity();
  expect(kept.map((k, i) => (k ? null : i)).filter((i) => i !== null)).toEqual([1]);
});

// ---- A18 ---------------------------------------------------------------------------------------

test('A18 The malicious corpus executes nothing and leaves no active content in the preview', async ({
  page,
}) => {
  const path = `${DOCS}/xss.md`;
  const corpus = fixture('xss/corpus.md');
  await launch(page, { seed: { files: { [path]: corpus } } });
  const navigations: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  const startUrl = page.url();
  await openFiles(page, [path]);
  await expect(activeName(page)).toContainText('xss.md');
  const headingTexts = [...corpus.matchAll(/^## (.+)$/gm)].map((m) => m[1] as string);
  const lastHeading = headingTexts.at(-1) as string;
  await expect(page.locator('[data-testid="preview"] h2', { hasText: lastHeading })).toBeAttached();

  const scan = () =>
    page.evaluate(() => {
      const article = document.querySelector('[data-testid="preview"]') as Element;
      const all = Array.from(article.querySelectorAll('*'));
      const onAttrs: string[] = [];
      const badUrls: string[] = [];
      const styled: string[] = [];
      for (const el of all) {
        for (const attr of Array.from(el.attributes)) {
          if (/^on/i.test(attr.name)) onAttrs.push(`${el.tagName}.${attr.name}`);
          if (/^(href|src|xlink:href|action|formaction|data|srcdoc|poster)$/i.test(attr.name)) {
            const v = Array.from(attr.value)
              .filter((ch) => ch.charCodeAt(0) > 32)
              .join('')
              .toLowerCase();
            if (/^(javascript|vbscript):/.test(v) || v.startsWith('data:text/html')) {
              badUrls.push(`${el.tagName}.${attr.name}=${attr.value.slice(0, 40)}`);
            }
          }
          if (attr.name.toLowerCase() === 'style') styled.push(el.tagName);
        }
      }
      const count = (selector: string) => document.querySelectorAll(selector).length;
      return {
        sentinel: (window as unknown as { __XSS_SENTINEL__?: unknown }).__XSS_SENTINEL__,
        onAttrs,
        badUrls,
        styled,
        iframes: count('iframe'),
        forms: count('form'),
        objects: count('object, embed'),
        inArticle: {
          scripts: article.querySelectorAll('script').length,
          inputs: article.querySelectorAll('input, textarea, select').length,
          // The Copy buttons of code cards are ours and are inserted after sanitizing.
          buttons: Array.from(article.querySelectorAll('button')).filter(
            (b) => !b.closest('.code-card-actions'),
          ).length,
          styles: article.querySelectorAll('style, meta, base, link, template, dialog').length,
        },
      };
    });

  const check = async (label: string) => {
    const result = await scan();
    expect(result.sentinel, `${label}: sentinel`).toBeUndefined();
    expect(result.onAttrs, `${label}: on* attributes`).toEqual([]);
    expect(result.badUrls, `${label}: script URLs`).toEqual([]);
    expect(result.styled, `${label}: style attributes`).toEqual([]);
    expect(result.iframes, `${label}: iframes`).toBe(0);
    expect(result.forms, `${label}: forms`).toBe(0);
    expect(result.objects, `${label}: object and embed`).toBe(0);
    expect(result.inArticle, `${label}: other active elements`).toEqual({
      scripts: 0,
      inputs: 0,
      buttons: 0,
      styles: 0,
    });
  };
  await check('preview');
  // The editor shows the same text as source and the preview follows when it is visible.
  await setView(page, 'split');
  await expect(page.locator('[data-testid="preview"] h2', { hasText: lastHeading })).toBeAttached();
  await check('split');
  expect(dialogs).toEqual([]);
  expect(navigations).toEqual([]);
  expect(page.url()).toBe(startUrl);
});

// ---- A19 ---------------------------------------------------------------------------------------

test('A19 Links: external opens through the platform, anchors scroll, Markdown links open tabs, nothing navigates', async ({
  page,
}) => {
  const index = `${LINKS}/index.md`;
  const second = `${LINKS}/second.md`;
  const plain = '/Users/mock/flavors/plain.md';
  const pdf = `${LINKS}/files/report.pdf`;
  await launch(page, {
    seed: {
      files: {
        [index]: fixture('links/index.md'),
        [second]: fixture('links/second.md'),
        [plain]: fixture('flavors/plain.md'),
      },
      existing: [pdf, `${LINKS}/images/sample.png`],
      ask: false,
    },
    viewport: { width: 1280, height: 420 },
  });
  const navigations: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });
  await page.evaluate(() => {
    (window as unknown as { __marker: string }).__marker = 'same-document';
  });
  const startUrl = page.url();
  await openFiles(page, [index]);
  await expect(activeName(page)).toContainText('index.md');
  const preview = page.locator('[data-testid="preview"]');
  await expect(preview.locator('h2#section-1')).toBeAttached();
  const link = (name: string) => preview.getByRole('link', { name });

  // External link: the platform opens it.
  await link('example.org').click();
  await expect.poll(async () => (await mockRead<string[]>(page, 'externalUrls')).length).toBe(1);
  expect((await mockRead<string[]>(page, 'externalUrls'))[0]).toMatch(
    /^https:\/\/example\.org\/?$/,
  );

  // Anchor: the preview scrolls so that the heading is in view.
  const scroller = page.getByTestId('preview-scroll');
  // Playwright scrolled the preview to reach the external link above: start from the top again.
  await scroller.evaluate((el) => {
    el.scrollTop = 0;
  });
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(0);
  await link('local heading').click();
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const offset = await preview.locator('h2#section-1').evaluate(
    (h, s) => {
      return h.getBoundingClientRect().top - (s as Element).getBoundingClientRect().top;
    },
    await scroller.elementHandle(),
  );
  expect(offset).toBeGreaterThanOrEqual(-4);
  expect(offset).toBeLessThan(120);
  expect(page.url()).toBe(startUrl);

  // A relative Markdown link opens a tab.
  await link('second document').click();
  await expect(page.getByTestId('tab')).toHaveCount(2);
  await expect(activeName(page)).toContainText('second.md');

  // A link with a fragment activates the open tab and brings the heading into view.
  await tabNamed(page, 'index.md').click();
  await expect(activeName(page)).toContainText('index.md');
  await link('specific section').click();
  await expect(activeName(page)).toContainText('second.md');
  await expect(page.getByTestId('tab')).toHaveCount(2);
  const details = page.locator('[data-testid="preview"] h2#details');
  await expect(details).toBeInViewport();

  // A link to a file that is not Markdown offers Reveal in Finder (the answer is Cancel first).
  await tabNamed(page, 'index.md').click();
  await link('PDF document').click();
  await expect.poll(async () => (await mockRead<unknown[]>(page, 'asks')).length).toBe(1);
  expect(await mockRead<string[]>(page, 'reveals')).toEqual([]);
  await setAnswers(page, { ask: true });
  await link('PDF document').click();
  await expect.poll(async () => (await mockRead<string[]>(page, 'reveals')).length).toBe(1);
  expect(await mockRead<string[]>(page, 'reveals')).toEqual([pdf]);

  // A link to a Markdown file in a parent folder opens a tab as well.
  await link('file in parent folder').click();
  await expect(activeName(page)).toContainText('plain.md');
  await expect(page.getByTestId('tab')).toHaveCount(3);

  // Nothing ever navigated the window.
  expect(navigations).toEqual([]);
  expect(page.url()).toBe(startUrl);
  expect(await page.evaluate(() => (window as unknown as { __marker?: string }).__marker)).toBe(
    'same-document',
  );
});

// ---- A20 ---------------------------------------------------------------------------------------

test('A20 Relative images are resolved through the platform and shown; a failure shows the placeholder', async ({
  page,
}) => {
  const doc = `${LINKS}/pictures.md`;
  const png = fixtureDataUrl('links/images/sample.png', 'image/png');
  const source = [
    '![Local sample](images/sample.png)',
    '',
    `![Inline data](${png})`,
    '',
    '![Missing picture](images/missing.png)',
    '',
    '![Not an image](files/report.pdf)',
    '',
  ].join('\n');
  await launch(page, {
    seed: {
      files: { [doc]: source },
      images: { [`${LINKS}/images/sample.png`]: png },
      existing: [`${LINKS}/files/report.pdf`],
    },
  });
  await openFiles(page, [doc]);
  const root = page.locator('[data-testid="preview"]');
  await expect(root.locator('.wd-block')).toHaveCount(4);

  // The relative image gets the address the platform answered with, and it loads.
  const local = root.locator('img[alt="Local sample"]');
  await expect(local).toHaveCount(1);
  await expect(local).toHaveAttribute('src', png);
  await expect
    .poll(() => local.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBeGreaterThan(0);
  // An image data URL stays as written.
  const inline = root.locator('img[alt="Inline data"]');
  await expect(inline).toHaveAttribute('src', png);

  // Failures show a placeholder with the description, not a broken image.
  for (const alt of ['Missing picture', 'Not an image']) {
    const block = root.locator('.wd-block', { hasText: alt });
    await expect(block, alt).toHaveCount(1);
    await expect(block.locator('img')).toHaveCount(0);
    await expect(
      block.locator('[class*="missing"], [class*="broken"], [class*="placeholder"]').first(),
    ).toBeAttached();
  }
});

// ---- A21 ---------------------------------------------------------------------------------------

const FLAVOR_DOC = '# T\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- [ ] task\n';

test('A21 Extensions give their flavor with auto and the Renders as GFM note', async ({ page }) => {
  const files: Record<string, string> = {};
  const add = (name: string, fixtureName: string) => {
    files[`/Users/mock/flavors/${name}`] = fixture(`flavors/${fixtureName}`);
  };
  add('component.mdx', 'component.mdx');
  add('report.qmd', 'report.qmd');
  add('analysis.Rmd', 'analysis.Rmd');
  add('notes.mmd', 'notes.mmd');
  add('plain.md', 'plain.md');
  add('pandoc-hint.md', 'pandoc-hint.md');
  add('quarto-hint.md', 'quarto-hint.md');
  files['/Users/mock/flavors/vault/notes/idea.md'] = fixture('flavors/vault/notes/idea.md');
  await launch(page, { seed: { files, vaults: ['/Users/mock/flavors/vault'] } });
  await openFiles(page, Object.keys(files));
  await expect(page.getByTestId('tab')).toHaveCount(8);

  const expectations: Array<[string, string, boolean]> = [
    ['component.mdx', 'MDX', true],
    ['report.qmd', 'Quarto / RMD', true],
    ['analysis.Rmd', 'Quarto / RMD', true],
    ['notes.mmd', 'Pandoc / MMD', true],
    ['idea.md', 'Obsidian', true],
    ['pandoc-hint.md', 'Pandoc / MMD', true],
    ['quarto-hint.md', 'Quarto / RMD', true],
    ['plain.md', 'GFM', true],
  ];
  for (const [name, flavor, available] of expectations) {
    await tabNamed(page, name).click();
    await expect(page.getByTestId('document-name'), name).toContainText(name);
    await expect(page.getByTestId('status-flavor'), `${name} status bar`).toHaveText(flavor);
    const pill = page.getByTestId('flavor-pill');
    await expect(pill, `${name} pill`).toContainText(flavor);
    await expect(page.getByTestId('flavor-auto'), `${name} auto`).toBeVisible();
    if (available) await expect(page.getByTestId('flavor-note')).toHaveCount(0);
    else
      await expect(page.getByTestId('flavor-note'), `${name} note`).toHaveText(
        'Renders as GFM for now',
      );
  }
});

test('A21 A chosen flavor is stored and wins on reopen; the menu lists the six flavors with the note', async ({
  page,
}) => {
  const path = '/Users/mock/flavors/plain.md';
  await launch(page, { seed: { files: { [path]: fixture('flavors/plain.md') } } });
  await openFiles(page, [path]);
  await expect(page.getByTestId('status-flavor')).toHaveText('GFM');

  await page.getByTestId('flavor-pill').click();
  const items = page.getByTestId('flavor-menu').getByRole('menuitemradio');
  await expect(items).toHaveCount(6);
  await expect(items.filter({ hasText: 'Renders as GFM for now' })).toHaveCount(0);
  for (const label of [
    'CommonMark',
    'GitHub Flavored Markdown (GFM)',
    'Obsidian',
    'Pandoc / MMD',
    'Quarto / RMD',
    'MDX',
  ]) {
    await expect(items.filter({ hasText: label })).toHaveCount(1);
  }
  await items.filter({ hasText: /^\s*CommonMark/ }).click();
  await expect(page.getByTestId('status-flavor')).toHaveText('CommonMark');
  await expect(page.getByTestId('flavor-pill')).toContainText('CommonMark');
  await expect(page.getByTestId('flavor-auto')).toHaveCount(0);

  // Close and open again: the choice wins.
  await menu(page, 'close-tab');
  await expect(page.getByTestId('welcome')).toBeVisible();
  await openFiles(page, [path]);
  await expect(page.getByTestId('status-flavor')).toHaveText('CommonMark');
  await expect(page.getByTestId('flavor-auto')).toHaveCount(0);

  // Detect automatically brings back the detected flavor with "auto".
  await page.getByTestId('flavor-pill').click();
  await page.getByRole('menuitem', { name: 'Detect automatically' }).click();
  await expect(page.getByTestId('status-flavor')).toHaveText('GFM');
  await expect(page.getByTestId('flavor-auto')).toBeVisible();
});

test('A21 Chosen flavors render with their own pack; CommonMark renders a GFM table as plain text', async ({
  page,
}) => {
  const path = `${DOCS}/flavor-table.md`;
  await launch(page, { seed: { files: { [path]: FLAVOR_DOC } } });
  await openFiles(page, [path]);
  const preview = page.locator('[data-testid="preview"]');
  await expect(preview.locator('table')).toHaveCount(1);
  await expect(preview.locator('span.task-checkbox')).toHaveCount(1);

  const choose = async (label: string | RegExp) => {
    await page.getByTestId('flavor-pill').click();
    await page.getByTestId('flavor-menu').getByRole('menuitemradio', { name: label }).click();
  };
  await choose(/Pandoc/);
  await expect(page.getByTestId('flavor-note')).toHaveCount(0);
  await expect(preview.locator('table')).toHaveCount(1);
  await expect(preview.locator('span.task-checkbox')).toHaveCount(1);

  await choose(/Quarto/);
  await expect(page.getByTestId('flavor-note')).toHaveCount(0);
  await expect(preview.locator('table')).toHaveCount(1);
  await expect(preview.locator('span.task-checkbox')).toHaveCount(1);

  await choose(/^CommonMark/);
  await expect(page.getByTestId('flavor-note')).toHaveCount(0);
  await expect(preview.locator('table')).toHaveCount(0);
  await expect(preview.locator('span.task-checkbox')).toHaveCount(0);
  await expect(preview).toContainText('| a | b |');
  await expect(preview).toContainText('[ ] task');
});

test('A21 The default flavor chosen on the welcome screen applies to new and unmarked documents', async ({
  page,
}) => {
  const path = `${DOCS}/unmarked.md`;
  await launch(page, { seed: { files: { [path]: '# plain\n' } } });
  await page.getByTestId('flavor-pill').click();
  await page
    .getByTestId('flavor-menu')
    .getByRole('menuitemradio', { name: /^CommonMark/ })
    .click();
  await expect.poll(async () => (await settingsOf(page)).defaultFlavor).toBe('commonmark');
  await menu(page, 'new');
  await expect(page.getByTestId('status-flavor')).toHaveText('CommonMark');
  await openFiles(page, [path]);
  await expect(page.getByTestId('status-flavor')).toHaveText('CommonMark');
  await expect(page.getByTestId('flavor-auto')).toBeVisible();
});

// ---- A22 ---------------------------------------------------------------------------------------

interface ProseFixture {
  blocks: string[];
}

/** Words and characters per the definitions, computed from the prose blocks in the page's engine. */
async function oracle(page: Page, proseBlocks: string[]) {
  return page.evaluate((list) => {
    const words = new Intl.Segmenter(undefined, { granularity: 'word' });
    const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    let w = 0;
    let c = 0;
    let n = 0;
    for (const block of list) {
      for (const s of words.segment(block)) if (s.isWordLike) w++;
      for (const g of graphemes.segment(block)) {
        c++;
        if (!/^\s+$/u.test(g.segment)) n++;
      }
    }
    return { words: w, characters: c, noSpaces: n };
  }, proseBlocks);
}

const grouped = (n: number) => n.toLocaleString('en-US');

for (const name of ['english', 'cjk', 'arabic', 'mixed']) {
  test(`A22 Stats follow the definitions for the ${name} fixture`, async ({ page }) => {
    const path = `${DOCS}/${name}.md`;
    const prose = JSON.parse(
      readFileSync(join(FIXTURES, 'stats', `${name}.md.prose.json`), 'utf8'),
    ) as ProseFixture;
    await launch(page, { seed: { files: { [path]: fixture(`stats/${name}.md`) } } });
    await openFiles(page, [path]);
    const expected = await oracle(page, prose.blocks);
    expect(expected.words).toBeGreaterThan(5);
    await expect(page.getByTestId('status-words')).toHaveText(`Words: ${grouped(expected.words)}`);
    await expect(page.getByTestId('status-characters')).toHaveText(
      `Characters: ${grouped(expected.characters)}`,
    );
    await expect(page.getByTestId('status-characters')).toHaveAttribute(
      'title',
      `${grouped(expected.noSpaces)} without spaces`,
    );
    const minutes =
      expected.words === 0
        ? '0 min'
        : expected.words < 238
          ? '< 1 min'
          : `${Math.ceil(expected.words / 238)} min`;
    await expect(page.getByTestId('status-reading')).toContainText(`Reading Time: ${minutes}`);
    // The Preview view and the Split view agree.
    await setView(page, 'split');
    await expect(page.getByTestId('status-words')).toHaveText(`Words: ${grouped(expected.words)}`);
  });
}

test('A22 Reading time rounds up at 238 words per minute and follows the setting', async ({
  page,
}) => {
  const doc = (n: number) => `${Array.from({ length: n }, () => 'word').join(' ')}\n`;
  const files: Record<string, string> = {};
  for (const n of [237, 238, 239, 500]) files[`${DOCS}/w${n}.md`] = doc(n);
  await launch(page, { seed: { files } });
  const expectations: Array<[number, string]> = [
    [237, '< 1 min'],
    [238, '1 min'],
    [239, '2 min'],
    [500, '3 min'],
  ];
  for (const [n, label] of expectations) {
    await openFiles(page, [`${DOCS}/w${n}.md`]);
    await expect(page.getByTestId('document-name')).toContainText(`w${n}.md`);
    await expect(page.getByTestId('status-words')).toHaveText(`Words: ${n}`);
    await expect(page.getByTestId('status-reading')).toContainText(`Reading Time: ${label}`);
  }
  // An empty document has no reading time.
  await menu(page, 'new');
  await expect(page.getByTestId('status-words')).toHaveText('Words: 0');
  await expect(page.getByTestId('status-reading')).toContainText('Reading Time: 0 min');
  // The rate is a setting: 500 words at 100 per minute is 5 minutes.
  await tabNamed(page, 'w500.md').click();
  await page.evaluate(() =>
    (
      window as unknown as { __BACKTICKLE_MOCK__: { settingsChanged(p: unknown): void } }
    ).__BACKTICKLE_MOCK__.settingsChanged({ readingWpm: 100 }),
  );
  await expect(page.getByTestId('status-reading')).toContainText('Reading Time: 5 min');
});

test('A22 A selection shows N of total', async ({ page }) => {
  const path = `${DOCS}/selection.md`;
  const source = fixture('stats/english.md');
  const prose = JSON.parse(
    readFileSync(join(FIXTURES, 'stats', 'english.md.prose.json'), 'utf8'),
  ) as ProseFixture;
  await launch(page, { seed: { files: { [path]: source } }, open: path, view: 'split' });
  const total = (await oracle(page, prose.blocks)).words;
  await expect(page.getByTestId('status-words')).toHaveText(`Words: ${total}`);
  // "This is a paragraph with" is five words of plain prose.
  await selectText(page, 'This is a paragraph with');
  await expect(page.getByTestId('status-words')).toHaveText(`Words: 5 of ${total}`);
  // Collapsing the selection shows the total again.
  const start = source.indexOf('This is a paragraph');
  await setSelection(page, start);
  await expect(page.getByTestId('status-words')).toHaveText(`Words: ${total}`);
  // Typing changes the total: one more word.
  await typeAtEnd(page, ' extra');
  await expect(page.getByTestId('status-words')).toHaveText(`Words: ${total + 1}`);
  await previewReady(page);
});
