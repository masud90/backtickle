/**
 * The command registry. One entry per `MenuAction` plus the
 * palette-only commands (sidebar tabs, flavors, appearance). The menu handler (`Shell.handleAction`)
 * and the command palette both run commands through it.
 *
 * `enabled(state)` mirrors the "Need" of the item in `src-tauri/src/menu_spec.rs`, so the palette
 * shows a command disabled exactly when the menu does. The menu bar itself is already disabled by
 * Rust; `handleAction` therefore runs a command without asking `enabled` again.
 *
 * The features behind the Phase 3 commands live in lazy modules (`files`, `search`, `quickopen`,
 * `palette`, `export`, `preview/find`, `editor/paste`): each is imported only when its command
 * runs, so none of them loads at startup.
 */
import { FLAVORS, type FlavorId } from '@/flavors';
import { byOs } from '@/lib/os';
import type { MenuAction, MenuState, Settings } from '@/lib/platform';
import { displayShortcut } from '@/lib/shortcut-keys';
import { type Need, SPECS, type Spec } from './menu-specs';
import type { Shell } from './shell.svelte';

export type { Need };

export type SidebarTab = 'outline' | 'files' | 'search' | 'snippets';

export interface Command {
  /** A `MenuAction`, or `sidebar-<tab>`, `flavor-<id>`, `appearance-<mode>` for palette-only ones. */
  id: string;
  label: string;
  /** Shown at the right edge of the palette row, for example "⌘N". */
  shortcut?: string;
  /** True for the commands that have no menu item. */
  paletteOnly?: boolean;
  enabled(state: MenuState): boolean;
  run(): Promise<void> | void;
}

/** The same rules as `enabled` in `menu_spec.rs` (the page is the window, so it is open). */
export function isEnabled(need: Need, state: MenuState): boolean {
  switch (need) {
    case 'always':
    case 'window':
      return true;
    case 'document':
      return state.hasDocument;
    case 'can-save':
      return state.hasDocument && state.canSave;
    case 'editor':
      return state.hasDocument && state.canFormat;
    case 'tabs':
      return state.tabCount >= 2;
    case 'saved-document':
      return state.hasDocument && state.hasPath === true;
    case 'can-export-docx':
      return state.hasDocument && state.canExportDocx === true;
    case 'can-render':
      return state.hasDocument && state.canRender === true;
    case 'can-exact-preview':
      return state.hasDocument && state.canExactPreview === true;
  }
}

/** What a menu action does. Anything not listed is a format command (`FORMAT_ACTIONS`). */
function runnerFor(shell: Shell, action: MenuAction): () => Promise<void> | void {
  switch (action) {
    case 'new':
      return () => shell.newDocument();
    case 'open':
      return () => shell.openFilesDialog();
    case 'open-folder':
      return async () => (await import('./files')).openFolder(shell);
    case 'quick-open':
      return async () => (await import('./quickopen')).openQuickOpen(shell);
    case 'close-tab':
      return () => shell.closeActiveTab();
    case 'close-window':
      // Rust turns this into `close-requested`; nothing to do here.
      return () => {};
    case 'save':
      return () => shell.saveActive(false);
    case 'save-as':
      return () => shell.saveActive(true);
    case 'duplicate':
      return async () => (await import('./files')).duplicateActive(shell);
    case 'rename':
      return async () => (await import('./files')).renameActive(shell);
    case 'move-to':
      return async () => (await import('./files')).moveActive(shell);
    case 'revert':
      return async () => (await import('./files')).revertActive(shell);
    case 'export-html':
      return async () => (await import('@/export')).exportHtml(shell);
    case 'export-docx':
      return async () => (await import('@/export')).exportDocx(shell);
    case 'export-pdf':
      return async () => (await import('@/export')).exportPdf(shell);
    case 'render-quarto':
      return async () => (await import('@/export/render')).renderWithQuarto(shell);
    case 'print':
      return async () => (await import('@/export')).print(shell);
    case 'reveal-in-finder':
      return () => shell.revealActive();
    case 'undo':
      return () => shell.undo();
    case 'redo':
      return () => shell.redo();
    case 'copy-html':
      return async () => (await import('@/export')).copyHtml(shell);
    case 'paste-plain':
      return async () => {
        if (shell.canFormat) (await import('@/editor/paste')).pastePlain(shell);
      };
    case 'find':
      return async () => {
        // In Preview (or Split with the focus in the preview) the find bar belongs to the
        // preview; the editor has its own.
        if (shell.previewFindWanted()) {
          await (await import('@/preview/find')).openPreviewFind(shell);
        } else {
          shell.findAction(action);
        }
      };
    case 'find-next':
    case 'find-previous':
      return async () => {
        if (shell.previewFindWanted()) {
          await (await import('@/preview/find')).stepPreviewFind(
            shell,
            action === 'find-next' ? 1 : -1,
          );
        } else {
          shell.findAction(action);
        }
      };
    case 'find-replace':
      return async () => {
        // Replace works on the source: Preview switches to Split first.
        if (shell.active?.view === 'preview') await shell.setViewMode('split');
        shell.findAction(action);
      };
    case 'search-folder':
      return async () => {
        shell.setSidebarTab('search');
        await (await import('./search')).showSearch(shell);
      };
    case 'command-palette':
      return async () => (await import('./palette')).openPalette(shell);
    case 'view-editor':
    case 'view-split':
    case 'view-preview':
      return () =>
        shell.setViewMode(action.slice('view-'.length) as 'editor' | 'split' | 'preview');
    case 'toggle-sidebar':
      return () =>
        shell.patchSettings({ view: { sidebarVisible: !shell.settings.view.sidebarVisible } });
    case 'toggle-sync-scroll':
      return () => shell.patchSettings({ view: { syncScroll: !shell.settings.view.syncScroll } });
    case 'toggle-typewriter':
      return () =>
        shell.patchSettings({ editor: { typewriter: !shell.settings.editor.typewriter } });
    case 'toggle-exact-preview':
      return () => shell.toggleExactPreview();
    case 'zoom-in':
      return () => shell.stepZoom(1);
    case 'zoom-out':
      return () => shell.stepZoom(-1);
    case 'zoom-reset':
      return () => shell.setZoom(1);
    case 'next-tab':
      return () => shell.cycleTab(1);
    case 'previous-tab':
      return () => shell.cycleTab(-1);
    case 'move-tab-to-new-window':
      return () => shell.moveActiveTabToNewWindow();
    case 'markdown-guide':
      return () => shell.openGuide();
    default:
      // The format commands (FORMAT_ACTIONS), in the editor only.
      return () => shell.runFormat(action);
  }
}

const SIDEBAR_TABS: ReadonlyArray<readonly [SidebarTab, string]> = [
  ['outline', 'Show Outline'],
  ['files', 'Show Files'],
  ['search', 'Show Search'],
  ['snippets', 'Show Snippets'],
];

const APPEARANCES: ReadonlyArray<readonly [Settings['appearance'], string]> = [
  ['system', 'Appearance: Match System'],
  ['light', 'Appearance: Light'],
  ['dark', 'Appearance: Dark'],
];

/**
 * A command's shortcut as shown: the user's override, or the default. On Windows in Windows form
 * (`Ctrl+Shift+O`, see `displayShortcut`); on macOS the string as it is.
 */
export function shortcutOf(
  shell: Shell,
  id: string,
  fallback: string | undefined,
): string | undefined {
  const overrides = shell.settings.shortcuts;
  if (overrides && Object.hasOwn(overrides, id)) return displayShortcut(overrides[id] ?? undefined);
  return displayShortcut(fallback);
}

/** Every command, menu actions first, then the palette-only ones. */
export function createCommands(shell: Shell): Command[] {
  const list: Command[] = [];
  for (const [id, [label, need, shortcut]] of Object.entries(SPECS) as Array<[MenuAction, Spec]>) {
    list.push({
      id,
      // The menu (built by Rust) says File Explorer on Windows; the palette says the same.
      label: id === 'reveal-in-finder' ? byOs(label, 'Show in File Explorer') : label,
      // The user's change (Preferences > Keyboard Shortcuts) shows at once, in every window.
      get shortcut() {
        return shortcutOf(shell, id, shortcut);
      },
      enabled: (state) => isEnabled(need, state),
      run: runnerFor(shell, id),
    });
  }
  for (const [tab, label] of SIDEBAR_TABS) {
    list.push({
      id: `sidebar-${tab}`,
      label,
      paletteOnly: true,
      enabled: () => true,
      run: () => shell.showSidebarTab(tab),
    });
  }
  for (const flavor of FLAVORS) {
    list.push({
      id: `flavor-${flavor.id}`,
      label: `Flavor: ${flavor.label}`,
      paletteOnly: true,
      enabled: (state) => state.hasDocument,
      run: () => shell.chooseFlavor(flavor.id as FlavorId),
    });
  }
  for (const [appearance, label] of APPEARANCES) {
    list.push({
      id: `appearance-${appearance}`,
      label,
      paletteOnly: true,
      enabled: () => true,
      run: () => shell.patchSettings({ appearance }),
    });
  }
  return list;
}
