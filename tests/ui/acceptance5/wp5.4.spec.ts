/**
 * Crash recovery, cases E5.4-1 to E5.4-12, against the mock. The mock
 * keeps its recovery entries in the page's storage, so a reload without a clean quit is the
 * simulated crash. Run with WD_UI_PORT=1494.
 */
import { expect, type Page, test } from '@playwright/test';
import type { MockSeed } from '../../../src/lib/platform-mock';
import { editor, HOME, menu, seedMock, typeAtEnd } from '../helpers';

const A = `${HOME}/a.md`;
const B = `${HOME}/b.md`;
const FILES = { [A]: '# Alpha\n\nfirst\n', [B]: '# Beta\n\nsecond\n' };

const mock = <T>(page: Page, read: (m: NonNullable<Window['__WRITEDOWN_MOCK__']>) => T) =>
  page.evaluate(`(${read.toString()})(window.__WRITEDOWN_MOCK__)`) as Promise<T>;
const entries = (page: Page) => mock(page, (m) => m.recoveryEntries);
const firstEntry = async (page: Page) => {
  const [entry] = await entries(page);
  if (!entry) throw new Error('no recovery entry');
  return entry;
};
const entryCount = (page: Page, count: number) =>
  expect.poll(() => mock(page, (m) => m.recoveryEntries.length), { timeout: 8000 }).toBe(count);
const dirtyDot = (page: Page) => page.getByTestId('dirty-dot');
const banner = (page: Page) => page.getByTestId('banner-recovered');

async function start(page: Page, seed: Partial<MockSeed> = {}) {
  await seedMock(page, {
    files: FILES,
    launch: { openPath: A, view: 'editor' },
    settings: { openExistingIn: 'editor' },
    ...seed,
  });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');
  if (!seed.launch?.welcome) await expect(editor(page)).toBeVisible();
}

test('E5.4-1 a clean document has no entry, an edited one gets one about 2 s after the last edit', async ({
  page,
}) => {
  await start(page);
  await page.waitForTimeout(2600);
  expect(await entries(page)).toEqual([]);
  await typeAtEnd(page, 'unsaved words');
  const typedAt = Date.now();
  expect(await entries(page)).toEqual([]);
  await entryCount(page, 1);
  expect(Date.now() - typedAt).toBeGreaterThan(1500);
  const entry = await firstEntry(page);
  expect(entry.text).toBe('# Alpha\n\nfirst\nunsaved words');
  expect(entry.path).toBe(A);
  expect(entry.window).toBe('main');
  expect(entry.view).toBe('editor');
  expect(entry.flavor).toBe('gfm');
  expect(entry.modifiedMs).not.toBeNull();
});

test('E5.4-2 an untitled document is kept too, without a path', async ({ page }) => {
  await start(page, { launch: { welcome: true } });
  await menu(page, 'new');
  await typeAtEnd(page, 'a draft that has no file');
  await entryCount(page, 1);
  const entry = await firstEntry(page);
  expect(entry.path).toBeNull();
  expect(entry.text).toBe('a draft that has no file');
  expect(entry.name).toMatch(/^Untitled/);
});

test('E5.4-3 the window losing focus keeps the document at once', async ({ page }) => {
  await start(page);
  await typeAtEnd(page, 'blur me');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(() => mock(page, (m) => m.recoveryEntries.length), { timeout: 1000 }).toBe(1);
});

test('E5.4-4 saving removes the entry', async ({ page }) => {
  await start(page);
  await typeAtEnd(page, 'saved soon');
  await entryCount(page, 1);
  await menu(page, 'save');
  await entryCount(page, 0);
  await expect(dirtyDot(page)).toBeHidden();
});

test('E5.4-5 undoing back to the saved text removes the entry', async ({ page }) => {
  await start(page);
  await typeAtEnd(page, 'x');
  await entryCount(page, 1);
  await page.keyboard.press('ControlOrMeta+z');
  await entryCount(page, 0);
});

test("E5.4-6 closing a tab with Don't Save removes the entry", async ({ page }) => {
  await start(page, { confirmUnsaved: 'discard' });
  await typeAtEnd(page, 'thrown away');
  await entryCount(page, 1);
  await menu(page, 'close-tab');
  await entryCount(page, 0);
});

test("E5.4-7 a clean quit after Don't Save leaves nothing behind", async ({ page }) => {
  await start(page, { confirmUnsaved: 'discard' });
  await typeAtEnd(page, 'thrown away at quit');
  await entryCount(page, 1);
  await mock(page, (m) => m.closeRequested('quit'));
  await entryCount(page, 0);
});

test('E5.4-8 a cancelled quit keeps the entry', async ({ page }) => {
  await start(page, { confirmUnsaved: 'cancel' });
  await typeAtEnd(page, 'still here');
  await entryCount(page, 1);
  await mock(page, (m) => m.closeRequested('quit'));
  await page.waitForTimeout(500);
  expect(await mock(page, (m) => m.recoveryEntries.length)).toBe(1);
});

test('E5.4-9 after a crash the document comes back marked Recovered with its unsaved text', async ({
  page,
}) => {
  await start(page);
  await typeAtEnd(page, ' lost words');
  await entryCount(page, 1);
  await page.reload();
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toContainText('Recovered');
  await expect(editor(page)).toContainText('lost words');
  await expect(dirtyDot(page)).toBeVisible();
  // The file on disk is untouched.
  expect(await mock(page, (m) => m.file('/Users/mock/a.md')?.text)).toBe(FILES[A]);
});

test('E5.4-10 Keep leaves a normal unsaved document, Save then removes the entry', async ({
  page,
}) => {
  await start(page);
  await typeAtEnd(page, ' keep me');
  await entryCount(page, 1);
  await page.reload();
  await expect(banner(page)).toBeVisible();
  await banner(page).getByRole('button', { name: 'Keep' }).click();
  await expect(banner(page)).toBeHidden();
  await expect(dirtyDot(page)).toBeVisible();
  expect(await mock(page, (m) => m.recoveryEntries.length)).toBe(1);
  await menu(page, 'save');
  await entryCount(page, 0);
  expect(await mock(page, (m) => m.file('/Users/mock/a.md')?.text)).toContain('keep me');
});

test('E5.4-11 Discard closes the document and removes the entry', async ({ page }) => {
  await start(page);
  await typeAtEnd(page, ' discard me');
  await entryCount(page, 1);
  await page.reload();
  await banner(page).getByRole('button', { name: 'Discard' }).click();
  await entryCount(page, 0);
  await expect(banner(page)).toBeHidden();
  await expect(editor(page)).toBeHidden();
});

test('E5.4-12 an untitled document comes back without a file', async ({ page }) => {
  await start(page, { launch: { welcome: true } });
  await menu(page, 'new');
  await typeAtEnd(page, 'untitled and lost');
  await entryCount(page, 1);
  await page.reload();
  await expect(banner(page)).toBeVisible();
  await expect(editor(page)).toContainText('untitled and lost');
  await expect(page.getByTestId('document-name')).toContainText('Untitled');
});

test('E5.4-13 a recovered document replaces the tab the session restored for the same path', async ({
  page,
}) => {
  await start(page, {
    launch: { welcome: false },
    session: {
      tabs: [
        { path: A, view: 'editor' },
        { path: B, view: 'editor' },
      ],
      active: 0,
      folder: null,
      sidebarTab: 'outline',
      expanded: [],
    },
  });
  await typeAtEnd(page, ' crash text');
  await entryCount(page, 1);
  await page.reload();
  await expect(banner(page)).toBeVisible();
  await expect(page.getByTestId('tab-strip').getByRole('tab')).toHaveCount(2);
  await expect(editor(page)).toContainText('crash text');
});

test('E5.4-14 a file that changed on disk since gets the changed-on-disk banner as well', async ({
  page,
}) => {
  await start(page, {
    launch: { welcome: true },
    recovery: [
      {
        id: 'seeded-entry-0001',
        text: '# Alpha\n\nedited before the crash\n',
        path: A,
        name: 'a.md',
        flavor: 'gfm',
        view: 'editor',
        line: 3,
        column: 2,
        window: 'main',
        modifiedMs: 1,
        savedAtMs: 1000,
      },
    ],
  });
  await expect(banner(page)).toBeVisible();
  await expect(page.getByTestId('banner-external')).toBeVisible();
  await expect(editor(page)).toContainText('edited before the crash');
});

test('E5.4-15 a document with an unreadable file comes back as a document without a file', async ({
  page,
}) => {
  await start(page, {
    launch: { welcome: true },
    recovery: [
      {
        id: 'seeded-entry-0002',
        text: 'the file is gone',
        path: `${HOME}/gone.md`,
        name: 'gone.md',
        flavor: 'gfm',
        view: 'editor',
        line: 1,
        column: 0,
        window: 'main',
        modifiedMs: 1,
        savedAtMs: 1000,
      },
    ],
  });
  await expect(banner(page)).toBeVisible();
  await expect(editor(page)).toContainText('the file is gone');
  await expect(page.getByTestId('banner-external')).toBeHidden();
});

test('E5.4-16 the recovery code is not loaded until a document is edited', async ({ page }) => {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  await start(page);
  await page.waitForTimeout(800);
  expect(urls.filter((url) => /\/src\/shell\/recovery/.test(url))).toEqual([]);
  await typeAtEnd(page, 'now');
  await expect
    .poll(() => urls.some((url) => /\/src\/shell\/recovery/.test(url)), { timeout: 4000 })
    .toBe(true);
});

test('E5.4-17 an entry holds the text and its place and nothing else, and the session never has the text', async ({
  page,
}) => {
  await start(page);
  await typeAtEnd(page, 'secret sentence');
  await entryCount(page, 1);
  const entry = await firstEntry(page);
  expect(Object.keys(entry).sort()).toEqual(
    [
      'column',
      'flavor',
      'id',
      'line',
      'modifiedMs',
      'name',
      'path',
      'savedAtMs',
      'text',
      'view',
      'window',
    ].sort(),
  );
  await mock(page, (m) => m.closeRequested('quit'));
  const sessions = await mock(page, (m) => JSON.stringify(m.sessions));
  expect(sessions).not.toContain('secret sentence');
});

test('E5.4-18 the launch hook types its sentence into the open document and keeps it', async ({
  page,
}) => {
  await start(page, { launch: { openPath: A, view: 'editor', benchRecovery: true } });
  await entryCount(page, 1);
  const entry = await firstEntry(page);
  expect(entry.path).toBe(A);
  expect(entry.text).toContain('Recovery check: this sentence was never saved.');
});

test('E5.4-19 the launch hook starts a new document when none is open', async ({ page }) => {
  await start(page, { launch: { welcome: true, benchRecovery: true } });
  await entryCount(page, 1);
  const entry = await firstEntry(page);
  expect(entry.path).toBeNull();
  expect(entry.text).toBe('Recovery check: this sentence was never saved.');
});
