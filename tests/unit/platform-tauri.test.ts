import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
const listeners = new Map<string, (event: { payload: unknown }) => void>();
const listen = vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
  listeners.set(name, handler);
  return () => listeners.delete(name);
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: Parameters<typeof listen>) => listen(...args),
}));

async function platform() {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
  const { getPlatform } = await import('@/lib/platform');
  return getPlatform();
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  listeners.clear();
});

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  vi.resetModules();
});

describe('the Tauri platform: commands', () => {
  it('calls each Phase 1 command with the argument names Rust expects', async () => {
    const p = await platform();
    const format = { encoding: 'utf-8', lineEnding: 'lf' } as const;
    const options = { expectedModifiedMs: null };

    await p.openDialog({ multiple: true });
    await p.saveDialog({ suggestedName: 'a.md', directory: '/x' });
    await p.confirmUnsaved('Notes');
    await p.ask({ title: 't', message: 'm', ok: 'o', cancel: 'c' });
    await p.readDocument('/a.md');
    await p.saveDocument('/a.md', 'text', format, options);
    await p.documentContext('/a.md');
    await p.revealInFinder('/a.md');
    await p.openExternal('https://example.org');
    await p.openLinkedDocument('/a.md', 'b.md');
    await p.revealLinkedFile('/a.md', 'c.pdf');
    await p.resolveImage('/a.md', 'p.png');
    await p.readImageBytes('/a.md', 'p.png', 100);
    await p.readLinkedText('/a.md', 'r.bib', 'bibliography');
    await p.vaultIndex('/a.md');
    await p.quartoProject('/a.md');
    await p.recentDocuments();
    await p.openRecent('/a.md');
    await p.removeRecent('/a.md');
    await p.clearRecents();
    await p.getSettings();
    await p.updateSettings({ appearance: 'dark' });
    await p.getDocState('/a.md');
    await p.setDocState('/a.md', { flavor: 'gfm' });
    await p.takePendingOpenFiles();
    await p.setWindowTitle('Title');
    await p.openPreferences();
    await p.finishClose('quit');
    await p.cancelClose('window');
    await p.ackClose();
    const menuState = {
      hasDocument: true,
      canSave: true,
      canFormat: true,
      viewMode: 'split',
      sidebarVisible: true,
      syncScroll: true,
      tabCount: 1,
    } as const;
    await p.updateMenuState(menuState);

    expect(invoke.mock.calls).toEqual([
      ['open_dialog', { multiple: true }],
      ['save_dialog', { suggestedName: 'a.md', directory: '/x' }],
      ['confirm_unsaved', { name: 'Notes' }],
      ['ask', { title: 't', message: 'm', ok: 'o', cancel: 'c' }],
      ['read_document', { path: '/a.md' }],
      ['save_document', { path: '/a.md', text: 'text', format, options }],
      ['document_context', { path: '/a.md' }],
      ['reveal_in_finder', { path: '/a.md' }],
      ['open_external', { url: 'https://example.org' }],
      ['open_linked_document', { fromPath: '/a.md', href: 'b.md' }],
      ['reveal_linked_file', { fromPath: '/a.md', href: 'c.pdf' }],
      ['resolve_image', { docPath: '/a.md', src: 'p.png' }],
      ['read_image_bytes', { docPath: '/a.md', src: 'p.png', maxBytes: 100 }],
      ['read_linked_text', { fromPath: '/a.md', href: 'r.bib', purpose: 'bibliography' }],
      ['vault_index', { docPath: '/a.md' }],
      ['quarto_project', { docPath: '/a.md' }],
      ['recent_documents', undefined],
      ['open_recent', { path: '/a.md' }],
      ['remove_recent', { path: '/a.md' }],
      ['clear_recents', undefined],
      ['get_settings', undefined],
      ['update_settings', { patch: { appearance: 'dark' } }],
      ['get_doc_state', { path: '/a.md' }],
      ['set_doc_state', { path: '/a.md', patch: { flavor: 'gfm' } }],
      ['take_pending_open_files', undefined],
      ['set_window_title', { title: 'Title' }],
      ['open_preferences', undefined],
      ['finish_close', { reason: 'quit' }],
      ['cancel_close', { reason: 'window' }],
      ['ack_close', undefined],
      ['update_menu_state', { state: menuState }],
    ]);
  });

  it('keeps the Phase 0 commands as they were', async () => {
    const p = await platform();

    await p.openFileDialog();
    await p.readTextFile('/a.md');
    await p.launchOptions();

    expect(invoke.mock.calls.map(([name]) => name)).toEqual([
      'pick_file',
      'read_text_file',
      'launch_options',
    ]);
  });

  it('rejects with the PlatformError Rust sent', async () => {
    const p = await platform();
    invoke.mockRejectedValueOnce({ code: 'read-only', message: 'Locked.' });

    await expect(p.readDocument('/a.md')).rejects.toEqual({
      code: 'read-only',
      message: 'Locked.',
    });
  });

  it('turns any other rejection into an io PlatformError', async () => {
    const p = await platform();
    invoke.mockRejectedValueOnce('Command read_document not allowed by ACL');
    invoke.mockRejectedValueOnce(new Error('boom'));
    invoke.mockRejectedValueOnce(undefined);

    await expect(p.readDocument('/a.md')).rejects.toEqual({
      code: 'io',
      message: 'Command read_document not allowed by ACL',
    });
    await expect(p.readDocument('/a.md')).rejects.toEqual({ code: 'io', message: 'boom' });
    await expect(p.readDocument('/a.md')).rejects.toEqual({
      code: 'io',
      message: 'The operation failed.',
    });
  });
});

describe('the Tauri platform: events', () => {
  it('maps the events to their names and hands over the payload', async () => {
    const p = await platform();
    const seen: Record<string, unknown> = {};
    await p.onOpenFiles((paths) => (seen.open = paths));
    await p.onSettingsChanged((settings) => (seen.settings = settings));
    await p.onRecentsChanged((list) => (seen.recents = list));

    listeners.get('open-files')?.({ payload: ['/a.md'] });
    listeners.get('settings-changed')?.({ payload: { version: 1 } });
    listeners.get('recents-changed')?.({ payload: [] });

    expect(seen).toEqual({ open: ['/a.md'], settings: { version: 1 }, recents: [] });
  });

  it('tells Rust the menu listener exists after it is registered, and stops listening on failure', async () => {
    const p = await platform();
    const heard: string[] = [];

    const stop = await p.onMenuAction((action) => heard.push(action));
    listeners.get('menu-action')?.({ payload: 'save' });

    expect(invoke).toHaveBeenCalledWith('menu_ready', undefined);
    expect(heard).toEqual(['save']);
    stop();
    expect(listeners.has('menu-action')).toBe(false);

    invoke.mockRejectedValueOnce({ code: 'io', message: 'no' });
    await expect(p.onMenuAction(() => {})).rejects.toMatchObject({ code: 'io' });
    expect(listeners.has('menu-action')).toBe(false);
  });

  it('acknowledges close-requested before the handler runs', async () => {
    const p = await platform();
    const order: string[] = [];
    invoke.mockImplementation(async (name: string) => {
      order.push(`invoke ${name}`);
    });
    await p.onCloseRequested((reason) => order.push(`handler ${reason}`));

    listeners.get('close-requested')?.({ payload: 'window' });

    expect(order).toEqual(['invoke ack_close', 'handler window']);
  });

  it('a failing acknowledgement does not stop the handler', async () => {
    const p = await platform();
    invoke.mockRejectedValue({ code: 'io', message: 'x' });
    const reasons: string[] = [];
    await p.onCloseRequested((reason) => reasons.push(reason));

    listeners.get('close-requested')?.({ payload: 'quit' });

    expect(reasons).toEqual(['quit']);
  });
});

describe('the Tauri platform: Phase 3 commands', () => {
  it('calls each command with the argument names Rust expects', async () => {
    const p = await platform();

    await p.saveDialog({ suggestedName: 'a.html', directory: null, kind: 'html' });
    await p.folderDialog('move');
    await p.listFolder('/n');
    await p.fileIndex('/n');
    await p.createFile('/n', 'a.md');
    await p.createFolder('/n', 'sub');
    await p.renamePath('/n/a.md', 'b.md');
    await p.movePath('/n/b.md', '/n/sub');
    await p.duplicatePath('/n/b.md');
    await p.trashPath('/n/b.md');
    await p.writeClipboard({ text: 't', html: '<p>t</p>' });
    await p.writeClipboard({ text: 'only' });
    await p.readClipboardText();
    await p.printPage();
    await p.writeExport('/n/a.html', '<html></html>');
    const session = { tabs: [], active: 0, folder: null, sidebarTab: 'outline' as const };
    await p.getSession();
    await p.setSession(session);

    expect(invoke.mock.calls).toEqual([
      ['save_dialog', { suggestedName: 'a.html', directory: null, kind: 'html' }],
      ['folder_dialog', { purpose: 'move' }],
      ['list_folder', { path: '/n' }],
      ['file_index', { folder: '/n' }],
      ['create_file', { folder: '/n', name: 'a.md' }],
      ['create_folder', { folder: '/n', name: 'sub' }],
      ['rename_path', { path: '/n/a.md', newName: 'b.md' }],
      ['move_path', { path: '/n/b.md', toFolder: '/n/sub' }],
      ['duplicate_path', { path: '/n/b.md' }],
      ['trash_path', { path: '/n/b.md' }],
      ['write_clipboard', { text: 't', html: '<p>t</p>' }],
      ['write_clipboard', { text: 'only', html: null }],
      ['read_clipboard_text', undefined],
      ['print_page', undefined],
      ['write_export', { path: '/n/a.html', contents: '<html></html>' }],
      ['get_session', undefined],
      ['set_session', { session }],
    ]);
  });

  it('calls the watcher and search commands with the argument names Rust expects', async () => {
    const p = await platform();
    const set = { documents: ['/n/a.md'], linked: ['/n/r.bib'], folder: '/n' };
    const request = {
      id: 1,
      folder: '/n',
      query: 'q',
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    };

    await p.watch(set);
    await p.searchFolder(request);
    await p.cancelSearch(1);

    expect(invoke.mock.calls).toEqual([
      ['watch', { set }],
      ['search_folder', { request }],
      ['cancel_search', { id: 1 }],
    ]);
  });

  it('delivers file-changed batches to the handler until it is removed', async () => {
    const p = await platform();
    const batches: unknown[] = [];

    const stop = await p.onFileChanged((changes) => batches.push(changes));
    const batch = [{ path: '/n/a.md', kind: 'modified', scope: 'document' }];
    listeners.get('file-changed')?.({ payload: batch });
    stop();

    expect(batches).toEqual([batch]);
    expect(listeners.has('file-changed')).toBe(false);
  });

  it('the Pandoc methods call their commands', async () => {
    const p = await platform();
    invoke.mockResolvedValue(null);
    const request = {
      docPath: null,
      outPath: '/o.docx',
      input: '',
      from: 'gfm+tex_math_dollars',
      citeproc: false,
    };

    await p.pandocInfo();
    await p.exportDocx(request);

    expect(invoke).toHaveBeenNthCalledWith(1, 'pandoc_info', undefined);
    expect(invoke).toHaveBeenNthCalledWith(2, 'export_docx', { request });
  });

  it('the Preferences dialogs call choose_pandoc and choose_default_folder', async () => {
    const p = await platform();
    invoke.mockResolvedValue('/x/pandoc');

    await p.choosePandoc();
    await p.chooseDefaultFolder();

    expect(invoke).toHaveBeenNthCalledWith(1, 'choose_pandoc', undefined);
    expect(invoke).toHaveBeenNthCalledWith(2, 'choose_default_folder', undefined);
  });

  it('errors with the new codes pass through as platform errors', async () => {
    const p = await platform();
    invoke.mockRejectedValue({ code: 'exists', message: 'An item with that name exists.' });

    await expect(p.createFile('/n', 'a.md')).rejects.toMatchObject({ code: 'exists' });
  });
});
