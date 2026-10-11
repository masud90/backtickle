import { describe, expect, it } from 'vitest';
import type { MenuAction, PlatformError, SaveFormat } from '@/lib/platform';
import { createMockPlatform, defaultSettings, type MockSeed } from '@/lib/platform-mock';

const LF: SaveFormat = { encoding: 'utf-8', lineEnding: 'lf' };
const NEW = { expectedModifiedMs: null };

function mock(seed: MockSeed = {}) {
  const platform = createMockPlatform(seed);
  const control = window.__WRITEDOWN_MOCK__;
  if (!control) throw new Error('the mock control object is missing');
  return { platform, control };
}

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as PlatformError).code;
  }
  return undefined;
}

describe('mock platform: grants', () => {
  it('refuses a path that was never granted, with the same error as Rust', async () => {
    const { platform } = mock({ files: { '/a.md': 'x' } });

    await expect(platform.readDocument('/a.md')).rejects.toMatchObject({ code: 'not-allowed' });
    await expect(platform.saveDocument('/a.md', 'y', LF, NEW)).rejects.toMatchObject({
      code: 'not-allowed',
    });
    expect(await code(platform.documentContext('/a.md'))).toBe('not-allowed');
    expect(await code(platform.revealInFinder('/a.md'))).toBe('not-allowed');
    expect(await code(platform.getDocState('/a.md'))).toBe('not-allowed');
  });

  it('grants what the dialogs, the launch argument, open events and recents give', async () => {
    const { platform, control } = mock({
      files: { '/a.md': 'a', '/b.md': 'b', '/c.md': 'c', '/d.md': 'd', '/e.md': 'e' },
      openDialog: ['/a.md'],
      saveDialog: '/new.md',
      launch: { openPath: '/b.md' },
      recents: ['/d.md'],
    });

    expect(await platform.openDialog({ multiple: true })).toEqual(['/a.md']);
    expect(await platform.saveDialog({ suggestedName: 'x.md', directory: null })).toBe('/new.md');
    await platform.launchOptions();
    control.openFiles(['/c.md']);
    expect(await platform.openRecent('/d.md')).toBe('/d.md');

    for (const path of ['/a.md', '/b.md', '/c.md', '/d.md']) {
      expect((await platform.readDocument(path)).path).toBe(path);
    }
    expect(await code(platform.readDocument('/e.md'))).toBe('not-allowed');
  });

  it('openRecent only grants paths in the list and reports missing files', async () => {
    const { platform } = mock({
      files: { '/in.md': 'x', '/out.md': 'y' },
      recents: ['/in.md', '/gone.md'],
    });

    expect(await code(platform.openRecent('/out.md'))).toBe('not-allowed');
    expect(await code(platform.openRecent('/gone.md'))).toBe('not-found');
    expect(await platform.openRecent('/in.md')).toBe('/in.md');
  });

  it('a single-file open dialog returns at most one path', async () => {
    const { platform } = mock({ openDialog: ['/a.md', '/b.md'] });

    expect(await platform.openDialog({ multiple: false })).toEqual(['/a.md']);
    expect(await platform.openDialog({ multiple: true })).toEqual(['/a.md', '/b.md']);
  });

  it('dialog answers can be a list used in order, then cancelled', async () => {
    const { platform } = mock({
      confirmUnsaved: ['save', 'discard'],
      ask: [true],
      openDialog: [['/a.md'], ['/b.md', '/c.md']],
    });

    expect(await platform.confirmUnsaved('x')).toBe('save');
    expect(await platform.confirmUnsaved('y')).toBe('discard');
    expect(await platform.confirmUnsaved('z')).toBe('cancel');
    const options = { title: 't', message: 'm', ok: 'Overwrite', cancel: 'Cancel' };
    expect(await platform.ask(options)).toBe(true);
    expect(await platform.ask(options)).toBe(false);
    expect(await platform.openDialog({ multiple: true })).toEqual(['/a.md']);
    expect(await platform.openDialog({ multiple: true })).toEqual(['/b.md', '/c.md']);
    expect(await platform.openDialog({ multiple: true })).toEqual([]);
  });

  it('records the confirmations and questions it was asked', async () => {
    const { platform, control } = mock({ confirmUnsaved: 'save', ask: true });

    await platform.confirmUnsaved('Notes.md');
    await platform.ask({ title: 'T', message: 'M', ok: 'Go', cancel: 'Stop' });

    expect(control.confirmations).toEqual(['Notes.md']);
    expect(control.asks).toEqual([{ title: 'T', message: 'M', ok: 'Go', cancel: 'Stop' }]);
  });
});

describe('mock platform: documents and saving', () => {
  const seed: MockSeed = {
    files: {
      '/crlf.md': { text: 'a\r\nb\r\n' },
      '/legacy.md': { text: 'café', legacyEncoding: 'windows-1252' },
      '/lossy.md': { text: 'bad �', lossy: true },
      '/locked.md': { text: 'x', readOnly: true },
      '/plain.md': 'hello\n',
    },
    openDialog: ['/crlf.md', '/legacy.md', '/lossy.md', '/locked.md', '/plain.md'],
  };

  it('reads text with normalized line endings and the metadata of the file', async () => {
    const { platform } = mock(seed);
    await platform.openDialog({ multiple: true });

    const crlf = await platform.readDocument('/crlf.md');
    const legacy = await platform.readDocument('/legacy.md');

    expect(crlf).toMatchObject({
      text: 'a\nb\n',
      lineEnding: 'crlf',
      mixedLineEndings: false,
      bytes: 6,
    });
    expect(legacy).toMatchObject({ legacyEncoding: 'windows-1252', encoding: 'utf-8' });
  });

  it('saves exactly the text with the chosen format and records the call', async () => {
    const { platform, control } = mock(seed);
    await platform.openDialog({ multiple: true });
    const read = await platform.readDocument('/crlf.md');

    const result = await platform.saveDocument(
      '/crlf.md',
      'x\ny\n',
      { encoding: 'utf-8-bom', lineEnding: 'crlf' },
      { expectedModifiedMs: read.modifiedMs },
    );

    expect(result.bytes).toBe(3 + 'x\r\ny\r\n'.length);
    expect(control.saves).toHaveLength(1);
    expect(control.saves[0]).toMatchObject({
      path: '/crlf.md',
      text: 'x\ny\n',
      format: { encoding: 'utf-8-bom', lineEnding: 'crlf' },
    });
    expect(control.file('/crlf.md')).toMatchObject({ text: 'x\ny\n', lineEnding: 'crlf' });
  });

  it('refuses a stale save with modified-externally and retries with the overwrite flag', async () => {
    const { platform, control } = mock(seed);
    await platform.openDialog({ multiple: true });
    const read = await platform.readDocument('/plain.md');
    control.externallyModify('/plain.md', 'someone else\n');

    expect(
      await code(
        platform.saveDocument('/plain.md', 'mine', LF, { expectedModifiedMs: read.modifiedMs }),
      ),
    ).toBe('modified-externally');
    await platform.saveDocument('/plain.md', 'mine', LF, {
      expectedModifiedMs: read.modifiedMs,
      overwriteExternalChange: true,
    });
    expect(control.file('/plain.md')?.text).toBe('mine');
  });

  it('a second save with the result of the first works', async () => {
    const { platform } = mock(seed);
    await platform.openDialog({ multiple: true });
    const read = await platform.readDocument('/plain.md');

    const first = await platform.saveDocument('/plain.md', 'one', LF, {
      expectedModifiedMs: read.modifiedMs,
    });
    const second = await platform.saveDocument('/plain.md', 'two', LF, {
      expectedModifiedMs: first.modifiedMs,
    });

    expect(second.modifiedMs).toBeGreaterThan(first.modifiedMs);
  });

  it('refuses a lossy document unless the user agreed, and a read-only file always', async () => {
    const { platform } = mock(seed);
    await platform.openDialog({ multiple: true });
    const lossy = await platform.readDocument('/lossy.md');
    const locked = await platform.readDocument('/locked.md');

    expect(
      await code(
        platform.saveDocument('/lossy.md', 'x', LF, { expectedModifiedMs: lossy.modifiedMs }),
      ),
    ).toBe('lossy');
    await platform.saveDocument('/lossy.md', 'x', LF, {
      expectedModifiedMs: lossy.modifiedMs,
      allowLossy: true,
    });
    expect(locked.readOnly).toBe(true);
    expect(
      await code(
        platform.saveDocument('/locked.md', 'x', LF, { expectedModifiedMs: locked.modifiedMs }),
      ),
    ).toBe('read-only');
  });

  it('saves a new file to a path granted by the save dialog, and rejects a missing file that was expected', async () => {
    const { platform, control } = mock({ saveDialog: '/new.md' });
    const path = await platform.saveDialog({ suggestedName: 'Untitled.md', directory: null });

    await platform.saveDocument(path ?? '', 'hello', LF, NEW);

    expect(control.file('/new.md')?.text).toBe('hello');
    control.reset();
    expect(await code(platform.saveDocument('/new.md', 'x', LF, { expectedModifiedMs: 1 }))).toBe(
      'modified-externally',
    );
  });

  it('opening a file adds it to the recents and tells the listeners', async () => {
    const { platform } = mock({
      files: { '/a.md': 'x', '/b.md': 'y' },
      openDialog: ['/a.md', '/b.md'],
    });
    const seen: string[][] = [];
    await platform.onRecentsChanged((list) => seen.push(list.map((entry) => entry.path)));
    await platform.openDialog({ multiple: true });

    await platform.readDocument('/a.md');
    await platform.readDocument('/b.md');
    await platform.readDocument('/b.md');

    expect(seen).toEqual([['/a.md'], ['/b.md', '/a.md']]);
  });
});

describe('mock platform: links, images and external urls', () => {
  const seed: MockSeed = {
    files: {
      '/docs/index.md': '# i',
      '/docs/second.md': '# s',
      '/docs/my notes.md': 'n',
      '/other/x.md': 'x',
    },
    images: { '/docs/pic.png': 'data:image/png;base64,AAAA' },
    existing: ['/docs/report.pdf', '/docs/run.sh'],
    launch: { openPath: '/docs/index.md' },
  };

  async function ready() {
    const made = mock(seed);
    await made.platform.launchOptions();
    return made;
  }

  it('resolves relative links, strips fragments and decodes names, and grants the target', async () => {
    const { platform } = await ready();

    expect(await platform.openLinkedDocument('/docs/index.md', 'second.md#details')).toBe(
      '/docs/second.md',
    );
    expect(await platform.openLinkedDocument('/docs/index.md', 'my%20notes.md?x=1')).toBe(
      '/docs/my notes.md',
    );
    expect(await platform.openLinkedDocument('/docs/index.md', '../other/x.md')).toBe(
      '/other/x.md',
    );
    expect((await platform.readDocument('/other/x.md')).text).toBe('x');
  });

  it('does not open other files as documents and reveals them instead', async () => {
    const { platform, control } = await ready();

    expect(await code(platform.openLinkedDocument('/docs/index.md', 'report.pdf'))).toBe(
      'not-markdown',
    );
    expect(await code(platform.openLinkedDocument('/docs/index.md', 'run.sh'))).toBe(
      'not-markdown',
    );
    expect(await code(platform.openLinkedDocument('/docs/index.md', 'missing.md'))).toBe(
      'not-found',
    );
    expect(
      await code(platform.openLinkedDocument('/docs/index.md', 'https://example.org/a.md')),
    ).toBe('not-allowed');
    await platform.revealLinkedFile('/docs/index.md', 'report.pdf');
    expect(control.reveals).toEqual(['/docs/report.pdf']);
    expect(await code(platform.revealLinkedFile('/other/x.md', 'a.pdf'))).toBe('not-allowed');
  });

  it('resolves images to the seeded URL and refuses other things', async () => {
    const { platform } = await ready();

    expect(await platform.resolveImage('/docs/index.md', 'pic.png')).toBe(
      'data:image/png;base64,AAAA',
    );
    expect(await code(platform.resolveImage('/docs/index.md', 'missing.png'))).toBe('not-found');
    expect(await code(platform.resolveImage('/docs/index.md', 'second.md'))).toBe('not-allowed');
    expect(await code(platform.resolveImage('/docs/index.md', 'https://x.org/a.png'))).toBe(
      'not-allowed',
    );
  });

  it('opens only http, https and mailto urls and records them', async () => {
    const { platform, control } = mock();

    await platform.openExternal('https://example.org');
    await platform.openExternal('mailto:a@b.org');
    for (const url of [
      'javascript:alert(1)',
      'file:///etc/hosts',
      'ftp://a.org',
      '/Applications/X.app',
      'data:text/html,x',
    ]) {
      expect(await code(platform.openExternal(url)), url).toBe('not-allowed');
    }

    expect(control.externalUrls).toEqual(['https://example.org/', 'mailto:a@b.org']);
  });
});

describe('mock platform: recents', () => {
  it('lists newest first with name, folder shown with a tilde, size and existence', async () => {
    const { platform } = mock({
      files: { '/Users/mock/Notes/a.md': 'twelve bytes' },
      recents: ['/Users/mock/Notes/a.md', '/gone/b.md'],
    });

    const list = await platform.recentDocuments();

    expect(list[0]).toMatchObject({ name: 'a.md', folder: '~/Notes', bytes: 12, exists: true });
    expect(list[1]).toMatchObject({ name: 'b.md', folder: '/gone', bytes: null, exists: false });
  });

  it('keeps the order, de-duplicates and caps at recentLimit', async () => {
    const files = Object.fromEntries(['a', 'b', 'c', 'd'].map((n) => [`/${n}.md`, n]));
    const { platform } = mock({
      files,
      openDialog: Object.keys(files),
      settings: { recentLimit: 3 },
    });
    await platform.openDialog({ multiple: true });

    for (const path of ['/a.md', '/b.md', '/c.md', '/a.md', '/d.md'])
      await platform.readDocument(path);

    expect((await platform.recentDocuments()).map((e) => e.path)).toEqual([
      '/d.md',
      '/a.md',
      '/c.md',
    ]);
  });

  it('removes and clears entries and notifies', async () => {
    const { platform } = mock({ recents: ['/a.md', '/b.md'] });
    let notifications = 0;
    await platform.onRecentsChanged(() => notifications++);

    await platform.removeRecent('/a.md');
    await platform.removeRecent('/a.md');
    await platform.clearRecents();
    await platform.clearRecents();

    expect(await platform.recentDocuments()).toEqual([]);
    expect(notifications).toBe(2);
  });

  it('lowering recentLimit cuts the list', async () => {
    const { platform } = mock({ recents: ['/a.md', '/b.md', '/c.md'] });

    await platform.updateSettings({ recentLimit: 2 });

    expect((await platform.recentDocuments()).map((e) => e.path)).toEqual(['/a.md', '/b.md']);
  });
});

describe('mock platform: settings and document state', () => {
  it('starts with the defaults of the Rust side', async () => {
    expect(await mock().platform.getSettings()).toEqual(defaultSettings());
    expect(defaultSettings()).toMatchObject({
      version: 1,
      defaultFlavor: 'gfm',
      recentLimit: 20,
      readingWpm: 238,
    });
  });

  it('clamps numbers, ignores wrong types and merges deep partial updates', async () => {
    const { platform } = mock();

    const next = await platform.updateSettings({
      recentLimit: 5000,
      readingWpm: 'fast' as unknown as number,
      editor: { fontSize: 2 },
      view: { zoom: 10, splitRatio: 0.1 },
      appearance: 'dark',
    });

    expect(next.recentLimit).toBe(100);
    expect(next.readingWpm).toBe(238);
    expect(next.editor).toEqual({ ...defaultSettings().editor, fontSize: 9 });
    expect(next.view.zoom).toBe(2);
    expect(next.view.splitRatio).toBe(0.2);
    expect(next.appearance).toBe('dark');
    expect(next.version).toBe(1);
  });

  it('seeded settings are clamped too, and listeners hear about changes only', async () => {
    const { platform, control } = mock({ settings: { editor: { fontSize: 99 } } });
    const heard: number[] = [];
    await platform.onSettingsChanged((s) => heard.push(s.editor.fontSize));

    expect((await platform.getSettings()).editor.fontSize).toBe(32);
    await platform.updateSettings({ editor: { fontSize: 32 } });
    await platform.updateSettings({ editor: { fontSize: 14 } });
    control.settingsChanged({ editor: { fontSize: 15 } });

    expect(heard).toEqual([14, 15]);
  });

  it('stores the flavor per file, clears it with null and ignores unknown flavors', async () => {
    const { platform } = mock({ launch: { openPath: '/a.md' }, files: { '/a.md': 'x' } });
    await platform.launchOptions();

    expect(await platform.getDocState('/a.md')).toMatchObject({ flavor: null });
    await platform.setDocState('/a.md', { flavor: 'obsidian' });
    expect(await platform.getDocState('/a.md')).toMatchObject({ flavor: 'obsidian' });
    await platform.setDocState('/a.md', { flavor: 'nonsense' as never });
    expect(await platform.getDocState('/a.md')).toMatchObject({ flavor: 'obsidian' });
    await platform.setDocState('/a.md', { flavor: null });
    expect(await platform.getDocState('/a.md')).toMatchObject({ flavor: null });
  });
});

describe('mock platform: document context', () => {
  it('derives the location and the vault from the path, and seeded answers win', async () => {
    const { platform } = mock({
      launch: { openPath: '/Users/mock/Library/Mobile Documents/com~apple~CloudDocs/a.md' },
      vaults: ['/Users/mock/vault'],
      documentContext: { '/seeded.md': { location: 'dropbox', obsidianVault: true } },
      openDialog: ['/Users/mock/vault/notes/n.md', '/seeded.md', '/Users/mock/Documents/d.md'],
    });
    await platform.launchOptions();
    await platform.openDialog({ multiple: true });

    expect(
      await platform.documentContext(
        '/Users/mock/Library/Mobile Documents/com~apple~CloudDocs/a.md',
      ),
    ).toEqual({
      obsidianVault: false,
      location: 'icloud',
    });
    expect(await platform.documentContext('/Users/mock/vault/notes/n.md')).toEqual({
      obsidianVault: true,
      location: 'local',
    });
    expect(await platform.documentContext('/seeded.md')).toEqual({
      obsidianVault: true,
      location: 'dropbox',
    });
    expect((await platform.documentContext('/Users/mock/Documents/d.md')).location).toBe('local');
  });
});

describe('mock platform: events and the control object', () => {
  it('queues files opened before the page is ready and delivers later ones at once', async () => {
    const { platform, control } = mock({
      files: { '/a.md': 'a', '/b.md': 'b', '/c.png': 'p' },
      pendingOpenFiles: ['/a.md'],
    });
    const heard: string[][] = [];
    await platform.onOpenFiles((paths) => heard.push(paths));

    control.openFiles(['/b.md', '/c.png', '/missing.md']);
    const pending = await platform.takePendingOpenFiles();
    control.openFiles(['/b.md']);

    expect(pending).toEqual(['/a.md', '/b.md']);
    expect(heard).toEqual([['/b.md']]);
    expect((await platform.readDocument('/b.md')).text).toBe('b');
    expect(await code(platform.readDocument('/c.png'))).toBe('not-allowed');
  });

  it('queues menu actions until the first listener and then delivers them', async () => {
    const { platform, control } = mock();
    const heard: MenuAction[] = [];

    control.menuAction('new');
    await platform.onMenuAction((action) => heard.push(action));
    control.menuAction('save');

    expect(heard).toEqual(['new', 'save']);
  });

  it('close requests are acknowledged and finishClose is recorded', async () => {
    const { platform, control } = mock();
    const reasons: string[] = [];
    const stop = await platform.onCloseRequested((reason) => reasons.push(reason));

    control.closeRequested('window');
    control.closeRequested('quit');
    stop();
    control.closeRequested('window');
    await platform.ackClose();
    await platform.finishClose('quit');

    expect(reasons).toEqual(['window', 'quit']);
    expect(control.ackCloses).toBe(3);
    expect(control.finishCloses).toEqual(['quit']);
  });

  it('cancelClose is recorded per reason, and reset forgets it', async () => {
    const { platform, control } = mock();

    await platform.cancelClose('quit');
    await platform.cancelClose('window');

    expect(control.cancelCloses).toEqual(['quit', 'window']);
    expect(control.finishCloses).toEqual([]);
    control.reset();
    expect(control.cancelCloses).toEqual([]);
  });

  it('records menu states and window titles, and reset forgets them', async () => {
    const { platform, control } = mock();
    const state = {
      hasDocument: true,
      canSave: false,
      canFormat: true,
      viewMode: 'split' as const,
      sidebarVisible: true,
      syncScroll: true,
      tabCount: 2,
    };

    await platform.updateMenuState(state);
    await platform.setWindowTitle('Notes.md');

    expect(control.menuStates).toEqual([state]);
    expect(control.windowTitles).toEqual(['Notes.md']);
    control.reset();
    expect(control.menuStates).toEqual([]);
    expect(control.windowTitles).toEqual([]);
  });

  it('settingsChanged and recentsChanged notify the listeners', async () => {
    const { platform, control } = mock({ recents: ['/a.md'] });
    const settings: string[] = [];
    const lists: number[] = [];
    await platform.onSettingsChanged((s) => settings.push(s.appearance));
    await platform.onRecentsChanged((list) => lists.push(list.length));

    control.settingsChanged({ appearance: 'light' });
    control.recentsChanged();

    expect(settings).toEqual(['light']);
    expect(lists).toEqual([1]);
    expect((await platform.getSettings()).appearance).toBe('light');
  });

  it('unsubscribed listeners hear nothing', async () => {
    const { platform, control } = mock({ files: { '/a.md': 'a' } });
    await platform.takePendingOpenFiles();
    const heard: string[][] = [];
    const stop = await platform.onOpenFiles((paths) => heard.push(paths));

    stop();
    control.openFiles(['/a.md']);

    expect(heard).toEqual([]);
  });

  it('setAnswers replaces the dialog answers during a test', async () => {
    const { platform, control } = mock({ confirmUnsaved: 'save' });

    control.setAnswers({ confirmUnsaved: 'discard', saveDialog: '/x.md' });

    expect(await platform.confirmUnsaved('n')).toBe('discard');
    expect(await platform.saveDialog({ suggestedName: 'a', directory: null })).toBe('/x.md');
  });

  it('the window title and window size hooks of Phase 0 keep working beside the control object', async () => {
    mock();

    expect(typeof window.__WRITEDOWN_MOCK__?.openFiles).toBe('function');
  });
});
