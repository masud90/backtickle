/**
 * Acceptance cases A01 to A10: documents and files.
 * Expected values come from the specification and the fixtures, not from the app.
 */
import { test } from '@playwright/test';
import {
  activeName,
  dirtyDot,
  diskFile,
  editorText,
  expect,
  launch,
  menu,
  mockRead,
  openFiles,
  type SavedCall,
  saves,
  setAnswers,
  setView,
  TEST_TIMEOUT,
  typeAtEnd,
} from './support';

test.setTimeout(TEST_TIMEOUT);

const DOCS = '/Users/mock/docs';
const tabs = (page: import('@playwright/test').Page) => page.getByTestId('tab');
const tabNamed = (page: import('@playwright/test').Page, name: string) =>
  page.getByTestId('tab-strip').getByRole('tab', { name: new RegExp(name.replace('.', '\\.')) });
const selectedTab = (page: import('@playwright/test').Page) =>
  page.getByTestId('tab-strip').getByRole('tab', { selected: true });

/** Makes the tab with this name the one on show, in the Split view, and edits its end. */
async function dirtyTab(page: import('@playwright/test').Page, name: string, extra = '!') {
  await tabNamed(page, name).click();
  await expect(selectedTab(page)).toContainText(name);
  await setView(page, 'split');
  await typeAtEnd(page, extra);
}

test('A01 Welcome screen lists existing recents newest first (at most 8, missing hidden) and Clear History empties it', async ({
  page,
}) => {
  const now = Date.now();
  const files: Record<string, unknown> = {
    [`${DOCS}/newest.md`]: { text: '# newest\n', bytes: 52_000 },
  };
  for (let i = 2; i <= 10; i++) files[`${DOCS}/r${i}.md`] = { text: `# r${i}\n`, bytes: 2_500_000 };
  const recents = [
    { path: `${DOCS}/newest.md`, openedAtMs: now - 10 * 60_000 },
    { path: `${DOCS}/gone.md`, openedAtMs: now - 2 * 3_600_000 }, // not on disk: hidden
    { path: `${DOCS}/r2.md`, openedAtMs: now - 30 * 60_000 },
    { path: `${DOCS}/r3.md`, openedAtMs: 1_700_000_000_000 }, // a past year
    ...[4, 5, 6, 7, 8, 9, 10].map((i) => ({
      path: `${DOCS}/r${i}.md`,
      openedAtMs: 1_600_000_000_000 - i * 1000,
    })),
  ];
  await launch(page, { seed: { files, recents } });

  await expect(page.getByRole('heading', { name: 'Welcome to Writedown' })).toBeVisible();
  await expect(page.getByTestId('welcome-new')).toBeVisible();
  await expect(page.getByTestId('welcome-open')).toBeVisible();

  const names = page.getByTestId('recent-name');
  await expect(names).toHaveText([
    'newest.md',
    'r2.md',
    'r3.md',
    'r4.md',
    'r5.md',
    'r6.md',
    'r7.md',
    'r8.md',
  ]);
  await expect(page.getByText('gone.md')).toHaveCount(0);
  // Folders are shown with the home folder as ~.
  await expect(page.getByTestId('recent-folder').first()).toHaveText('~/docs');
  // Relative times: minutes (the page may load a few minutes late), and a dated entry for an older year.
  await expect(page.getByTestId('recent-time').nth(0)).toHaveText(/^1\d\s?(m|min) ago$/);
  await expect(page.getByTestId('recent-time').nth(1)).toHaveText(/^(3\d|4[0-5])\s?(m|min) ago$/);
  await expect(page.getByTestId('recent-time').nth(2)).toHaveText(
    /^[A-Z][a-z]{2} \d{1,2}, 20\d{2}$/,
  );
  // Sizes are decimal (Finder style): 52,000 bytes is 52 KB (not 50.8 KiB), 2,500,000 is 2.5 MB.
  await expect(page.getByTestId('recent-size').nth(0)).toHaveText('52 KB');
  await expect(page.getByTestId('recent-size').nth(1)).toHaveText('2.5 MB');

  await page.getByTestId('clear-history').click();
  await expect(page.getByTestId('recent-item')).toHaveCount(0);
  await expect(page.getByTestId('recent-empty')).toBeVisible();
  await expect(page.getByTestId('clear-history')).toHaveCount(0);
});

test('A02 Open with two files opens two tabs in Preview; an open file is activated, not duplicated', async ({
  page,
}) => {
  const a = `${DOCS}/alpha.md`;
  const b = `${DOCS}/beta.md`;
  await launch(page, {
    seed: {
      files: { [a]: '# Alpha\n\ntext\n', [b]: '# Beta\n\ntext\n' },
      openDialog: [a, b],
    },
  });
  await expect(page.getByTestId('tab-strip')).toHaveCount(0);
  await menu(page, 'open');
  await expect(tabs(page)).toHaveCount(2);
  await expect(page.getByTestId('tab-strip')).toBeVisible();
  await expect(tabs(page).nth(0)).toContainText('alpha.md');
  await expect(tabs(page).nth(1)).toContainText('beta.md');
  // Each opens in Preview.
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'preview');
  await expect(page.getByTestId('view-preview')).toHaveAttribute('aria-checked', 'true');
  await tabNamed(page, 'alpha.md').click();
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'preview');
  await expect(selectedTab(page)).toContainText('alpha.md');

  // Opening an open file again activates its tab.
  await tabNamed(page, 'beta.md').click();
  await expect(selectedTab(page)).toContainText('beta.md');
  await setAnswers(page, { openDialog: [a] });
  await menu(page, 'open');
  await expect(selectedTab(page)).toContainText('alpha.md');
  await expect(tabs(page)).toHaveCount(2);
});

test('A03 New creates Untitled in Split; a second New creates Untitled 2', async ({ page }) => {
  await launch(page);
  await menu(page, 'new');
  await expect(activeName(page)).toContainText('Untitled');
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'split');
  await expect(page.getByTestId('view-split')).toHaveAttribute('aria-checked', 'true');
  await expect(tabs(page)).toHaveCount(0); // one document: no tab strip

  await menu(page, 'new');
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(0)).toHaveText(/^Untitled\s*$/);
  await expect(tabs(page).nth(1)).toHaveText(/^Untitled 2\s*$/);
  await expect(activeName(page)).toHaveText('Untitled 2');
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'split');
  const titles = await mockRead<string[]>(page, 'windowTitles');
  expect(titles.at(-1)).toBe('Untitled 2');
});

test('A04 Typing marks the document edited; Save writes exactly the editor text in the original format; the pill shows Saved just now', async ({
  page,
}) => {
  const path = `${DOCS}/notes.md`;
  const original = 'Line 1\nLine 2\n';
  await launch(page, {
    seed: {
      files: {
        [path]: {
          text: original,
          encoding: 'utf-8-bom',
          lineEnding: 'lf',
          modifiedMs: 1_700_000_100_000,
        },
      },
    },
  });
  await openFiles(page, [path]);
  await expect(activeName(page)).toContainText('notes.md');
  await expect(dirtyDot(page)).toHaveCount(0);
  await expect(page.getByTestId('save-status')).toHaveText(/^\s*Saved/);

  await setView(page, 'split');
  await typeAtEnd(page, 'X');
  expect(await editorText(page)).toBe(`${original}X`);
  await expect(dirtyDot(page)).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText('Edited');

  await menu(page, 'save');
  await expect.poll(async () => (await saves(page)).length).toBe(1);
  const [call] = (await saves(page)) as [SavedCall];
  expect(call.path).toBe(path);
  expect(call.text).toBe(`${original}X`);
  expect(call.format).toEqual({ encoding: 'utf-8-bom', lineEnding: 'lf' });
  expect(call.options.expectedModifiedMs).toBe(1_700_000_100_000);
  await expect(dirtyDot(page)).toHaveCount(0);
  await expect(page.getByTestId('save-status')).toHaveText('Saved • just now');
  // The Save button of the title bar does the same.
  await typeAtEnd(page, 'Y');
  await page.getByTestId('save-button').click();
  await expect.poll(async () => (await saves(page)).length).toBe(2);
  expect((await saves(page))[1]?.text).toBe(`${original}XY`);
});

test('A04 The pill names the cloud service for a file in iCloud Drive', async ({ page }) => {
  const path = '/Users/mock/Library/Mobile Documents/com~apple~CloudDocs/cloud.md';
  await launch(page, { seed: { files: { [path]: 'hello\n' } } });
  await openFiles(page, [path]);
  await expect(activeName(page)).toContainText('cloud.md');
  await setView(page, 'split');
  await typeAtEnd(page, '!');
  await menu(page, 'save');
  await expect(page.getByTestId('save-status')).toHaveText('Saved to iCloud Drive • just now');
});

test('A05 Save on an untitled document goes through Save As; name from the first heading; tab name and flavor follow the new path', async ({
  page,
}) => {
  const target = `${DOCS}/report.qmd`;
  await launch(page, { seed: { saveDialog: target } });
  await menu(page, 'new');
  await expect(activeName(page)).toContainText('Untitled');
  await page.locator('[data-testid="editor"] .cm-content').click();
  await page.keyboard.type('# My Title');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Body text');
  await expect(page.getByTestId('save-status')).toHaveText(/^\s*(Not saved|Edited)\s*$/);

  await menu(page, 'save');
  await expect.poll(async () => (await saves(page)).length).toBe(1);
  const dialogs = await mockRead<Array<{ suggestedName: string; directory: string | null }>>(
    page,
    'saveDialogs',
  );
  expect(dialogs).toHaveLength(1);
  expect(dialogs[0]?.suggestedName).toMatch(/^my.?title\.md$/i);
  const [call] = (await saves(page)) as [SavedCall];
  expect(call.path).toBe(target);
  expect(call.text).toBe('# My Title\n\nBody text');
  expect(call.options.expectedModifiedMs).toBeNull();

  await expect(activeName(page)).toHaveText('report.qmd');
  await expect(page.getByTestId('status-flavor')).toHaveText('Quarto / RMD');
  await expect(page.getByTestId('flavor-auto')).toBeVisible();
  await expect(dirtyDot(page)).toHaveCount(0);
  const titles = await mockRead<string[]>(page, 'windowTitles');
  expect(titles.at(-1)).toBe('report.qmd');
});

test('A05 Without a heading the suggested name is Untitled.md', async ({ page }) => {
  await launch(page, { seed: { saveDialog: `${DOCS}/plain.md` } });
  await menu(page, 'new');
  await page.locator('[data-testid="editor"] .cm-content').click();
  await page.keyboard.type('just a line of text');
  await menu(page, 'save');
  await expect.poll(async () => (await saves(page)).length).toBe(1);
  const dialogs = await mockRead<Array<{ suggestedName: string }>>(page, 'saveDialogs');
  expect(dialogs[0]?.suggestedName).toBe('Untitled.md');
  await expect(activeName(page)).toHaveText('plain.md');
  await expect(page.getByTestId('status-flavor')).toHaveText('GFM');
});

test('A06 Save with modified-externally asks; Cancel keeps the document dirty; Overwrite retries with the flag', async ({
  page,
}) => {
  const path = `${DOCS}/shared.md`;
  await launch(page, { seed: { files: { [path]: 'original\n' }, ask: false } });
  await openFiles(page, [path]);
  await expect(activeName(page)).toContainText('shared.md');
  await setView(page, 'split');
  await typeAtEnd(page, 'mine');
  await expect(dirtyDot(page)).toBeVisible();

  // Someone else changes the file on disk.
  await page.evaluate((p) => {
    (
      window as unknown as { __WRITEDOWN_MOCK__: { externallyModify(p: string): void } }
    ).__WRITEDOWN_MOCK__.externallyModify(p);
  }, path);

  await menu(page, 'save');
  await expect.poll(async () => (await mockRead<unknown[]>(page, 'asks')).length).toBe(1);
  const asks = await mockRead<
    Array<{ title: string; message: string; ok: string; cancel: string }>
  >(page, 'asks');
  expect(`${asks[0]?.title} ${asks[0]?.message}`).toContain(
    'The file changed on disk since you opened it',
  );
  expect(asks[0]?.ok).toBe('Overwrite');
  expect(asks[0]?.cancel).toBe('Cancel');
  expect(await saves(page)).toHaveLength(0);
  await expect(dirtyDot(page)).toBeVisible();
  expect((await diskFile(page, path))?.text).toBe('original\n');

  // Overwrite: the retry carries the flag and the document is clean.
  await setAnswers(page, { ask: true });
  await menu(page, 'save');
  await expect.poll(async () => (await saves(page)).length).toBe(1);
  const [call] = (await saves(page)) as [SavedCall];
  expect(call.options.overwriteExternalChange).toBe(true);
  expect(call.text).toBe('original\nmine');
  await expect(dirtyDot(page)).toHaveCount(0);
  expect((await diskFile(page, path))?.text).toBe('original\nmine');
});

test('A07 A legacy-encoded file shows the conversion banner and saves as UTF-8', async ({
  page,
}) => {
  const path = `${DOCS}/legacy.md`;
  await launch(page, {
    seed: {
      files: {
        [path]: { text: 'café crème\n', legacyEncoding: 'windows-1252', encoding: 'utf-8' },
      },
    },
  });
  await openFiles(page, [path]);
  const banner = page.getByTestId('banner-legacy');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Opened as Windows-1252. Saving converts it to UTF-8.');
  await expect(page.getByTestId('status-encoding')).toHaveText('Windows-1252');
  await setView(page, 'split');
  await typeAtEnd(page, '!');
  await menu(page, 'save');
  await expect.poll(async () => (await saves(page)).length).toBe(1);
  expect((await saves(page))[0]?.format.encoding).toBe('utf-8');
  await expect(page.getByTestId('status-encoding')).toHaveText('UTF-8');
  await expect(page.getByTestId('banner-legacy')).toHaveCount(0);
});

test('A07 A lossy file shows a banner and asks before saving', async ({ page }) => {
  const path = `${DOCS}/lossy.md`;
  await launch(page, {
    seed: { files: { [path]: { text: 'bad � byte\n', lossy: true } }, ask: false },
  });
  await openFiles(page, [path]);
  await expect(page.getByTestId('banner-lossy')).toBeVisible();
  await setView(page, 'split');
  await typeAtEnd(page, '!');
  await menu(page, 'save');
  await expect.poll(async () => (await mockRead<unknown[]>(page, 'asks')).length).toBe(1);
  expect(await saves(page)).toHaveLength(0);
  await expect(dirtyDot(page)).toBeVisible();

  await setAnswers(page, { ask: true });
  await menu(page, 'save');
  await expect.poll(async () => (await saves(page)).length).toBe(1);
  expect((await saves(page))[0]?.options.allowLossy).toBe(true);
  await expect(dirtyDot(page)).toHaveCount(0);
});

test('A07 A read-only file saves through Save As', async ({ page }) => {
  const path = `${DOCS}/locked.md`;
  const copy = `${DOCS}/locked-copy.md`;
  await launch(page, {
    seed: { files: { [path]: { text: 'read me\n', readOnly: true } }, saveDialog: copy },
  });
  await openFiles(page, [path]);
  await expect(page.getByTestId('banner-readOnly')).toBeVisible();
  await menu(page, 'save');
  await expect.poll(async () => (await saves(page)).length).toBe(1);
  const dialogs = await mockRead<Array<{ suggestedName: string; directory: string | null }>>(
    page,
    'saveDialogs',
  );
  expect(dialogs).toHaveLength(1);
  expect(dialogs[0]?.directory).toBe(DOCS);
  expect((await saves(page))[0]?.path).toBe(copy);
  await expect(activeName(page)).toHaveText('locked-copy.md');
  // The original is untouched.
  expect((await diskFile(page, path))?.text).toBe('read me\n');
});

test('A08 Close Tab on a dirty tab asks Save, Do not save, Cancel and honors each answer', async ({
  page,
}) => {
  const paths = ['alpha', 'beta', 'gamma'].map((n) => `${DOCS}/${n}.md`);
  const files = Object.fromEntries(paths.map((p, i) => [p, `# doc ${i}\n`]));
  await launch(page, { seed: { files } });
  await openFiles(page, paths);
  await expect(tabs(page)).toHaveCount(3);
  await dirtyTab(page, 'alpha.md');
  await dirtyTab(page, 'beta.md');
  await dirtyTab(page, 'gamma.md');

  // Cancel keeps the tab.
  await tabNamed(page, 'alpha.md').click();
  await setAnswers(page, { confirmUnsaved: 'cancel' });
  await menu(page, 'close-tab');
  await expect.poll(async () => (await mockRead<string[]>(page, 'confirmations')).length).toBe(1);
  expect((await mockRead<string[]>(page, 'confirmations'))[0]).toBe('alpha.md');
  await expect(tabs(page)).toHaveCount(3);
  expect(await saves(page)).toHaveLength(0);

  // Do not save closes it without writing.
  await setAnswers(page, { confirmUnsaved: 'discard' });
  await menu(page, 'close-tab');
  await expect(tabs(page)).toHaveCount(2);
  await expect(page.getByTestId('tab-strip').getByRole('tab', { name: /alpha\.md/ })).toHaveCount(
    0,
  );
  expect(await saves(page)).toHaveLength(0);
  expect((await diskFile(page, paths[0] as string))?.text).toBe('# doc 0\n');

  // Save writes, then closes.
  await tabNamed(page, 'beta.md').click();
  await setAnswers(page, { confirmUnsaved: 'save' });
  await menu(page, 'close-tab');
  await expect.poll(async () => (await saves(page)).length).toBe(1);
  expect((await saves(page))[0]?.path).toBe(paths[1]);
  expect((await saves(page))[0]?.text).toBe('# doc 1\n!');
  await expect(page.getByTestId('tab-strip').getByRole('tab', { name: /beta\.md/ })).toHaveCount(0);
  await expect(activeName(page)).toContainText('gamma.md');
});

test('A08 Closing the window walks the dirty tabs in tab order; Cancel stops the walk', async ({
  page,
}) => {
  const names = ['alpha', 'beta', 'gamma', 'delta'];
  const paths = names.map((n) => `${DOCS}/${n}.md`);
  const files = Object.fromEntries(paths.map((p, i) => [p, `# doc ${i}\n`]));
  await launch(page, { seed: { files } });
  await openFiles(page, paths);
  await expect(tabs(page)).toHaveCount(4);
  // alpha, gamma and delta are dirty, beta is clean; the last edited tab is the one on show.
  await dirtyTab(page, 'gamma.md');
  await dirtyTab(page, 'alpha.md');
  await dirtyTab(page, 'delta.md');

  // alpha: Save, gamma: Cancel. The walk stops there and the window stays open.
  await setAnswers(page, { confirmUnsaved: ['save', 'cancel', 'discard'] });
  await mockCallClose(page, 'window');
  await expect.poll(async () => (await mockRead<string[]>(page, 'cancelCloses')).length).toBe(1);
  expect(await mockRead<string[]>(page, 'cancelCloses')).toEqual(['window']);
  expect(await mockRead<string[]>(page, 'finishCloses')).toEqual([]);
  expect(await mockRead<string[]>(page, 'confirmations')).toEqual(['alpha.md', 'gamma.md']);
  const done = await saves(page);
  expect(done.map((s) => s.path)).toEqual([paths[0]]);
  // Each tab asked about was activated; the walk stopped on gamma.
  await expect(selectedTab(page)).toContainText('gamma.md');

  // A second request walks the rest (gamma, delta) and finishes.
  await page.evaluate(() =>
    (window as unknown as { __WRITEDOWN_MOCK__: { reset(): void } }).__WRITEDOWN_MOCK__.reset(),
  );
  await setAnswers(page, { confirmUnsaved: ['discard', 'discard'] });
  await mockCallClose(page, 'window');
  await expect.poll(async () => (await mockRead<string[]>(page, 'finishCloses')).length).toBe(1);
  expect(await mockRead<string[]>(page, 'finishCloses')).toEqual(['window']);
  expect(await mockRead<string[]>(page, 'confirmations')).toEqual(['gamma.md', 'delta.md']);
});

async function mockCallClose(page: import('@playwright/test').Page, reason: 'window' | 'quit') {
  await page.evaluate((r) => {
    (
      window as unknown as { __WRITEDOWN_MOCK__: { closeRequested(r: string): void } }
    ).__WRITEDOWN_MOCK__.closeRequested(r);
  }, reason);
}

test('A08 Quit runs the same walk with the quit reason', async ({ page }) => {
  const path = `${DOCS}/q.md`;
  await launch(page, { seed: { files: { [path]: 'q\n' }, confirmUnsaved: 'discard' } });
  await openFiles(page, [path]);
  await setView(page, 'split');
  await typeAtEnd(page, '!');
  await mockCallClose(page, 'quit');
  await expect.poll(async () => (await mockRead<string[]>(page, 'finishCloses')).length).toBe(1);
  expect(await mockRead<string[]>(page, 'finishCloses')).toEqual(['quit']);
  expect(await mockRead<number>(page, 'ackCloses')).toBeGreaterThanOrEqual(1);
});

test('A09 open-files events open tabs; events before the page is ready are taken with takePendingOpenFiles', async ({
  page,
}) => {
  const early = `${DOCS}/early.md`;
  const finder = `${DOCS}/finder.md`;
  const dock = `${DOCS}/dock.md`;
  await launch(page, {
    seed: {
      files: { [early]: '# early\n', [finder]: '# finder\n', [dock]: '# dock\n' },
      pendingOpenFiles: [early],
    },
    waitFor: 'document',
  });
  // The file opened before the page was ready is a tab.
  await expect(activeName(page)).toContainText('early.md');
  await expect(page.getByTestId('welcome')).toHaveCount(0);

  // Later events (Finder, Dock, drag and drop) open tabs.
  await openFiles(page, [finder]);
  await expect(activeName(page)).toContainText('finder.md');
  await openFiles(page, [dock, finder]);
  await expect(tabs(page)).toHaveCount(3);
  await expect(tabs(page).nth(0)).toContainText('early.md');
  await expect(tabs(page).nth(1)).toContainText('finder.md');
  await expect(tabs(page).nth(2)).toContainText('dock.md');
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'preview');
});

test('A10 A CRLF file keeps CRLF on save; clicking CRLF in the status bar switches to LF and marks the document edited', async ({
  page,
}) => {
  const path = `${DOCS}/crlf.md`;
  await launch(page, { seed: { files: { [path]: 'one\r\ntwo\r\n' } } });
  await openFiles(page, [path]);
  await expect(page.getByTestId('status-line-ending')).toHaveText('CRLF');
  await setView(page, 'split');
  await typeAtEnd(page, 'three');
  // The editor holds plain \n; the file format keeps the line ending on write.
  expect(await editorText(page)).toBe('one\ntwo\nthree');
  await menu(page, 'save');
  await expect.poll(async () => (await saves(page)).length).toBe(1);
  expect((await saves(page))[0]?.format.lineEnding).toBe('crlf');
  const disk = await diskFile(page, path);
  expect(disk?.lineEnding).toBe('crlf');
  // 'one\r\ntwo\r\nthree' is 15 bytes in UTF-8.
  expect(disk?.bytes).toBe(15);
  await expect(dirtyDot(page)).toHaveCount(0);

  // Clicking the line ending switches it and marks the document edited.
  await page.getByTestId('status-line-ending').click();
  await expect(page.getByTestId('status-line-ending')).toHaveText('LF');
  await expect(dirtyDot(page)).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText('Edited');
  await menu(page, 'save');
  await expect.poll(async () => (await saves(page)).length).toBe(2);
  expect((await saves(page))[1]?.format.lineEnding).toBe('lf');
  expect((await saves(page))[1]?.text).toBe('one\ntwo\nthree');
  await expect(dirtyDot(page)).toHaveCount(0);

  // Clicking again switches back.
  await page.getByTestId('status-line-ending').click();
  await expect(page.getByTestId('status-line-ending')).toHaveText('CRLF');
});
