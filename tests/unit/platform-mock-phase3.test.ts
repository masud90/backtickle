import { describe, expect, it } from 'vitest';
import { cleanName, copyName, createMockPlatform, type MockSeed } from '@/lib/platform-mock';

const ROOT = '/notes';

function folderPlatform(extra: MockSeed = {}) {
  return createMockPlatform({
    files: {
      '/notes/b.md': 'B',
      '/notes/A.md': 'A',
      '/notes/readme.txt': 'text',
      '/notes/.hidden.md': 'h',
      '/notes/node_modules/x.md': 'x',
      '/notes/sub/c.qmd': 'c',
      '/notes/sub/deep/d.Rmd': 'd',
      '/outside/o.md': 'o',
    },
    folders: ['/notes/empty'],
    folderDialog: ROOT,
    ...extra,
  });
}

async function opened(extra: MockSeed = {}) {
  const platform = folderPlatform(extra);
  await platform.folderDialog('open');
  return platform;
}

describe('mock platform: folders', () => {
  it('lists one level: folders first, hidden and ignored names and other types left out', async () => {
    const platform = await opened();

    const listing = await platform.listFolder(ROOT);

    expect(listing.truncated).toBe(false);
    expect(listing.entries.map((e) => [e.name, e.kind])).toEqual([
      ['empty', 'folder'],
      ['sub', 'folder'],
      ['A.md', 'file'],
      ['b.md', 'file'],
      ['readme.txt', 'file'],
    ]);
    expect(listing.entries.find((e) => e.name === 'b.md')).toMatchObject({
      path: '/notes/b.md',
      bytes: 1,
    });
  });

  it('refuses a folder that was not granted and one that does not exist', async () => {
    const platform = folderPlatform();

    await expect(platform.listFolder(ROOT)).rejects.toMatchObject({ code: 'not-allowed' });
    await platform.folderDialog('open');
    await expect(platform.listFolder('/outside')).rejects.toMatchObject({ code: 'not-allowed' });
    await expect(platform.listFolder('/notes/nope')).rejects.toMatchObject({ code: 'not-found' });
    await expect(platform.listFolder('/notes/../outside')).rejects.toMatchObject({
      code: 'not-allowed',
    });
  });

  it('grants reading of everything below the folder', async () => {
    const platform = await opened();

    expect((await platform.readDocument('/notes/sub/deep/d.Rmd')).text).toBe('d');
    await expect(platform.readDocument('/outside/o.md')).rejects.toMatchObject({
      code: 'not-allowed',
    });
  });

  it('indexes Markdown files at every depth in path order, skipping hidden and ignored names', async () => {
    const platform = await opened();

    expect((await platform.fileIndex(ROOT)).paths).toEqual([
      '/notes/A.md',
      '/notes/b.md',
      '/notes/readme.txt',
      '/notes/sub/c.qmd',
      '/notes/sub/deep/d.Rmd',
    ]);
  });

  it('records the folder dialogs and the folder as granted', async () => {
    const platform = folderPlatform();

    expect(await platform.folderDialog('move')).toBe(ROOT);

    const control = window.__BACKTICKLE_MOCK__;
    expect(control?.grantedFolders).toEqual([ROOT]);
    expect(control?.folderDialogs).toEqual(['move']);
  });
});

describe('mock platform: file operations', () => {
  it('creates files and folders and refuses existing and bad names', async () => {
    const platform = await opened();

    expect(await platform.createFile(ROOT, 'Untitled.md')).toBe('/notes/Untitled.md');
    expect(await platform.createFolder(ROOT, 'Chapters')).toBe('/notes/Chapters');
    await expect(platform.createFile(ROOT, 'Untitled.md')).rejects.toMatchObject({
      code: 'exists',
    });
    await expect(platform.createFolder(ROOT, 'sub')).rejects.toMatchObject({ code: 'exists' });
    for (const bad of ['', 'a/b', 'a:b', '.x']) {
      await expect(platform.createFile(ROOT, bad)).rejects.toMatchObject({
        code: 'invalid-name',
      });
    }
    await expect(platform.createFile('/outside', 'x.md')).rejects.toMatchObject({
      code: 'not-allowed',
    });
    const names = (await platform.listFolder(ROOT)).entries.map((e) => e.name);
    expect(names).toContain('Chapters');
    expect(names).toContain('Untitled.md');
  });

  it('renames a file and moves recents, document state and grants with it', async () => {
    const platform = await opened({ recents: ['/notes/b.md'] });
    await platform.setDocState('/notes/b.md', { flavor: 'mdx', scrollLine: 4 });

    const renamed = await platform.renamePath('/notes/b.md', 'beta.md');

    expect(renamed).toBe('/notes/beta.md');
    expect((await platform.recentDocuments()).map((r) => r.path)).toEqual(['/notes/beta.md']);
    expect(await platform.getDocState('/notes/beta.md')).toMatchObject({
      flavor: 'mdx',
      scrollLine: 4,
    });
    await expect(platform.readDocument('/notes/b.md')).rejects.toMatchObject({
      code: 'not-found',
    });
    await expect(platform.renamePath('/notes/beta.md', 'A.md')).rejects.toMatchObject({
      code: 'exists',
    });
    await expect(platform.renamePath('/notes/beta.md', 'x/y.md')).rejects.toMatchObject({
      code: 'invalid-name',
    });
  });

  it('renaming a folder renames everything below it', async () => {
    const platform = await opened();

    await platform.renamePath('/notes/sub', 'parts');

    expect((await platform.fileIndex(ROOT)).paths).toContain('/notes/parts/deep/d.Rmd');
    expect((await platform.fileIndex(ROOT)).paths).not.toContain('/notes/sub/c.qmd');
  });

  it('moves into a granted folder and refuses an existing name or an outside folder', async () => {
    const platform = await opened();

    expect(await platform.movePath('/notes/b.md', '/notes/sub')).toBe('/notes/sub/b.md');
    await expect(platform.movePath('/notes/A.md', '/outside')).rejects.toMatchObject({
      code: 'not-allowed',
    });
    await platform.createFile('/notes/sub', 'A.md');
    await expect(platform.movePath('/notes/A.md', '/notes/sub')).rejects.toMatchObject({
      code: 'exists',
    });
    await expect(platform.movePath('/notes/sub', '/notes/sub/deep')).rejects.toMatchObject({
      code: 'io',
    });
  });

  it('duplicates with the first free copy name', async () => {
    const platform = await opened();

    expect(await platform.duplicatePath('/notes/b.md')).toBe('/notes/b copy.md');
    expect(await platform.duplicatePath('/notes/b.md')).toBe('/notes/b copy 2.md');
    expect(await platform.duplicatePath('/notes/b copy.md')).toBe('/notes/b copy 3.md');
    expect((await platform.readDocument('/notes/b copy.md')).text).toBe('B');
    await expect(platform.duplicatePath('/notes/sub')).rejects.toMatchObject({ code: 'io' });
  });

  it('moves to the Trash without deleting anything else and refuses the open folder', async () => {
    const platform = await opened();

    await platform.trashPath('/notes/b.md');

    const control = window.__BACKTICKLE_MOCK__;
    expect(control?.trashed).toEqual(['/notes/b.md']);
    expect(control?.tree().files).not.toContain('/notes/b.md');
    expect(control?.tree().files).toContain('/notes/A.md');
    await expect(platform.trashPath(ROOT)).rejects.toMatchObject({ code: 'io' });
    await expect(platform.trashPath('/outside/o.md')).rejects.toMatchObject({
      code: 'not-allowed',
    });
  });

  it('names follow the Rust rules', () => {
    expect(cleanName('  a.md ')).toBe('a.md');
    expect(cleanName('..')).toBeNull();
    expect(cleanName('a'.repeat(256))).toBeNull();
    expect(copyName('a.md', 1)).toBe('a copy.md');
    expect(copyName('a copy 3.md', 1)).toBe('a copy.md');
    expect(copyName('a.b.md', 2)).toBe('a.b copy 2.md');
    expect(copyName('a', 1)).toBe('a copy');
  });
});

describe('mock platform: clipboard, export, session, state', () => {
  it('keeps the clipboard and records writes', async () => {
    const platform = createMockPlatform({ clipboard: 'seed' });

    expect(await platform.readClipboardText()).toBe('seed');
    await platform.writeClipboard({ text: 'a', html: '<p>a</p>' });
    await platform.writeClipboard({ text: 'b' });

    expect(await platform.readClipboardText()).toBe('b');
    expect(window.__BACKTICKLE_MOCK__?.clipboardWrites).toEqual([
      { text: 'a', html: '<p>a</p>' },
      { text: 'b', html: null },
    ]);
  });

  it('writes an export only to the path the save dialog returned for it, once', async () => {
    const platform = createMockPlatform({ saveDialog: '/out/doc' });

    const path = await platform.saveDialog({
      suggestedName: 'doc.html',
      directory: null,
      kind: 'html',
    });

    expect(path).toBe('/out/doc.html');
    await expect(platform.writeExport('/elsewhere.html', 'x')).rejects.toMatchObject({
      code: 'not-allowed',
    });
    await platform.writeExport('/out/doc.html', '<html></html>');
    await expect(platform.writeExport('/out/doc.html', 'again')).rejects.toBeTruthy();
    expect(window.__BACKTICKLE_MOCK__?.exports).toEqual([
      { path: '/out/doc.html', contents: '<html></html>' },
    ]);
    expect(window.__BACKTICKLE_MOCK__?.granted).not.toContain('/out/doc.html');
  });

  it('runs a scripted Word export, with an error or held until finished', async () => {
    const failing = createMockPlatform({ saveDialog: '/o.docx', exportDocx: { error: 'boom' } });
    expect(await failing.pandocInfo()).toBeNull();
    await failing.saveDialog({ suggestedName: 'o.docx', directory: null, kind: 'docx' });
    const request = {
      docPath: null,
      outPath: '/o.docx',
      input: '# T',
      from: 'gfm',
      citeproc: false,
    };
    await expect(failing.exportDocx(request)).rejects.toMatchObject({ message: 'boom' });

    const held = createMockPlatform({
      saveDialog: '/o.docx',
      exportDocx: { hold: true },
      pandoc: { path: '/p/pandoc', version: '3.8.3' },
    });
    expect(await held.pandocInfo()).toEqual({ path: '/p/pandoc', version: '3.8.3' });
    await held.saveDialog({ suggestedName: 'o.docx', directory: null, kind: 'docx' });
    let done = false;
    const pending = held.exportDocx(request).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    window.__BACKTICKLE_MOCK__?.finishDocx();
    await pending;
    expect(done).toBe(true);
    expect(window.__BACKTICKLE_MOCK__?.docxRequests).toEqual([request]);
  });

  it('scripts search results and cancels a held search', async () => {
    const platform = createMockPlatform({
      searchResults: {
        word: {
          files: [{ path: '/a.md', matches: [{ line: 2, text: 'a word', ranges: [[2, 6]] }] }],
        },
      },
      searchHold: true,
    });
    const request = {
      id: 1,
      folder: '/',
      query: 'word',
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    };

    const first = platform.searchFolder(request);
    window.__BACKTICKLE_MOCK__?.finishSearch(1);
    expect(await first).toMatchObject({ id: 1, matchCount: 1, fileCount: 1, cancelled: false });

    const second = platform.searchFolder({ ...request, id: 2 });
    await platform.cancelSearch(2);
    expect(await second).toMatchObject({ id: 2, cancelled: true, matchCount: 0 });
    expect(window.__BACKTICKLE_MOCK__?.cancelledSearches).toEqual([2]);
  });

  it('delivers scripted file changes and records the watch set', async () => {
    const platform = createMockPlatform({});
    const batches: unknown[] = [];
    const stop = await platform.onFileChanged((changes) => batches.push(changes));
    await platform.watch({ documents: ['/a.md'], linked: [], folder: '/n' });

    window.__BACKTICKLE_MOCK__?.fileChanged([
      { path: '/a.md', kind: 'modified', scope: 'document' },
    ]);
    stop();
    window.__BACKTICKLE_MOCK__?.fileChanged([{ path: '/b.md', kind: 'removed', scope: 'folder' }]);

    expect(batches).toEqual([[{ path: '/a.md', kind: 'modified', scope: 'document' }]]);
    expect(window.__BACKTICKLE_MOCK__?.watches).toEqual([
      { documents: ['/a.md'], linked: [], folder: '/n' },
    ]);
  });

  it('stores the session and counts prints', async () => {
    const platform = createMockPlatform({});
    expect(await platform.getSession()).toBeNull();
    const session = {
      tabs: [{ path: '/a.md', view: 'split' as const }],
      active: 0,
      folder: '/n',
      sidebarTab: 'files' as const,
    };

    await platform.setSession(session);
    await platform.printPage();

    expect(await platform.getSession()).toEqual(session);
    expect(window.__BACKTICKLE_MOCK__?.prints).toBe(1);
  });

  it('keeps cursor and scroll in the document state and validates them', async () => {
    const platform = createMockPlatform({ files: { '/a.md': 'x' }, dialog: '/a.md' });
    await platform.openFileDialog();

    await platform.setDocState('/a.md', { cursor: { line: 3, column: 0 }, scrollLine: 2 });
    await platform.setDocState('/a.md', { cursor: { line: 0, column: 0 }, scrollLine: 0 });

    expect(await platform.getDocState('/a.md')).toEqual({
      flavor: null,
      cursor: { line: 3, column: 0 },
      scrollLine: 2,
    });
    await platform.setDocState('/a.md', { cursor: null, scrollLine: null });
    expect(await platform.getDocState('/a.md')).toEqual({
      flavor: null,
      cursor: null,
      scrollLine: null,
    });
  });

  it('launch options carry the folder and skip the restore like the Rust side', async () => {
    const plain = await createMockPlatform({}).launchOptions();
    expect(plain).toMatchObject({ folderPath: null, restoreSession: true });
    const withFolder = createMockPlatform({ launch: { folderPath: '/notes' } });
    expect((await withFolder.launchOptions()).restoreSession).toBe(false);
    expect(window.__BACKTICKLE_MOCK__?.grantedFolders).toEqual(['/notes']);
    for (const launch of [{ openPath: '/a.md' }, { welcome: true }]) {
      expect((await createMockPlatform({ launch }).launchOptions()).restoreSession).toBe(false);
    }
  });

  it('settings gain the Phase 3 defaults and validate them', async () => {
    const platform = createMockPlatform({});
    const defaults = await platform.getSettings();
    expect(defaults.restoreSession).toBe(true);
    expect(defaults.files.ignore).toEqual([
      'node_modules',
      '_site',
      '_freeze',
      'renv',
      'venv',
      '__pycache__',
    ]);
    expect(defaults.export.pandocPath).toBeNull();

    const updated = await platform.updateSettings({
      restoreSession: false,
      files: { ignore: ['a', ' b ', 'a', 'c/d', 5 as unknown as string] },
      export: { pandocPath: '/usr/local/bin/pandoc' },
    });
    expect(updated.restoreSession).toBe(false);
    expect(updated.files.ignore).toEqual(['a', 'b']);
    expect(updated.export.pandocPath).toBe('/usr/local/bin/pandoc');
    const bad = await platform.updateSettings({ export: { pandocPath: '/bin/sh' } });
    expect(bad.export.pandocPath).toBe('/usr/local/bin/pandoc');
    expect(
      (await platform.updateSettings({ export: { pandocPath: null } })).export.pandocPath,
    ).toBeNull();
  });
});
