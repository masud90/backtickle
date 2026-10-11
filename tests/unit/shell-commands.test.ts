import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import { FLAVORS } from '@/flavors';
import type { LaunchOptions, MenuAction, MenuState } from '@/lib/platform';
import { createMockPlatform } from '@/lib/platform-mock';
import { createCommands } from '@/shell/commands';
import { Shell } from '@/shell/shell.svelte';

const welcome: LaunchOptions = {
  openPath: null,
  welcome: true,
  perf: false,
  bench: false,
  view: null,
};

// The menu actions of the spec, by hand.
const MENU_ACTIONS: MenuAction[] = [
  'new', 'open', 'open-folder', 'quick-open', 'close-tab', 'close-window', 'save', 'save-as',
  'duplicate', 'rename', 'move-to', 'revert', 'export-html', 'export-docx', 'export-pdf', 'print',
  'reveal-in-finder', 'undo', 'redo', 'copy-html', 'paste-plain', 'find', 'find-replace',
  'find-next', 'find-previous', 'search-folder', 'bold', 'italic', 'strikethrough', 'code', 'link',
  'image', 'quote', 'bullet-list', 'numbered-list', 'task-list', 'code-block', 'table', 'rule',
  'heading-1', 'heading-2', 'heading-3', 'heading-4', 'heading-5', 'heading-6', 'paragraph',
  'command-palette', 'view-editor', 'view-split', 'view-preview', 'toggle-sidebar',
  'toggle-sync-scroll', 'toggle-typewriter', 'toggle-exact-preview', 'render-quarto', 'zoom-in', 'zoom-out', 'zoom-reset', 'next-tab', 'previous-tab',
  'markdown-guide', 'move-tab-to-new-window',
]; // biome-ignore format: a long list

const NONE: MenuState = {
  hasDocument: false,
  canSave: false,
  canFormat: false,
  viewMode: null,
  sidebarVisible: true,
  syncScroll: true,
  tabCount: 0,
  hasPath: false,
  canExportDocx: false,
};
const SAVED: MenuState = {
  ...NONE,
  hasDocument: true,
  canSave: true,
  canFormat: true,
  viewMode: 'split',
  tabCount: 1,
  hasPath: true,
  canExportDocx: true,
};

function registry() {
  const shell = new Shell(createMockPlatform({}), welcome);
  return { shell, commands: new Map(createCommands(shell).map((c) => [c.id, c])) };
}

function enabledIds(state: MenuState): string[] {
  return [...registry().commands.values()]
    .filter((c) => !c.paletteOnly && c.enabled(state))
    .map((c) => c.id)
    .sort();
}

describe('command registry', () => {
  it('has one command for every menu action and the palette-only ones', () => {
    const { commands } = registry();

    for (const action of MENU_ACTIONS) expect(commands.has(action), action).toBe(true);
    const menuOnes = [...commands.values()].filter((c) => !c.paletteOnly);
    expect(menuOnes).toHaveLength(MENU_ACTIONS.length);
    expect([...commands.keys()].filter((id) => id.startsWith('sidebar-'))).toEqual([
      'sidebar-outline',
      'sidebar-files',
      'sidebar-search',
      'sidebar-snippets',
    ]);
    expect([...commands.keys()].filter((id) => id.startsWith('flavor-'))).toHaveLength(
      FLAVORS.length,
    );
    expect(commands.get('flavor-pandoc')?.label).toBe('Flavor: Pandoc / MMD');
  });

  it('C35: the Phase 3 items carry the shortcuts of the spec', () => {
    const { commands } = registry();
    const shortcut = (id: string) => commands.get(id)?.shortcut;

    expect(shortcut('open-folder')).toBe('⌥⌘O');
    expect(shortcut('quick-open')).toBe('⇧⌘O');
    expect(shortcut('print')).toBe('⌘P');
    expect(shortcut('paste-plain')).toBe('⌥⇧⌘V');
    expect(shortcut('search-folder')).toBe('⇧⌘F');
    expect(shortcut('command-palette')).toBe('⇧⌘P');
    for (const id of ['duplicate', 'rename', 'move-to', 'revert', 'copy-html', 'export-html']) {
      expect(shortcut(id), id).toBeUndefined();
    }
  });

  it('C35: without a document only the launchers and the always-on items are enabled', () => {
    expect(enabledIds(NONE)).toEqual(
      [
        'new', 'open', 'close-tab', 'close-window', 'toggle-sidebar', 'markdown-guide',
        'open-folder', 'quick-open', 'command-palette', 'search-folder',
      ].sort(),
    ); // biome-ignore format: a long list
  });

  it('C35: the saved-document items need a file, export and print only a document', () => {
    const untitled = { ...SAVED, hasPath: false };
    const off = ['duplicate', 'rename', 'move-to', 'revert', 'copy-html'];

    for (const id of off) {
      expect(enabledIds(untitled), id).not.toContain(id);
      expect(enabledIds(SAVED), id).toContain(id);
    }
    expect(enabledIds(untitled)).toEqual(expect.arrayContaining(['export-html', 'print']));
  });

  it('5.13: Render with Quarto needs a saved Quarto or R Markdown document', () => {
    expect(enabledIds(SAVED)).not.toContain('render-quarto');
    expect(enabledIds({ ...SAVED, canRender: true })).toContain('render-quarto');
    expect(enabledIds({ ...NONE, canRender: true })).not.toContain('render-quarto');
    expect(registry().commands.get('render-quarto')?.label).toBe('Render with Quarto…');
    expect(registry().commands.get('render-quarto')?.shortcut).toBeUndefined();
  });

  it('C35: Word export needs Pandoc, Paste and Match Style needs the editor', () => {
    expect(enabledIds({ ...SAVED, canExportDocx: false })).not.toContain('export-docx');
    expect(enabledIds({ ...SAVED, canExportDocx: false })).toContain('export-html');
    expect(enabledIds(SAVED)).toContain('export-docx');
    expect(enabledIds({ ...SAVED, canFormat: false, viewMode: 'preview' })).not.toContain(
      'paste-plain',
    );
    expect(enabledIds(SAVED)).toContain('paste-plain');
    expect(enabledIds({ ...SAVED, tabCount: 2 })).toContain('next-tab');
    expect(enabledIds(SAVED)).not.toContain('next-tab');
  });

  it('a missing hasPath or canExportDocx counts as false', () => {
    const { hasPath: _a, canExportDocx: _b, ...partial } = SAVED;

    expect(enabledIds(partial)).not.toContain('rename');
    expect(enabledIds(partial)).not.toContain('export-docx');
  });
});

describe('shell commands', () => {
  it('Search in Folder shows the Search tab; the palette commands switch the sidebar tab', async () => {
    const { shell } = registry();

    await shell.handleAction('search-folder');
    expect(shell.sidebarTab).toBe('search');
    await shell.command('sidebar-files')?.run();
    expect(shell.sidebarTab).toBe('files');
    await shell.command('sidebar-outline')?.run();
    expect(shell.sidebarTab).toBe('outline');
  });

  it('sends hasPath and canExportDocx with the menu state (Pandoc found later)', async () => {
    const platform = createMockPlatform({ pandoc: { path: '/p/pandoc', version: '3.8.3' } });
    const shell = new Shell(platform, welcome);
    await shell.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
    const control = window.__WRITEDOWN_MOCK__;

    const last = control?.menuStates.at(-1);
    expect(last?.hasPath).toBe(false);
    expect(last?.canExportDocx).toBe(true);
    shell.destroy();
  });
});
