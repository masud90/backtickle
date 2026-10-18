/**
 * Documents and files in the main window,
 * on the mock platform in real WebKit.
 */
import { expect, type Page, test } from '@playwright/test';
import type { MockSeed } from '../../src/lib/platform-mock';
import { editor, fixture, HOME, menu, preview, seedMock, tabs, typeAtEnd } from './helpers';

const DOCS = `${HOME}/Documents`;
const NOTE = `${DOCS}/note.md`;
const NOTE_TEXT = '# Note\n\nSome body text.\n';

/** Answers of the dialogs, changed while the page runs. */
async function answers(page: Page, value: Record<string, unknown>) {
  await page.evaluate((next) => window.__BACKTICKLE_MOCK__?.setAnswers(next as never), value);
}

const saves = (page: Page) => page.evaluate(() => window.__BACKTICKLE_MOCK__?.saves ?? []);

/** Opens `note.md` in Split view at launch. */
async function openNote(page: Page, seed: MockSeed = {}) {
  await seedMock(page, {
    launch: { openPath: NOTE, view: 'split' },
    ...seed,
    files: { [NOTE]: NOTE_TEXT, ...seed.files },
  });
  await page.goto('/');
  await expect(page.getByTestId('document-name')).toHaveText('note.md');
  await expect(editor(page)).toBeVisible();
}

test.describe('A01 the welcome screen', () => {
  test('A01 lists the recent documents that exist, most recent first, at most eight, and Clear History empties it', async ({
    page,
  }) => {
    const now = Date.now();
    const files: Record<string, string> = {};
    const recents: Array<{ path: string; openedAtMs: number; bytes?: number }> = [];
    for (let i = 1; i <= 10; i++) {
      const path = `${HOME}/Notes/doc${i}.md`;
      files[path] = `# Doc ${i}`;
      recents.push({ path, openedAtMs: now - i * 120_000, ...(i === 1 ? { bytes: 3400 } : {}) });
    }
    // A recent file that has been deleted since: kept by Rust, hidden by the welcome screen.
    recents.splice(1, 0, { path: `${HOME}/Notes/deleted.md`, openedAtMs: now - 90_000 });
    await seedMock(page, { files, recents, launch: { welcome: true } });
    await page.goto('/');

    const items = page.getByTestId('recent-item');
    await expect(items).toHaveCount(8);
    await expect(page.getByTestId('recent-name')).toHaveText([
      'doc1.md',
      'doc2.md',
      'doc3.md',
      'doc4.md',
      'doc5.md',
      'doc6.md',
      'doc7.md',
      'doc8.md',
    ]);
    await expect(page.getByText('deleted.md')).toHaveCount(0);
    await expect(page.getByTestId('recent-folder').first()).toHaveText('~/Notes');
    await expect(page.getByTestId('recent-time').first()).toHaveText('2m ago');
    await expect(page.getByTestId('recent-size').first()).toHaveText('3.4 KB');

    await page.getByTestId('clear-history').click();

    await expect(items).toHaveCount(0);
    await expect(page.getByTestId('recent-empty')).toBeVisible();
    await expect(page.getByTestId('clear-history')).toHaveCount(0);
  });

  test('A01 a recent document opens when clicked', async ({ page }) => {
    await seedMock(page, {
      files: { [NOTE]: NOTE_TEXT },
      recents: [NOTE],
      launch: { welcome: true },
    });
    await page.goto('/');

    await page.getByTestId('recent-item').click();

    await expect(page.getByTestId('document-name')).toHaveText('note.md');
    await expect(preview(page).getByRole('heading', { name: 'Note' })).toBeVisible();
  });

  test('A01 the welcome screen does not load the editor or the preview', async ({ page }) => {
    await seedMock(page, { launch: { welcome: true } });
    const loaded: string[] = [];
    page.on('request', (request) => loaded.push(request.url()));
    await page.goto('/');
    await expect(page.getByTestId('welcome')).toBeVisible();

    const heavy =
      /codemirror|markdown-it|dompurify|\/src\/editor\/|\/src\/preview\/(controller|engine|render|packs)|shell\/workspace|Workspace\.svelte/i;
    expect(loaded.filter((url) => heavy.test(url))).toEqual([]);
    await expect(page.locator('.cm-editor')).toHaveCount(0);
  });
});

test.describe('A02 opening files', () => {
  const A = `${DOCS}/a.md`;
  const B = `${DOCS}/b.md`;

  test('A02 Open with two files opens two tabs in Preview, and an open file is activated, not duplicated', async ({
    page,
  }) => {
    await seedMock(page, {
      files: { [A]: '# File A', [B]: '# File B' },
      openDialog: [A, B],
      launch: { welcome: true },
    });
    await page.goto('/');
    await expect(page.getByTestId('welcome')).toBeVisible();

    await menu(page, 'open');

    await expect(tabs(page)).toHaveText(['a.md', 'b.md']);
    await expect(page.getByTestId('tab-strip')).toBeVisible();
    await expect(page.getByTestId('document-name')).toHaveText('b.md');
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'preview');
    await expect(preview(page).getByRole('heading', { name: 'File B' })).toBeVisible();

    await tabs(page).first().click();
    await expect(page.getByTestId('document-name')).toHaveText('a.md');
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'preview');
    await expect(preview(page).getByRole('heading', { name: 'File A' })).toBeVisible();

    // Opening b.md again activates its tab.
    await answers(page, { openDialog: [B] });
    await menu(page, 'open');
    await expect(page.getByTestId('document-name')).toHaveText('b.md');
    await expect(tabs(page)).toHaveCount(2);
  });

  test('A02 one document shows no tab strip', async ({ page }) => {
    await openNote(page);

    await expect(page.getByTestId('tab-strip')).toHaveCount(0);
  });
});

test.describe('A03 new documents', () => {
  test('A03 New creates "Untitled" in Split, and a second New creates "Untitled 2"', async ({
    page,
  }) => {
    await seedMock(page, { launch: { welcome: true } });
    await page.goto('/');

    await page.getByTestId('welcome-new').click();

    await expect(page.getByTestId('document-name')).toHaveText('Untitled');
    await expect(page.getByTestId('workspace')).toHaveAttribute('data-view', 'split');
    await expect(editor(page)).toBeVisible();
    await expect(page.getByTestId('save-status')).toHaveText('Not saved');

    await menu(page, 'new');

    await expect(page.getByTestId('document-name')).toHaveText('Untitled 2');
    await expect(tabs(page)).toHaveText(['Untitled', 'Untitled 2']);
  });

  test('A03 the New button in the title bar does the same', async ({ page }) => {
    await seedMock(page, { launch: { welcome: true } });
    await page.goto('/');

    await page.getByTestId('new-button').click();

    await expect(page.getByTestId('document-name')).toHaveText('Untitled');
  });
});

test.describe('A04 the save status clock', () => {
  test('A04 the save status refreshes every 30 seconds while the window is visible, and not while it is hidden', async ({
    page,
  }) => {
    await page.clock.install({ time: new Date('2026-10-04T12:00:00') });
    await page.addInitScript(() => {
      let state = 'visible';
      Object.defineProperty(document, 'visibilityState', { get: () => state, configurable: true });
      (window as unknown as { __setVisibility: (next: string) => void }).__setVisibility = (
        next,
      ) => {
        state = next;
        document.dispatchEvent(new Event('visibilitychange'));
      };
    });
    await openNote(page);
    await typeAtEnd(page, 'x');
    await menu(page, 'save');
    await expect(page.getByTestId('save-status')).toHaveText('Saved \u2022 just now');

    // The timer ticks every 30 s from startup: the tick at 2:30 sees a save that is about 2:29 old.
    await page.clock.runFor('02:30');
    await expect(page.getByTestId('save-status')).toHaveText('Saved \u2022 2m ago');

    // Hidden: no timer runs, so the text stays as it was...
    await page.evaluate(() =>
      (window as unknown as { __setVisibility: (next: string) => void }).__setVisibility('hidden'),
    );
    await page.clock.runFor('10:00');
    await expect(page.getByTestId('save-status')).toHaveText('Saved \u2022 2m ago');

    // ...and it catches up at once when the window is visible again.
    await page.evaluate(() =>
      (window as unknown as { __setVisibility: (next: string) => void }).__setVisibility('visible'),
    );
    await expect(page.getByTestId('save-status')).toHaveText('Saved \u2022 12m ago');
  });
});

test.describe('A04 editing and saving', () => {
  test('A04 typing marks the tab and title dirty, and Save writes the exact text and clears it', async ({
    page,
  }) => {
    await openNote(page);
    await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

    await typeAtEnd(page, 'More words');

    await expect(page.getByTestId('dirty-dot')).toBeVisible();
    await expect(page.getByTestId('save-status')).toHaveText('Edited');

    await menu(page, 'save');

    await expect(page.getByTestId('save-status')).toHaveText('Saved • just now');
    await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
    const [save, ...rest] = await saves(page);
    expect(rest).toEqual([]);
    expect(save?.path).toBe(NOTE);
    expect(save?.text).toBe(`${NOTE_TEXT}More words`);
    expect(save?.format).toEqual({ encoding: 'utf-8', lineEnding: 'lf' });
    expect(save?.options.expectedModifiedMs).not.toBeNull();
  });

  test('A04 undoing back to the saved text clears the dirty dot', async ({ page }) => {
    await openNote(page);

    await typeAtEnd(page, 'x');
    await expect(page.getByTestId('dirty-dot')).toBeVisible();
    await page.keyboard.press('Backspace');

    await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
    await expect(page.getByTestId('save-status')).toContainText('Saved');
  });

  test('A04 the Save button saves, and a second save sends the new modification time', async ({
    page,
  }) => {
    await openNote(page);
    await typeAtEnd(page, 'one');
    await page.getByTestId('save-button').click();
    await expect.poll(async () => (await saves(page)).length).toBe(1);
    await typeAtEnd(page, 'two');

    await page.getByTestId('save-button').click();

    await expect.poll(async () => (await saves(page)).length).toBe(2);
    const [first, second] = await saves(page);
    expect(second?.options.expectedModifiedMs).toBe(first?.result.modifiedMs);
    expect(second?.text).toBe(`${NOTE_TEXT}onetwo`);
  });

  test('A04 the window title and the menu state follow the document', async ({ page }) => {
    await openNote(page);

    await expect
      .poll(() => page.evaluate(() => window.__BACKTICKLE_MOCK__?.windowTitles.at(-1)))
      .toBe('note.md');
    const state = await page.evaluate(() => window.__BACKTICKLE_MOCK__?.menuStates.at(-1));
    expect(state).toEqual({
      hasDocument: true,
      canSave: true,
      canFormat: true,
      viewMode: 'split',
      sidebarVisible: true,
      syncScroll: true,
      typewriter: false,
      tabCount: 1,
      hasPath: true,
      canExportDocx: false,
      canExactPreview: false,
      exactPreview: false,
      canRender: false,
    });
  });
});

test.describe('A05 Save As', () => {
  test('A05 Save on an untitled document goes through Save As, names the file after the first heading, and the tab follows the new path', async ({
    page,
  }) => {
    await seedMock(page, {
      saveDialog: `${DOCS}/Quarterly Plan.qmd`,
      launch: { welcome: true },
    });
    await page.goto('/');
    await menu(page, 'new');
    await typeAtEnd(page, '# Quarterly Plan\n\nBody');

    await menu(page, 'save');

    await expect(page.getByTestId('document-name')).toHaveText('Quarterly Plan.qmd');
    const dialogs = await page.evaluate(() => window.__BACKTICKLE_MOCK__?.saveDialogs);
    expect(dialogs).toEqual([{ suggestedName: 'Quarterly Plan.md', directory: null }]);
    const [save] = await saves(page);
    expect(save?.path).toBe(`${DOCS}/Quarterly Plan.qmd`);
    expect(save?.text).toBe('# Quarterly Plan\n\nBody');
    expect(save?.options.expectedModifiedMs).toBeNull();
    await expect(page.getByTestId('flavor-pill')).toContainText('Quarto / RMD');
    await expect(page.getByTestId('flavor-auto')).toBeVisible();
    await expect(page.getByTestId('save-status')).toContainText('Saved');
    await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  });

  test('A05 the suggested name is "Untitled.md" without a heading, and a cancelled dialog saves nothing', async ({
    page,
  }) => {
    await seedMock(page, { saveDialog: null, launch: { welcome: true } });
    await page.goto('/');
    await menu(page, 'new');
    await typeAtEnd(page, 'just words');

    await menu(page, 'save');

    await expect
      .poll(() => page.evaluate(() => window.__BACKTICKLE_MOCK__?.saveDialogs.length))
      .toBe(1);
    const dialogs = await page.evaluate(() => window.__BACKTICKLE_MOCK__?.saveDialogs);
    expect(dialogs?.[0]?.suggestedName).toBe('Untitled.md');
    expect(await saves(page)).toEqual([]);
    await expect(page.getByTestId('dirty-dot')).toBeVisible();
    await expect(page.getByTestId('document-name')).toHaveText('Untitled');
  });

  test('A05 Save As on a saved document asks for a new name and keeps working with the new file', async ({
    page,
  }) => {
    await openNote(page, { saveDialog: `${DOCS}/copy.md` });

    await menu(page, 'save-as');

    await expect(page.getByTestId('document-name')).toHaveText('copy.md');
    const dialogs = await page.evaluate(() => window.__BACKTICKLE_MOCK__?.saveDialogs);
    expect(dialogs).toEqual([{ suggestedName: 'note.md', directory: DOCS }]);
    const [save] = await saves(page);
    expect(save?.path).toBe(`${DOCS}/copy.md`);
    expect(save?.text).toBe(NOTE_TEXT);
  });
});

test.describe('A06 a file that changed on disk', () => {
  test('A06 Save asks before overwriting; Cancel keeps the document dirty, Overwrite retries with the flag', async ({
    page,
  }) => {
    await openNote(page, { ask: false });
    await typeAtEnd(page, 'mine');
    await page.evaluate((path) => window.__BACKTICKLE_MOCK__?.externallyModify(path), NOTE);

    await menu(page, 'save');

    await expect.poll(() => page.evaluate(() => window.__BACKTICKLE_MOCK__?.asks.length)).toBe(1);
    const [ask] = await page.evaluate(() => window.__BACKTICKLE_MOCK__?.asks ?? []);
    expect(ask).toMatchObject({
      title: 'The file changed on disk since you opened it',
      ok: 'Overwrite',
      cancel: 'Cancel',
    });
    expect(await saves(page)).toEqual([]);
    await expect(page.getByTestId('dirty-dot')).toBeVisible();

    await answers(page, { ask: true });
    await menu(page, 'save');

    await expect.poll(async () => (await saves(page)).length).toBe(1);
    const [save] = await saves(page);
    expect(save?.options.overwriteExternalChange).toBe(true);
    expect(save?.text).toBe(`${NOTE_TEXT}mine`);
    await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  });
});

test.describe('A07 encodings, lossy and read-only files', () => {
  test('A07 a legacy-encoded file shows the conversion banner, and saving writes UTF-8', async ({
    page,
  }) => {
    await openNote(page, {
      files: {
        [NOTE]: { text: 'café à la carte\n', legacyEncoding: 'windows-1252' },
      },
    });

    await expect(page.getByTestId('banner-legacy')).toHaveText(
      /Opened as Windows-1252\. Saving converts it to UTF-8\./,
    );
    await expect(page.getByTestId('status-encoding')).toHaveText('Windows-1252');

    await typeAtEnd(page, '!');
    await menu(page, 'save');

    await expect.poll(async () => (await saves(page)).length).toBe(1);
    const [save] = await saves(page);
    expect(save?.format.encoding).toBe('utf-8');
    await expect(page.getByTestId('status-encoding')).toHaveText('UTF-8');
    await expect(page.getByTestId('banner-legacy')).toHaveCount(0);
  });

  test('A07 a banner can be dismissed', async ({ page }) => {
    await openNote(page, { files: { [NOTE]: { text: 'x', legacyEncoding: 'windows-1252' } } });

    await page.getByTestId('banner-legacy').getByRole('button', { name: 'Dismiss' }).click();

    await expect(page.getByTestId('banner-legacy')).toHaveCount(0);
  });

  test('A07 a lossy file shows a banner and asks before it is saved', async ({ page }) => {
    await openNote(page, {
      files: { [NOTE]: { text: 'bad � byte\n', lossy: true } },
      ask: false,
    });
    await expect(page.getByTestId('banner-lossy')).toBeVisible();
    await typeAtEnd(page, '!');

    await menu(page, 'save');

    await expect.poll(() => page.evaluate(() => window.__BACKTICKLE_MOCK__?.asks.length)).toBe(1);
    expect(await saves(page)).toEqual([]);
    await expect(page.getByTestId('dirty-dot')).toBeVisible();

    await answers(page, { ask: true });
    await menu(page, 'save');

    await expect.poll(async () => (await saves(page)).length).toBe(1);
    const [save] = await saves(page);
    expect(save?.options.allowLossy).toBe(true);
  });

  test('A07 a read-only file shows a banner and saves through Save As', async ({ page }) => {
    await openNote(page, {
      files: { [NOTE]: { text: NOTE_TEXT, readOnly: true } },
      saveDialog: `${DOCS}/note copy.md`,
    });
    await expect(page.getByTestId('banner-readOnly')).toBeVisible();
    await typeAtEnd(page, 'edit');

    await menu(page, 'save');

    await expect(page.getByTestId('document-name')).toHaveText('note copy.md');
    const dialogs = await page.evaluate(() => window.__BACKTICKLE_MOCK__?.saveDialogs.length);
    expect(dialogs).toBe(1);
    const [save] = await saves(page);
    expect(save?.path).toBe(`${DOCS}/note copy.md`);
    expect(save?.text).toBe(`${NOTE_TEXT}edit`);
    await expect(page.getByTestId('banner-readOnly')).toHaveCount(0);
  });
});

test.describe('A08 closing tabs, the window and the app', () => {
  const A = `${DOCS}/a.md`;
  const B = `${DOCS}/b.md`;
  const C = `${DOCS}/c.md`;

  /** Three files opened at launch in Split view, the first one on show. */
  async function openThree(page: Page, seed: MockSeed = {}) {
    await seedMock(page, {
      files: { [A]: '# A\n', [B]: '# B\n', [C]: '# C\n' },
      openDialog: [B, C],
      launch: { openPath: A, view: 'split' },
      ...seed,
    });
    await page.goto('/');
    await expect(preview(page).getByRole('heading', { name: 'A' })).toBeVisible();
    await menu(page, 'open');
    await expect(tabs(page)).toHaveCount(3);
    await menu(page, 'view-split');
  }

  /** Types into the document on show and waits for the dirty mark. */
  async function dirty(page: Page, name: string) {
    await menu(page, 'view-split');
    await typeAtEnd(page, '!');
    await expect(page.getByTestId('save-status')).toHaveText('Edited');
    await expect(page.getByTestId('document-name')).toHaveText(name);
  }

  test('A08 a clean tab closes at once with Close Tab', async ({ page }) => {
    await openThree(page);

    await menu(page, 'close-tab');

    await expect(tabs(page)).toHaveText(['a.md', 'b.md']);
    expect(await page.evaluate(() => window.__BACKTICKLE_MOCK__?.confirmations)).toEqual([]);
  });

  test('A08 Close Tab on a dirty tab asks, and Cancel keeps it open and dirty', async ({
    page,
  }) => {
    await openThree(page, { confirmUnsaved: 'cancel' });
    await dirty(page, 'c.md');

    await menu(page, 'close-tab');

    await expect
      .poll(() => page.evaluate(() => window.__BACKTICKLE_MOCK__?.confirmations))
      .toEqual(['c.md']);
    await expect(tabs(page)).toHaveCount(3);
    await expect(page.getByTestId('save-status')).toHaveText('Edited');
    expect(await saves(page)).toEqual([]);
  });

  test("A08 Close Tab with Don't Save closes the tab without writing", async ({ page }) => {
    await openThree(page, { confirmUnsaved: 'discard' });
    await dirty(page, 'c.md');

    await menu(page, 'close-tab');

    await expect(tabs(page)).toHaveText(['a.md', 'b.md']);
    await expect(page.getByTestId('document-name')).toHaveText('b.md');
    expect(await saves(page)).toEqual([]);
  });

  test('A08 Close Tab with Save writes the file, then closes the tab', async ({ page }) => {
    await openThree(page, { confirmUnsaved: 'save' });
    await dirty(page, 'c.md');

    await menu(page, 'close-tab');

    await expect(tabs(page)).toHaveText(['a.md', 'b.md']);
    const [save] = await saves(page);
    expect(save?.path).toBe(C);
    expect(save?.text).toBe('# C\n!');
  });

  test('A08 closing the window walks the dirty tabs in order; Cancel stops the walk and tells Rust', async ({
    page,
  }) => {
    await openThree(page, { confirmUnsaved: ['discard', 'cancel'] });
    await tabs(page).first().click();
    await dirty(page, 'a.md');
    await tabs(page).nth(2).click();
    await dirty(page, 'c.md');
    await tabs(page).nth(1).click();
    await dirty(page, 'b.md');

    await page.evaluate(() => window.__BACKTICKLE_MOCK__?.closeRequested('window'));

    await expect
      .poll(() => page.evaluate(() => window.__BACKTICKLE_MOCK__?.confirmations))
      .toEqual(['a.md', 'b.md']);
    await expect
      .poll(() => page.evaluate(() => window.__BACKTICKLE_MOCK__?.cancelCloses))
      .toEqual(['window']);
    expect(await page.evaluate(() => window.__BACKTICKLE_MOCK__?.finishCloses)).toEqual([]);
    await expect(tabs(page)).toHaveCount(3);
    // The walk stopped on the second document, which is now on show.
    await expect(page.getByTestId('document-name')).toHaveText('b.md');
  });

  test('A08 closing the window finishes when every question is answered', async ({ page }) => {
    await openThree(page, { confirmUnsaved: ['save', 'discard'] });
    await tabs(page).first().click();
    await dirty(page, 'a.md');
    await tabs(page).nth(1).click();
    await dirty(page, 'b.md');

    await page.evaluate(() => window.__BACKTICKLE_MOCK__?.closeRequested('window'));

    await expect
      .poll(() => page.evaluate(() => window.__BACKTICKLE_MOCK__?.finishCloses))
      .toEqual(['window']);
    expect(await page.evaluate(() => window.__BACKTICKLE_MOCK__?.cancelCloses)).toEqual([]);
    const written = await saves(page);
    expect(written.map((save) => save.path)).toEqual([A]);
  });

  test('A08 a quit with unsaved changes asks the same, and Cancel calls cancelClose("quit")', async ({
    page,
  }) => {
    await openThree(page, { confirmUnsaved: 'cancel' });
    await dirty(page, 'c.md');

    await page.evaluate(() => window.__BACKTICKLE_MOCK__?.closeRequested('quit'));

    await expect
      .poll(() => page.evaluate(() => window.__BACKTICKLE_MOCK__?.cancelCloses))
      .toEqual(['quit']);
    expect(await page.evaluate(() => window.__BACKTICKLE_MOCK__?.finishCloses)).toEqual([]);
  });

  test('A08 with nothing unsaved, a close request finishes at once', async ({ page }) => {
    await openThree(page);

    await page.evaluate(() => window.__BACKTICKLE_MOCK__?.closeRequested('quit'));

    await expect
      .poll(() => page.evaluate(() => window.__BACKTICKLE_MOCK__?.finishCloses))
      .toEqual(['quit']);
    expect(await page.evaluate(() => window.__BACKTICKLE_MOCK__?.confirmations)).toEqual([]);
  });

  test('A08 a window close with no document finishes at once; Close Window from the menu does nothing in the page', async ({
    page,
  }) => {
    await seedMock(page, { launch: { welcome: true } });
    await page.goto('/');
    await expect(page.getByTestId('welcome')).toBeVisible();

    await menu(page, 'close-window');
    await page.evaluate(() => window.__BACKTICKLE_MOCK__?.closeRequested('window'));

    await expect
      .poll(() => page.evaluate(() => window.__BACKTICKLE_MOCK__?.finishCloses))
      .toEqual(['window']);
  });

  test('A08 the close button and middle-click close tabs, and the last tab brings the welcome screen back', async ({
    page,
  }) => {
    await openThree(page);

    await tabs(page).nth(1).dispatchEvent('auxclick', { button: 1 });
    await expect(tabs(page)).toHaveText(['a.md', 'c.md']);

    await page.getByRole('button', { name: 'Close a.md' }).click({ force: true });
    await expect(tabs(page)).toHaveCount(0); // a single tab shows no strip
    await expect(page.getByTestId('document-name')).toHaveText('c.md');

    await menu(page, 'close-tab');
    await expect(page.getByTestId('welcome')).toBeVisible();
    await expect(page.getByTestId('workspace')).toHaveCount(0);

    // The editor and preview are created again when a document is opened later.
    await menu(page, 'new');
    await expect(page.getByTestId('document-name')).toHaveText('Untitled');
    await expect(editor(page)).toBeVisible();
  });

  test('A08 Control+Tab cycles through the tabs (next-tab and previous-tab)', async ({ page }) => {
    await openThree(page);
    await expect(page.getByTestId('document-name')).toHaveText('c.md');

    await menu(page, 'next-tab');
    await expect(page.getByTestId('document-name')).toHaveText('a.md');
    await menu(page, 'previous-tab');
    await expect(page.getByTestId('document-name')).toHaveText('c.md');
    await menu(page, 'previous-tab');
    await expect(page.getByTestId('document-name')).toHaveText('b.md');
  });

  test('A08 each tab keeps its own text, undo history and dirty state', async ({ page }) => {
    await openThree(page);
    await tabs(page).first().click();
    await dirty(page, 'a.md');
    await tabs(page).nth(1).click();
    await expect(page.getByTestId('document-name')).toHaveText('b.md');
    await expect(page.getByTestId('save-status')).toContainText('Saved');
    await menu(page, 'view-split');
    await expect(editor(page)).not.toContainText('!');

    await tabs(page).first().click();

    await expect(editor(page)).toContainText('# A!');
    await expect(page.getByTestId('save-status')).toHaveText('Edited');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.getByTestId('save-status')).toContainText('Saved');
  });
});

test.describe('A09 files opened from outside', () => {
  const A = `${DOCS}/a.md`;
  const B = `${DOCS}/b.md`;

  test('A09 open-files events (Finder, Dock, drag and drop) open tabs', async ({ page }) => {
    await seedMock(page, { files: { [A]: '# A', [B]: '# B' }, launch: { welcome: true } });
    await page.goto('/');
    await expect(page.getByTestId('welcome')).toBeVisible();

    await page.evaluate((paths) => window.__BACKTICKLE_MOCK__?.openFiles(paths), [A]);
    await expect(page.getByTestId('document-name')).toHaveText('a.md');

    await page.evaluate((paths) => window.__BACKTICKLE_MOCK__?.openFiles(paths), [B]);
    await expect(tabs(page)).toHaveText(['a.md', 'b.md']);
    await expect(page.getByTestId('document-name')).toHaveText('b.md');
  });

  test('A09 files opened before the page was ready are taken with takePendingOpenFiles', async ({
    page,
  }) => {
    await seedMock(page, {
      files: { [A]: '# A', [B]: '# B' },
      pendingOpenFiles: [A, B],
      launch: {},
    });
    await page.goto('/');

    await expect(tabs(page)).toHaveText(['a.md', 'b.md']);
    await expect(page.getByTestId('document-name')).toHaveText('b.md');
  });

  test('A09 the file given at launch comes first, then the pending ones', async ({ page }) => {
    await seedMock(page, {
      files: { [A]: '# A', [B]: '# B' },
      pendingOpenFiles: [B],
      launch: { openPath: A },
    });
    await page.goto('/');

    await expect(tabs(page)).toHaveText(['a.md', 'b.md']);
  });

  test('A09 a file that opens twice is activated, not duplicated', async ({ page }) => {
    await seedMock(page, { files: { [A]: '# A', [B]: '# B' }, launch: { welcome: true } });
    await page.goto('/');
    await page.evaluate((paths) => window.__BACKTICKLE_MOCK__?.openFiles(paths), [A, B]);
    await expect(tabs(page)).toHaveCount(2);

    await page.evaluate((paths) => window.__BACKTICKLE_MOCK__?.openFiles(paths), [A]);

    await expect(page.getByTestId('document-name')).toHaveText('a.md');
    await expect(tabs(page)).toHaveCount(2);
  });
});

test.describe('A10 line endings', () => {
  const CRLF = `${DOCS}/crlf.md`;

  async function openCrlf(page: Page) {
    await seedMock(page, {
      files: { [CRLF]: { text: 'one\r\ntwo\r\n', lineEnding: 'crlf' } },
      launch: { openPath: CRLF, view: 'split' },
    });
    await page.goto('/');
    await expect(editor(page)).toContainText('one');
  }

  test('A10 a CRLF file keeps CRLF when edited and saved', async ({ page }) => {
    await openCrlf(page);
    await expect(page.getByTestId('status-line-ending')).toHaveText('CRLF');

    await typeAtEnd(page, 'three');
    await menu(page, 'save');

    await expect.poll(async () => (await saves(page)).length).toBe(1);
    const [save] = await saves(page);
    expect(save?.format.lineEnding).toBe('crlf');
    expect(save?.text).toBe('one\ntwo\nthree');
  });

  test('A10 clicking LF/CRLF switches the saved line ending and marks the document edited', async ({
    page,
  }) => {
    await openCrlf(page);
    await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

    await page.getByTestId('status-line-ending').click();

    await expect(page.getByTestId('status-line-ending')).toHaveText('LF');
    await expect(page.getByTestId('dirty-dot')).toBeVisible();
    await expect(page.getByTestId('save-status')).toHaveText('Edited');

    await menu(page, 'save');

    await expect.poll(async () => (await saves(page)).length).toBe(1);
    const [save] = await saves(page);
    expect(save?.format.lineEnding).toBe('lf');
    expect(save?.text).toBe('one\ntwo\n');
    await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  });

  test('A10 switching the line ending back clears the edit mark', async ({ page }) => {
    await openCrlf(page);

    await page.getByTestId('status-line-ending').click();
    await expect(page.getByTestId('dirty-dot')).toBeVisible();
    await page.getByTestId('status-line-ending').click();

    await expect(page.getByTestId('status-line-ending')).toHaveText('CRLF');
    await expect(page.getByTestId('dirty-dot')).toHaveCount(0);
  });

  test('A10 the encoding is kept: a UTF-8 file with a byte order mark saves with it', async ({
    page,
  }) => {
    await seedMock(page, {
      files: { [NOTE]: { text: fixture('encoding/utf8-lf.md'), encoding: 'utf-8-bom' } },
      launch: { openPath: NOTE, view: 'split' },
    });
    await page.goto('/');
    await expect(page.getByTestId('status-encoding')).toHaveText('UTF-8 with BOM');

    await typeAtEnd(page, 'x');
    await menu(page, 'save');

    await expect.poll(async () => (await saves(page)).length).toBe(1);
    expect((await saves(page))[0]?.format.encoding).toBe('utf-8-bom');
  });
});

test.describe('A14 undo and redo from the menu', () => {
  test('A14 Undo and Redo menu actions act on the editor', async ({ page }) => {
    await openNote(page);
    await typeAtEnd(page, 'MENU-UNDO');
    await expect(editor(page)).toContainText('MENU-UNDO');

    await menu(page, 'undo');
    await expect(editor(page)).not.toContainText('MENU-UNDO');
    await expect(page.getByTestId('dirty-dot')).toHaveCount(0);

    await menu(page, 'redo');
    await expect(editor(page)).toContainText('MENU-UNDO');
    await expect(page.getByTestId('dirty-dot')).toBeVisible();
  });
});
