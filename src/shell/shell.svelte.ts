/**
 * The state and the behavior of the main window that do not need the editor: the open documents,
 * opening and saving, the close and quit questions, the menu actions, the settings in use.
 *
 * This is the main chunk. The editor and the preview live in the workspace (a lazy chunk) and
 * are reached through `WorkspaceApi`, so a window without a document never loads them.
 *
 * Everything that changes documents runs one at a time through `enqueue`, so a menu action that
 * arrives during a dialog, or two files opened at once, never interleave.
 */
import type { Component } from 'svelte';
import { tick, untrack } from 'svelte';
import type { FormatCommand } from '@/editor/commands';
import { detectFlavor, type FlavorId } from '@/flavors';
import { guideFlavor, guideName, loadGuide } from '@/flavors/guides';
import type {
  CloseReason,
  DeepPartial,
  LaunchOptions,
  MenuAction,
  MenuState,
  Platform,
  RecentEntry,
  SaveOptions,
  SessionTab,
  Settings,
  TabTransfer,
  ViewMode,
  WindowTransfer,
} from '@/lib/platform';
import { whenSettled } from '@/perf/marks';
import type { PreviewLink } from '@/preview/events';
import type { PreviewFindHost } from '@/preview/find/types';
import { loadPipeline } from '@/preview/pipeline';
import { applyPreviewSettings } from '@/preview/settings';
import type { Heading } from '@/preview/types';
import { applyDocumentAppearance, applyZoom, stepZoom } from './appearance';
import { type CloseAnswer, walkUnsaved } from './closewalk';
import { type Command, createCommands, type SidebarTab } from './commands';
import {
  directoryOf,
  errorMessage,
  fileName,
  isCancelled,
  nextUntitledName,
  suggestSaveName,
} from './document';
import { type OutlineDepth, sameHeadings } from './outline';
import { fileTab, movedFields, type Tab, tabFromTransfer, tabIsDirty, untitledTab } from './tab';
import type { ExportSource, InsertItem, WorkspaceApi, WorkspaceHost } from './types';
import type { WikilinkTarget } from './wikilinks';

/** Used until the settings arrive from the platform (the same values as the Rust defaults). */
const FALLBACK_SETTINGS: Settings = {
  version: 1,
  defaultFlavor: 'gfm',
  openExistingIn: 'preview',
  openNewIn: 'split',
  recentLimit: 20,
  appearance: 'system',
  readingWpm: 238,
  editor: {
    fontFamily: 'jetbrains-mono',
    fontSize: 13,
    lineHeight: 1.7,
    tabSize: 2,
    insertSpaces: true,
    currentLine: true,
    autoPair: false,
    continueLists: true,
    typewriter: false,
    paneHeaders: true,
    softWrap: true,
    lineNumbers: true,
    spellcheck: true,
  },
  view: { sidebarVisible: true, sidebarWidth: 240, splitRatio: 0.5, syncScroll: true, zoom: 1 },
  restoreSession: true,
  vibrancy: true,
  shortcuts: {},
  files: { ignore: ['node_modules', '_site', '_freeze', 'renv', 'venv', '__pycache__'] },
  export: { pandocPath: null },
  preview: {
    autoDetectFlavor: true,
    font: 'inter',
    fontSize: 15,
    columnWidth: 720,
    hashtagPills: false,
    obsidianCommentsDimmed: false,
    smartPunctuation: true,
    math: true,
    remoteImages: true,
    codeCards: 'dark',
  },
  a11y: {
    dyslexia: false,
    dyslexiaFont: 'opendyslexic',
    ruler: false,
    rulerTint: 'yellow',
    spotlight: false,
    reduceMotion: 'system',
    highContrast: 'system',
    scale: 1,
  },
  saving: { autoSave: false, newLineEnding: 'lf', newFinalNewline: false, defaultFolder: null },
};

const CLOCK_MS = 30_000;
/** Changes to the set of watched files this close together make one `watch` call. */
const WATCH_DEBOUNCE_MS = 100;

let pdfBenchStarted = false;

export class Shell implements WorkspaceHost {
  readonly platform: Platform;
  readonly launch: LaunchOptions;
  /** `main`, or `doc-<n>` for a window a tab was moved to (Phase 5). */
  readonly windowLabel: string;
  /** The main window: it holds the Files folder and shows the welcome screen when empty. */
  readonly isMain: boolean;

  tabs = $state.raw<Tab[]>([]);
  activeId = $state<number | null>(null);
  settings = $state.raw<Settings>(FALLBACK_SETTINGS);
  recents = $state.raw<RecentEntry[]>([]);
  /** A plain-language error, shown in a dismissible banner. */
  error = $state<string | null>(null);
  /** A plain notice, shown in a dismissible banner (for example after a handoff to RStudio). */
  notice = $state<string | null>(null);
  /** The clock for relative times; refreshed every 30 seconds while the window is visible. */
  now = $state(Date.now());
  /** 1-based caret position of the document on show. */
  cursor = $state.raw({ line: 1, column: 1 });
  selection = $state.raw<{ words: number; characters: number } | null>(null);
  /** The depth filter of the outline sidebar (not stored: it starts at All in every window). */
  outlineDepth = $state<OutlineDepth>(0);
  /** The line the outline measures the current section by (see `WorkspaceHost.setOutlineLine`). */
  outlineLine = $state(0);
  /** The Insert menu entries of the active document's flavor (empty when it has none). */
  inserts = $state.raw<InsertItem[]>([]);
  /** The tab of the sidebar on show; the session saves it (WP3.7). */
  sidebarTab = $state<SidebarTab>('outline');
  /** The folder shown in the Files tab (set by its model), or null; the watch set and session use it. */
  openFolderPath = $state<string | null>(null);
  /** Pandoc was found (File > Export > Word Document is enabled). Read once at startup. */
  pandocFound = $state(false);
  /** The exact preview (Pandoc) is switched on in this window (not stored; off in every window at start). */
  exactPreview = $state(false);
  /** A Word export is running (the title bar's status pill says "Exporting…"). */
  exporting = $state(false);
  /** The startup reads are done: the welcome screen may show. */
  loaded = $state(false);
  /** The workspace component, loaded when the first document is shown. */
  WorkspaceComponent = $state.raw<Component<{ shell: Shell }> | null>(null);

  readonly active = $derived(this.tabs.find((tab) => tab.id === this.activeId) ?? null);
  /** Pandoc was found and the active flavor has an exact preview (Pandoc / MMD, Quarto / RMD, GFM, CommonMark). */
  readonly canExactPreview = $derived(
    this.pandocFound &&
      this.active !== null &&
      ['pandoc', 'quarto', 'gfm', 'commonmark'].includes(this.active.flavor),
  );
  /** The active document is a saved Quarto or R Markdown file (File > Render with Quarto). */
  readonly canRender = $derived(
    this.active !== null && this.active.path != null && /\.(qmd|rmd)$/i.test(this.active.path),
  );
  readonly exactPreviewActive = $derived(this.exactPreview && this.canExactPreview);
  readonly menuState: MenuState = $derived({
    hasDocument: this.active !== null,
    canSave: this.active !== null,
    canFormat: this.active !== null && this.active.view !== 'preview',
    viewMode: this.active?.view ?? null,
    sidebarVisible: this.settings.view.sidebarVisible,
    syncScroll: this.settings.view.syncScroll,
    typewriter: this.settings.editor.typewriter,
    tabCount: this.tabs.length,
    hasPath: this.active?.path != null,
    canExportDocx: this.pandocFound,
    canExactPreview: this.canExactPreview,
    canRender: this.canRender,
    exactPreview: this.exactPreviewActive,
  });

  private readonly commandList: Command[];
  private readonly commandMap: Map<string, Command>;
  private workspace: WorkspaceApi | null = null;
  private workspaceWaiters: Array<() => void> = [];
  private nextId = 1;
  private chain: Promise<unknown>;
  private openGate: () => void = () => {};
  private startup: {
    perf: boolean;
    bench: boolean;
    benchSearch?: string | null;
    benchPdf?: string | null;
  } | null;
  private readonly cleanups: Array<() => void> = [];
  private clockTimer: ReturnType<typeof setInterval> | undefined;
  private lastMenuKey = '';
  private lastTitle: string | null = null;
  private settingsPatchTimer: ReturnType<typeof setTimeout> | undefined;
  /** Auto-save (WP4.2): loaded when the setting is first on, dropped when it goes off. */
  private recovery: import('./recovery').Recovery | null = null;
  private recoveryLoading: Promise<import('./recovery').Recovery> | null = null;
  private autosave: import('./autosave').AutoSave | null = null;
  private autosaveLoading = false;
  private sidebarWidthTimer: ReturnType<typeof setTimeout> | undefined;
  private watchTimer: ReturnType<typeof setTimeout> | undefined;
  private lastWatchKey = '';
  private lastDocumentsKey = '';
  private lastEdited = false;
  private sentWatchKey = '';
  private listeningToFiles = false;
  private stopFileChanges: (() => void) | null = null;

  constructor(platform: Platform, launch: LaunchOptions) {
    this.platform = platform;
    this.launch = launch;
    this.windowLabel = launch.windowLabel ?? 'main';
    this.isMain = this.windowLabel === 'main';
    this.commandList = createCommands(this);
    this.commandMap = new Map(this.commandList.map((command) => [command.id, command]));
    this.startup =
      launch.perf || launch.bench || launch.benchPdf
        ? {
            perf: launch.perf,
            bench: launch.bench,
            benchSearch: launch.benchSearch ?? null,
            benchPdf: launch.benchPdf ?? null,
          }
        : null;
    // Nothing queued runs before the startup reads are finished.
    this.chain = new Promise<void>((resolve) => {
      this.openGate = resolve;
    });
  }

  // ---- startup and shutdown -----------------------------------------------------------------

  /** Registers the listeners, reads the settings and recents, and opens what the app was given. */
  async start(): Promise<void> {
    const p = this.platform;
    // Listeners first, so nothing that arrives while the rest of startup runs is lost.
    this.cleanups.push(
      await p.onOpenFiles((paths) => void this.enqueue(() => this.openPaths(paths))),
      // Images go to the document on show now, where they were dropped (not after queued work).
      await p.onDropImages((drop) => void this.workspace?.dropImages(drop)),
      await p.onMenuAction((action) => void this.enqueue(() => this.handleAction(action))),
      await p.onCloseRequested((reason) => void this.enqueue(() => this.closeRequested(reason))),
      await p.onSettingsChanged((next) => this.applySettings(next)),
      await p.onRecentsChanged((list) => {
        this.recents = list;
      }),
    );
    this.watchVisibility();
    const stopEffects = $effect.root(() => {
      $effect(() => this.pushMenuState());
      $effect(() => this.pushTitle());
      $effect(() => this.syncWatch());
      $effect(() => this.pushDocuments());
      $effect(() => this.pushEdited());
      $effect(() => {
        // The exact preview starts or stops with this switch, Pandoc and the active flavor.
        void this.exactPreviewActive;
        untrack(() => this.workspace?.syncExact());
      });
    });
    this.cleanups.push(stopEffects);

    try {
      const pending = await p.takePendingOpenFiles();
      const [settings, recents] = await Promise.all([p.getSettings(), p.recentDocuments()]);
      this.applySettings(settings);
      this.recents = recents;
      // Not awaited (finding Pandoc must not delay the first window). Null-safe: without Pandoc,
      // or on a platform without the method, Word export stays disabled.
      void Promise.resolve(p.pandocInfo?.())
        .then((info) => {
          this.pandocFound = info != null;
        })
        .catch(() => {});
      // A window a tab was moved to (or restored from the session) starts from what waits for it.
      const transfer = this.isMain ? null : await p.takeTransfer().catch(() => null);
      if (this.launch.restoreSession !== false && settings.restoreSession) {
        await this.restoreLastSession();
      }
      if (transfer) await this.openTransfer(transfer);
      // `--folder`: the Files tab shows that folder (the panel loads it when it mounts).
      if (this.launch.folderPath) this.setSidebarTab('files');
      if (this.launch.openPath) {
        await this.openPaths([this.launch.openPath], this.launch.view ?? undefined);
      }
      if (pending.length > 0) await this.openPaths(pending);
      // Documents kept by a run that did not end cleanly come back marked "Recovered".
      if (this.isMain) await this.checkRecovery();
      if (this.launch.benchRecovery) void this.runRecoveryBench();
    } catch (error) {
      this.error = errorMessage(error);
    }
    this.loaded = true;
    if (this.tabs.length === 0) {
      // The welcome screen is the finished window.
      await tick();
      await whenSettled();
      if (this.takeStartup()?.perf) this.platform.perfMark('ready');
    }
    this.openGate();
  }

  destroy(): void {
    for (const stop of this.cleanups.splice(0)) stop();
    clearInterval(this.clockTimer);
    clearTimeout(this.settingsPatchTimer);
    clearTimeout(this.sidebarWidthTimer);
    clearTimeout(this.watchTimer);
    this.stopFileChanges?.();
    this.autosave?.destroy();
    this.recovery?.destroy();
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('blur', this.onWindowBlur);
  }

  /** The search benchmark (S12): lazy, so no other start loads it. */
  async runSearchBench(query: string): Promise<void> {
    const [{ runSearchBench }, { getFilesModel }] = await Promise.all([
      import('@/perf/search-bench'),
      import('./files/model.svelte'),
    ]);
    const report = await runSearchBench(this.platform, getFilesModel(this).folder, query);
    await this.platform.benchSearchReport(report);
  }

  /** The PDF benchmark: the same export as the menu item, to a given path. Lazy. */
  async runPdfBench(path: string): Promise<void> {
    // Once per run, however often a document becomes ready (or the page is loaded again).
    if (pdfBenchStarted) return;
    pdfBenchStarted = true;
    try {
      if (sessionStorage.getItem('wd-pdf-bench') === '1') {
        this.platform.perfMark('pdf-bench-again');
        return;
      }
      sessionStorage.setItem('wd-pdf-bench', '1');
    } catch {
      // Without session storage only the module flag guards.
    }
    await (await import('@/export')).exportPdfTo(this, path);
  }

  takeStartup(): {
    perf: boolean;
    bench: boolean;
    benchSearch?: string | null;
    benchPdf?: string | null;
  } | null {
    const startup = this.startup;
    this.startup = null;
    return startup;
  }

  /** Runs one task after the ones before it. A failure becomes the error banner. */
  enqueue<T>(task: () => Promise<T>): Promise<T | undefined> {
    const run = async (): Promise<T | undefined> => {
      try {
        return await task();
      } catch (error) {
        if (!isCancelled(error)) this.error = errorMessage(error);
        return undefined;
      }
    };
    const result = this.chain.then(run, run);
    this.chain = result;
    return result;
  }

  // ---- the clock, menu state and window title -------------------------------------------------

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'visible') {
      this.now = Date.now();
      this.startClock();
    } else {
      this.stopClock();
    }
  };

  /** Auto-save: the window lost focus. */
  private readonly onWindowBlur = (): void => {
    if (this.autosave) void this.enqueue(async () => this.autosave?.flush(this.activeId));
    // Crash recovery: what waits for its timer is kept now.
    void this.recovery?.flushAll();
  };

  private watchVisibility(): void {
    window.addEventListener('blur', this.onWindowBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    if (document.visibilityState === 'visible') this.startClock();
  }

  private startClock(): void {
    if (this.clockTimer !== undefined) return;
    this.clockTimer = setInterval(() => {
      this.now = Date.now();
    }, CLOCK_MS);
  }

  private stopClock(): void {
    clearInterval(this.clockTimer);
    this.clockTimer = undefined;
  }

  private pushMenuState(): void {
    const state = this.menuState;
    const key = JSON.stringify(state);
    if (key === this.lastMenuKey) return;
    this.lastMenuKey = key;
    this.platform.updateMenuState(state).catch(() => {});
  }

  /** The macOS unsaved dot follows the active tab of this window. */
  private pushEdited(): void {
    const edited = this.active !== null && tabIsDirty(this.active);
    if (edited === this.lastEdited) return;
    this.lastEdited = edited;
    this.platform.setDocumentEdited(edited).catch(() => {});
  }

  /** The documents this window holds, so no other window opens the same file (Phase 5). */
  private pushDocuments(): void {
    const paths = this.tabs.flatMap((tab) => (tab.path !== null ? [tab.path] : []));
    const key = JSON.stringify(paths);
    if (key === this.lastDocumentsKey) return;
    // A window that never had a document has nothing to say.
    if (this.lastDocumentsKey === '' && paths.length === 0) return;
    this.lastDocumentsKey = key;
    this.platform.setWindowDocuments(paths).catch(() => {});
  }

  private pushTitle(): void {
    const title = this.active?.name ?? 'Writedown';
    if (title === this.lastTitle) return;
    this.lastTitle = title;
    this.platform.setWindowTitle(title).catch(() => {});
  }

  // ---- settings ---------------------------------------------------------------------------------

  /** Takes new settings (from this window or another) into use. */
  applySettings(next: Settings): void {
    const redetect = next.preview.autoDetectFlavor !== this.settings.preview.autoDetectFlavor;
    this.settings = next;
    applyZoom(document.documentElement, next);
    // Preview settings (WP4.3): CSS variables, render options, fonts.
    applyPreviewSettings(document.documentElement, next);
    applyDocumentAppearance(document.documentElement, next);
    this.workspace?.applySettings(next);
    this.syncAutosave(next.saving.autoSave);
    if (redetect) void this.enqueue(() => this.redetectFlavors());
  }

  /** "Detect the flavor automatically" was switched: every open document takes the new rule. */
  private async redetectFlavors(): Promise<void> {
    for (const tab of [...this.tabs]) {
      if (tab.chosenFlavor) continue;
      const context = tab.path ? await this.platform.documentContext(tab.path) : null;
      const detected = detectFlavor({
        path: tab.path,
        text: this.workspace?.textOf(tab.id) ?? tab.initialText ?? '',
        chosen: null,
        defaultFlavor: this.settings.defaultFlavor,
        autoDetect: this.settings.preview.autoDetectFlavor,
        inObsidianVault: context?.obsidianVault ?? false,
      });
      if (detected.flavor === tab.flavor && detected.reason === tab.reason) continue;
      this.patchTab(tab.id, { flavor: detected.flavor, reason: detected.reason });
      void loadPipeline(detected.flavor);
      const updated = this.tabs.find((candidate) => candidate.id === tab.id);
      if (updated && updated.id === this.activeId) await this.workspace?.applyFlavor(updated);
    }
  }

  /** The auto-save module loads only when the setting is on; off drops it and its timers. */
  private syncAutosave(on: boolean): void {
    if (!on) {
      this.autosave?.destroy();
      this.autosave = null;
    } else if (this.autosave) this.autosave.reset();
    else if (!this.autosaveLoading) {
      this.autosaveLoading = true;
      void import('./autosave')
        .then(({ AutoSave }) => {
          if (this.settings.saving.autoSave && !this.autosave) {
            this.autosave = new AutoSave(this);
            this.autosave.reset();
          }
        })
        .finally(() => {
          this.autosaveLoading = false;
        });
    }
  }

  /** A document was edited (from the workspace): auto-save starts its wait. */
  documentEdited(id: number): void {
    this.autosave?.edited(id);
    this.recoveryEdited(id);
  }

  // ---- crash recovery (Phase 5) ---------------------------------------------------------------

  /** The module loads at the first unsaved edit (or when the launch check finds entries). */
  private loadRecovery(): Promise<import('./recovery').Recovery> {
    if (this.recovery) return Promise.resolve(this.recovery);
    this.recoveryLoading ??= import('./recovery').then(({ Recovery }) => {
      this.recovery ??= new Recovery(this);
      return this.recovery;
    });
    return this.recoveryLoading;
  }

  /** An unsaved document is kept 2 s after its last edit; one that is no longer different is not. */
  private recoveryEdited(id: number): void {
    const tab = this.tabs.find((candidate) => candidate.id === id);
    if (!tab || tab.guide) return;
    if (!tabIsDirty(tab)) {
      void this.recovery?.forget(id);
      return;
    }
    if (this.recovery) this.recovery.edited(id);
    else void this.loadRecovery().then((recovery) => recovery.edited(id));
  }

  /** The launch check: one call; the module loads only when something was left behind. */
  private async checkRecovery(): Promise<void> {
    const entries = await this.platform.recoveryList().catch(() => []);
    if (entries.length === 0) return;
    const recovery = await this.loadRecovery();
    const { restoreRecovered } = await import('./recovery');
    await restoreRecovered(this.recoveryHost(), recovery, entries);
  }

  private recoveryHost(): import('./recovery').RecoveryHost {
    return {
      readTab: (path, view) => this.readTab(path, view),
      nextId: () => this.nextId++,
      heldElsewhere: (path) => this.heldElsewhere(path),
      tabForPath: (path) => this.tabs.find((tab) => tab.path === path),
      removeTab: (id) => this.removeTab(id),
      addTab: (tab) => this.addTab(tab),
      activate: (id) => this.activate(id),
    };
  }

  /** Keep: the recovered text stays as a normal unsaved document. */
  keepRecovered(id: number): void {
    this.patchTab(id, { recovered: false });
  }

  /** Discard: the recovered document closes and its entry is removed. */
  discardRecovered(id: number): Promise<unknown> {
    return this.enqueue(async () => {
      await this.recovery?.forget(id);
      await this.removeTab(id);
      await this.closeIfEmpty();
    });
  }

  /** The real-app check (`WRITEDOWN_BENCH=recovery-edit`): type a sentence and keep it at once. */
  private async runRecoveryBench(): Promise<void> {
    const recovery = await this.loadRecovery();
    await this.enqueue(() => recovery.runEditBench());
  }

  /** For the recovery module: the workspace once it exists. */
  get workspaceApi(): WorkspaceApi | null {
    return this.workspace;
  }

  ensureWorkspaceApi(): Promise<WorkspaceApi> {
    return this.ensureWorkspace();
  }

  /** Auto-save of a document with a file: no question is asked (see `writeTo`). */
  async saveQuietly(id: number, overwrite = false): Promise<boolean> {
    const tab = this.tabs.find((candidate) => candidate.id === id);
    if (!tab?.path || this.activeId !== id || !this.workspace) return false;
    return this.writeTo(tab, tab.path, tab.modifiedMs, true, overwrite);
  }

  async patchSettings(patch: DeepPartial<Settings>): Promise<void> {
    try {
      this.applySettings(await this.platform.updateSettings(patch));
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  setSplitRatio(ratio: number): void {
    clearTimeout(this.settingsPatchTimer);
    this.settingsPatchTimer = setTimeout(() => {
      if (Math.abs(ratio - this.settings.view.splitRatio) > 0.0005) {
        void this.patchSettings({ view: { splitRatio: Math.round(ratio * 1000) / 1000 } });
      }
    }, 300);
  }

  /** Stores the sidebar width once the drag pauses (the sidebar itself follows the pointer). */
  setSidebarWidth(width: number): void {
    clearTimeout(this.sidebarWidthTimer);
    this.sidebarWidthTimer = setTimeout(() => {
      const rounded = Math.round(width);
      if (rounded !== this.settings.view.sidebarWidth) {
        void this.patchSettings({ view: { sidebarWidth: rounded } });
      }
    }, 300);
  }

  // ---- what the workspace reports ---------------------------------------------------------------

  attachWorkspace(api: WorkspaceApi): void {
    this.workspace = api;
    for (const wake of this.workspaceWaiters.splice(0)) wake();
  }

  detachWorkspace(api: WorkspaceApi): void {
    if (this.workspace === api) this.workspace = null;
  }

  getTab(id: number): Tab | undefined {
    return this.tabs.find((tab) => tab.id === id);
  }

  patchTab(id: number, patch: Partial<Tab>): void {
    const current = this.tabs.find((tab) => tab.id === id);
    if (!current) return;
    // An outline that did not change keeps its identity, so the sidebar is not redrawn.
    if (patch.headings && sameHeadings(current.headings, patch.headings)) {
      patch = { ...patch, headings: current.headings };
    }
    this.tabs = this.tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab));
    // Crash recovery: saved or undone to the saved text (the entry goes), or made different in
    // another way than typing: a line ending switch, a file gone from disk (the entry starts).
    if ('textDirty' in patch || 'format' in patch || 'missing' in patch) {
      const updated = this.tabs.find((tab) => tab.id === id);
      if (updated && !updated.guide) {
        if (!tabIsDirty(updated)) void this.recovery?.forget(id);
        else if ('format' in patch || 'missing' in patch) this.recoveryEdited(id);
      }
    }
  }

  setOutlineLine(line: number): void {
    if (this.outlineLine !== line) this.outlineLine = line;
  }

  /** Outline click. */
  goToHeading(heading: Heading): void {
    const tab = this.active;
    if (!tab || !this.workspace) return;
    this.outlineLine = heading.line;
    void this.workspace.revealHeading(tab, heading);
  }

  /**
   * Search result click: opens the file (in Split when it is new or in Preview), then both panes
   * go to the line and the editor caret to the match. `line` is 1-based.
   */
  async showSearchHit(path: string, line: number, snippet: string, start: number): Promise<void> {
    await this.openPaths([path], 'split');
    const tab = this.active;
    if (!tab || tab.path !== path) return;
    if (tab.view === 'preview') await this.setViewMode('split');
    const current = this.active;
    if (current && current.id === tab.id)
      this.workspace?.revealMatch(current, line - 1, snippet, start);
  }

  setInserts(items: InsertItem[]): void {
    this.inserts = items;
  }

  /** Runs an Insert menu command on the active document (not in Preview). */
  runInsert(id: string): void {
    const tab = this.active;
    if (tab && this.workspace && tab.view !== 'preview') this.workspace.runInsert(id);
  }

  setCursor(line: number, column: number): void {
    if (this.cursor.line !== line || this.cursor.column !== column) this.cursor = { line, column };
  }

  setSelection(selection: { words: number; characters: number } | null): void {
    this.selection = selection;
  }

  showError(message: string): void {
    this.error = message;
  }

  dismissError(): void {
    this.error = null;
  }

  showNotice(message: string): void {
    this.notice = message;
  }

  dismissNotice(): void {
    this.notice = null;
  }

  dismissBanner(kind: 'legacy' | 'lossy' | 'readOnly'): void {
    const tab = this.active;
    if (tab) this.patchTab(tab.id, { dismissed: { ...tab.dismissed, [kind]: true } });
  }

  openLink(tabId: number, link: PreviewLink): void {
    void this.enqueue(() => this.followLink(tabId, link));
  }

  openWikilink(tabId: number, link: WikilinkTarget): void {
    void this.enqueue(() => this.followWikilinkOf(tabId, link));
  }

  private async followWikilinkOf(tabId: number, link: WikilinkTarget): Promise<void> {
    const tab = this.tabs.find((candidate) => candidate.id === tabId);
    if (!tab?.path) {
      this.error = 'Save this document first. Links to other notes are relative to its folder.';
      return;
    }
    const { followWikilink } = await import('./wikilinks');
    const result = await followWikilink(
      {
        platform: this.platform,
        open: (path) => this.openPaths([path]),
        scrollTo: (id) => this.workspace?.scrollToAnchor(id) ?? Promise.resolve(),
      },
      tab.path,
      link,
    );
    if (result === 'unresolved') this.error = `No note named "${link.target}" was found.`;
  }

  // ---- tabs -----------------------------------------------------------------------------------

  private async ensureWorkspace(): Promise<WorkspaceApi> {
    if (!this.WorkspaceComponent) {
      this.WorkspaceComponent = (await import('./Workspace.svelte')).default;
    }
    if (!this.workspace) await new Promise<void>((resolve) => this.workspaceWaiters.push(resolve));
    return this.workspace as WorkspaceApi;
  }

  /** Makes a tab the one on show. */
  async activate(id: number): Promise<void> {
    if (!this.tabs.some((tab) => tab.id === id)) return;
    if (this.activeId !== null && this.activeId !== id) {
      // Auto-save: the document is written before another one takes its place.
      if (this.autosave) await this.autosave.flush(this.activeId);
      this.saveDocState(this.activeId);
    }
    this.activeId = id;
    this.selection = null;
    const workspace = await this.ensureWorkspace();
    const tab = this.tabs.find((candidate) => candidate.id === id);
    if (tab && this.activeId === id) await workspace.show(tab);
  }

  activateTab(id: number): Promise<unknown> {
    return this.enqueue(() => this.activate(id));
  }

  private cycle(step: 1 | -1): Promise<void> {
    const count = this.tabs.length;
    if (count < 2) return Promise.resolve();
    const index = this.tabs.findIndex((tab) => tab.id === this.activeId);
    const next = this.tabs[(index + step + count) % count];
    return next ? this.activate(next.id) : Promise.resolve();
  }

  private addTab(tab: Tab): void {
    this.tabs = [...this.tabs, tab];
  }

  private untitledNames(): string[] {
    return this.tabs.filter((tab) => tab.path === null).map((tab) => tab.name);
  }

  async newDocument(): Promise<void> {
    const flavor = this.settings.defaultFlavor;
    void loadPipeline(flavor);
    const tab = untitledTab({
      id: this.nextId++,
      name: nextUntitledName(this.untitledNames()),
      text: '',
      view: this.settings.openNewIn,
      flavor,
      reason: 'default',
    });
    // New documents take the line ending of the settings (existing files keep theirs).
    tab.format = { ...tab.format, lineEnding: this.settings.saving.newLineEnding };
    tab.savedLineEnding = this.settings.saving.newLineEnding;
    this.addTab(tab);
    await this.activate(tab.id);
    // A new document is for typing: the caret is in the editor right away.
    if (this.activeId === tab.id && tab.view !== 'preview') this.workspace?.focusEditor();
  }

  async openGuide(): Promise<void> {
    // The guide of the flavor of the document on show (GFM without a document).
    const flavor = guideFlavor(this.active?.flavor);
    const existing = this.tabs.find((tab) => tab.guide && tab.flavor === flavor);
    if (existing) return this.activate(existing.id);
    const text = await loadGuide(flavor);
    void loadPipeline(flavor);
    const tab = untitledTab({
      id: this.nextId++,
      name: guideName(flavor),
      text,
      view: 'preview',
      flavor,
      reason: 'default',
      guide: true,
    });
    this.addTab(tab);
    await this.activate(tab.id);
  }

  /**
   * Opens files (from the dialog, Finder, the recents, a link): a file that is open is activated,
   * the others are read into new tabs, and the last one is shown. A file that cannot be read
   * gives an error banner and the rest still open.
   */
  async openPaths(paths: readonly string[], view?: ViewMode): Promise<void> {
    let show: number | null = null;
    for (const path of paths) {
      const open = this.tabs.find((tab) => tab.path === path);
      if (open) {
        show = open.id;
        continue;
      }
      // A file open in another window is shown there: it is never open twice.
      if (await this.heldElsewhere(path)) continue;
      try {
        const tab = await this.readTab(path, view);
        const duplicate = this.tabs.find((candidate) => candidate.path === tab.path);
        if (duplicate) {
          show = duplicate.id;
        } else {
          this.addTab(tab);
          show = tab.id;
        }
      } catch (error) {
        if (!isCancelled(error)) this.error = errorMessage(error);
      }
    }
    if (show !== null) await this.activate(show);
  }

  private async heldElsewhere(path: string): Promise<boolean> {
    try {
      return await this.platform.focusOpenDocument(path);
    } catch {
      return false;
    }
  }

  private async readTab(path: string, view: ViewMode | undefined): Promise<Tab> {
    const file = await this.platform.readDocument(path);
    const [context, state] = await Promise.all([
      this.platform.documentContext(file.path),
      this.platform.getDocState(file.path),
    ]);
    const detected = detectFlavor({
      path: file.path,
      text: file.text,
      chosen: state.flavor,
      defaultFlavor: this.settings.defaultFlavor,
      autoDetect: this.settings.preview.autoDetectFlavor,
      inObsidianVault: context.obsidianVault,
    });
    void loadPipeline(detected.flavor);
    const tab = fileTab(this.nextId++, file, context, view ?? this.settings.openExistingIn, {
      flavor: detected.flavor,
      reason: detected.reason,
      chosen: state.flavor,
    });
    // Where the reader left off, unless the file has become shorter than that.
    const lines = countLines(file.text);
    if (state.cursor && state.cursor.line <= lines) tab.restoreCursor = { ...state.cursor };
    if (state.scrollLine && state.scrollLine <= lines) tab.editorTopLine = state.scrollLine - 1;
    return tab;
  }

  /** Remembers the caret and the top line of a saved document (tab switch, close, quit). */
  private saveDocState(id: number): void {
    const tab = this.tabs.find((candidate) => candidate.id === id);
    if (!tab?.path || !this.workspace) return;
    const position = this.workspace.position(id);
    if (!position) return;
    void this.platform
      .setDocState(tab.path, {
        cursor: position.cursor,
        scrollLine: Math.floor(position.topLine) + 1,
      })
      .catch(() => {});
  }

  /** Close Tab: asks about unsaved changes first. False when the person cancelled. */
  async closeTab(id: number): Promise<boolean> {
    if (this.autosave && this.activeId === id) await this.autosave.flush(id);
    this.autosave?.cancel(id);
    const tab = this.tabs.find((candidate) => candidate.id === id);
    if (!tab) return true;
    if (tabIsDirty(tab)) {
      const result = await walkUnsaved([tab.id], this.walkDeps());
      if (!result.completed) return false;
    }
    await this.removeTab(id);
    await this.closeIfEmpty();
    return true;
  }

  /** The last tab of a window other than `main` is gone: the window goes with it. */
  private async closeIfEmpty(): Promise<void> {
    if (this.isMain || this.tabs.length > 0) return;
    await this.platform.finishClose('window');
  }

  // ---- several windows (Phase 5) ------------------------------------------------------------

  /** Move Tab to New Window for the tab on show (menu, palette). */
  moveActiveTabToNewWindow(): Promise<void> {
    return this.active ? this.moveTabToNewWindow(this.active.id) : Promise.resolve();
  }

  /** The tab context menu and the commands: runs one at a time with the other document tasks. */
  moveTabToNewWindowQueued(id: number): Promise<unknown> {
    return this.enqueue(() => this.moveTabToNewWindow(id));
  }

  /**
   * The tab (text, undo history, cursor, scroll, flavor, view, unsaved state) moves to a new
   * window beside this one. It needs another tab to stay behind. The document is not closed: no
   * question is asked, and an unsaved tab stays unsaved over there.
   */
  async moveTabToNewWindow(id: number): Promise<void> {
    const tab = this.tabs.find((candidate) => candidate.id === id);
    if (!tab || this.tabs.length < 2) return;
    if (this.autosave && this.activeId === id) await this.autosave.flush(id);
    const current = this.tabs.find((candidate) => candidate.id === id) ?? tab;
    const exported = this.workspace?.exportTab(id) ?? null;
    const position = this.workspace?.position(id) ?? null;
    const fields = movedFields(current);
    if (position) {
      fields.editorTopLine = position.topLine;
      fields.previewScrollTop = position.previewScrollTop;
    }
    const text = exported?.text ?? current.initialText ?? '';
    const transfer: TabTransfer = {
      kind: 'tab',
      path: current.path,
      text,
      savedText: exported?.savedText ?? text,
      editorState: exported?.editorState ?? null,
      tab: fields,
    };
    await this.platform.moveTab(transfer);
    this.autosave?.cancel(id);
    await this.removeTab(id);
  }

  /** What waits for this window at startup: a moved tab, or the tabs of a restored session. */
  private async openTransfer(transfer: WindowTransfer): Promise<void> {
    if (transfer.kind === 'session') {
      await this.openSessionTabs(transfer.tabs, transfer.active);
      return;
    }
    const tab = tabFromTransfer(this.nextId++, transfer);
    void loadPipeline(tab.flavor);
    this.addTab(tab);
    await this.activate(tab.id);
    // A moved unsaved tab is kept by this window from now on.
    if (tabIsDirty(tab)) this.recoveryEdited(tab.id);
  }

  closeTabById(id: number): Promise<unknown> {
    return this.enqueue(() => this.closeTab(id));
  }

  private async removeTab(id: number): Promise<void> {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const wasActive = this.activeId === id;
    void this.recovery?.forget(id);
    const remaining = this.tabs.filter((tab) => tab.id !== id);
    const next = wasActive ? (remaining[index] ?? remaining[index - 1] ?? null) : null;
    this.saveDocState(id);
    this.workspace?.drop(id);
    // The next tab becomes active in the same step: with no active tab for a moment the
    // workspace would be taken down and made again.
    if (wasActive && next) this.activeId = next.id;
    this.tabs = remaining;
    if (!wasActive) return;
    if (next) {
      await this.activate(next.id);
    } else {
      this.activeId = null;
      this.selection = null;
      this.cursor = { line: 1, column: 1 };
    }
  }

  private walkDeps() {
    return {
      activate: (id: number) => this.activate(id),
      ask: (id: number): Promise<CloseAnswer> => {
        const tab = this.tabs.find((candidate) => candidate.id === id);
        return this.platform.confirmUnsaved(tab?.name ?? 'this document');
      },
      save: (id: number) => this.saveTab(id, false),
    };
  }

  /** Close Window or Quit: asks about every document with unsaved changes, in tab order. */
  async closeRequested(reason: CloseReason): Promise<void> {
    if (this.autosave) await this.autosave.flush(this.activeId);
    const dirty = this.tabs.filter(tabIsDirty).map((tab) => tab.id);
    let completed = false;
    try {
      completed = (await walkUnsaved(dirty, this.walkDeps())).completed;
    } catch (error) {
      // A question or a save that failed unexpectedly must not leave a quit waiting.
      this.error = errorMessage(error);
    }
    if (completed) {
      // A clean close: nothing is left to recover (Don't Save was a decision).
      await this.recovery?.forgetAll();
      for (const tab of this.tabs) this.saveDocState(tab.id);
      // A window closed on its own is not part of the next session (Rust forgets it); `main` is.
      if (reason === 'quit' || this.isMain) await this.saveLastSession();
      await this.platform.finishClose(reason);
    } else await this.platform.cancelClose(reason);
  }

  // ---- saving ---------------------------------------------------------------------------------

  /** Saves a tab (Save As for a document without a file, a read-only one, or when asked to). */
  async saveTab(id: number, forceAs: boolean): Promise<boolean> {
    if (this.activeId !== id) await this.activate(id);
    const tab = this.tabs.find((candidate) => candidate.id === id);
    if (!tab || !this.workspace) return false;
    if (!tab.path || tab.readOnly || forceAs) return this.saveAs(tab);
    return this.writeTo(tab, tab.path, tab.modifiedMs);
  }

  private async saveAs(tab: Tab): Promise<boolean> {
    const workspace = this.workspace;
    if (!workspace) return false;
    const { text } = workspace.snapshot();
    const suggestedName = tab.path ? fileName(tab.path) : suggestSaveName(text);
    // An untitled document starts in the default folder (Rust checks that it exists).
    const directory = tab.path ? directoryOf(tab.path) : this.settings.saving.defaultFolder;
    const chosen = await this.platform.saveDialog({ suggestedName, directory });
    if (!chosen) return false;
    // New documents take the final newline setting (existing files keep theirs).
    if (!tab.path) workspace.applyFinalNewline(this.settings.saving.newFinalNewline);
    const oldPath = tab.path;
    const saved = await this.writeTo(tab, chosen, null);
    if (saved && chosen !== oldPath) await this.afterPathChanged(tab.id);
    return saved;
  }

  /**
   * `quiet` is auto-save: it never asks. A file changed on disk raises the banner instead, and
   * a read-only or lossy one is left alone. `overwrite` (Keep Mine) writes over a newer file.
   */
  private async writeTo(
    tab: Tab,
    path: string,
    expected: number | null,
    quiet = false,
    overwrite = false,
  ): Promise<boolean> {
    const workspace = this.workspace;
    if (!workspace) return false;
    const options: SaveOptions = { expectedModifiedMs: expected };
    if (overwrite) options.overwriteExternalChange = true;
    if (tab.lossy) {
      if (quiet && !tab.lossyAccepted) return false;
      if (!tab.lossyAccepted && !(await this.askSaveLossy())) return false;
      this.patchTab(tab.id, { lossyAccepted: true });
      options.allowLossy = true;
    }
    const snapshot = workspace.snapshot();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await this.platform.saveDocument(path, snapshot.text, tab.format, options);
        snapshot.commit();
        this.patchTab(tab.id, {
          path: result.path,
          name: fileName(result.path),
          modifiedMs: result.modifiedMs,
          savedAtMs: Date.now(),
          savedLineEnding: tab.format.lineEnding,
          legacyEncoding: null,
          lossy: false,
          lossyAccepted: false,
          readOnly: false,
          missing: false,
          externalChange: false,
        });
        this.now = Date.now();
        return true;
      } catch (error) {
        const code = (error as { code?: string } | null)?.code;
        if (quiet && code === 'modified-externally') {
          this.patchTab(tab.id, { externalChange: true, missing: false });
          return false;
        }
        if (quiet && (code === 'lossy' || code === 'read-only')) {
          if (code === 'read-only') this.patchTab(tab.id, { readOnly: true });
          return false;
        }
        if (code === 'modified-externally' && !options.overwriteExternalChange) {
          const overwrite = await this.platform.ask({
            title: 'The file changed on disk since you opened it',
            message: 'Saving now replaces the version on disk with the one in Writedown.',
            ok: 'Overwrite',
            cancel: 'Cancel',
          });
          if (!overwrite) return false;
          options.overwriteExternalChange = true;
          continue;
        }
        if (code === 'lossy' && !options.allowLossy) {
          if (!(await this.askSaveLossy())) return false;
          options.allowLossy = true;
          continue;
        }
        if (code === 'read-only') {
          this.patchTab(tab.id, { readOnly: true });
          const current = this.tabs.find((candidate) => candidate.id === tab.id);
          return current ? this.saveAs(current) : false;
        }
        if (!isCancelled(error)) this.error = errorMessage(error);
        return false;
      }
    }
    return false;
  }

  private askSaveLossy(): Promise<boolean> {
    return this.platform.ask({
      title: 'Some characters in this file could not be read',
      message:
        'They were replaced when the file was opened. Saving makes the replacement permanent.',
      ok: 'Save Anyway',
      cancel: 'Cancel',
    });
  }

  /** After Save As: the flavor follows the new name, and a chosen flavor is kept for the new path. */
  private async afterPathChanged(id: number): Promise<void> {
    const tab = this.tabs.find((candidate) => candidate.id === id);
    if (!tab?.path || !this.workspace) return;
    const context = await this.platform.documentContext(tab.path);
    if (tab.chosenFlavor) {
      await this.platform.setDocState(tab.path, { flavor: tab.chosenFlavor });
    }
    const text = this.workspace.snapshot().text;
    const detected = detectFlavor({
      path: tab.path,
      text,
      chosen: tab.chosenFlavor,
      defaultFlavor: this.settings.defaultFlavor,
      autoDetect: this.settings.preview.autoDetectFlavor,
      inObsidianVault: context.obsidianVault,
    });
    this.patchTab(id, {
      location: context.location,
      flavor: detected.flavor,
      reason: detected.reason,
    });
    const updated = this.tabs.find((candidate) => candidate.id === id);
    if (updated) {
      this.workspace.pathChanged(updated);
      await this.workspace.applyFlavor(updated);
    }
  }

  // ---- file operations from the Files sidebar and the File menu (WP3.2) ---------------------------
  /**
   * A file or folder was renamed or moved: every open tab at or below the old path follows (path,
   * title, flavor detection). Recents, document state and grants follow in the platform.
   */
  async followPath(oldPath: string, newPath: string): Promise<void> {
    const prefix = `${oldPath}/`;
    for (const tab of this.tabs) {
      if (tab.path === null) continue;
      if (tab.path !== oldPath && !tab.path.startsWith(prefix)) continue;
      const next = tab.path === oldPath ? newPath : `${newPath}${tab.path.slice(oldPath.length)}`;
      this.patchTab(tab.id, { path: next, name: fileName(next) });
      await this.afterPathChanged(tab.id);
    }
  }
  /**
   * A file or folder went to the Trash: a clean open tab at or below it closes, an unsaved one
   * stays open and is marked as missing from disk.
   */
  async pathTrashed(path: string): Promise<void> {
    const prefix = `${path}/`;
    const affected = this.tabs.filter(
      (tab) => tab.path !== null && (tab.path === path || tab.path.startsWith(prefix)),
    );
    for (const tab of affected) {
      if (tabIsDirty(tab)) this.patchTab(tab.id, { missing: true });
      else await this.removeTab(tab.id);
    }
    await this.closeIfEmpty();
  }
  /** Revert to Saved: the file is read again into the same position of the tab strip. */
  async revertTab(id: number, keepPosition = false): Promise<void> {
    const old = this.tabs.find((tab) => tab.id === id);
    if (!old?.path) return;
    const position = keepPosition ? (this.workspace?.position(id) ?? null) : null;
    const fresh = await this.readTab(old.path, old.view);
    void this.recovery?.forget(id);
    const replacement: Tab = { ...fresh, chosenFlavor: old.chosenFlavor };
    if (position) {
      // The same line of the new text (the last one when it became shorter).
      const lines = countLines(fresh.initialText ?? '');
      replacement.restoreCursor = {
        line: Math.min(position.cursor.line, lines),
        column: position.cursor.column,
      };
      replacement.editorTopLine = position.topLine;
      replacement.previewScrollTop = position.previewScrollTop;
    }
    const wasActive = this.activeId === id;
    this.workspace?.drop(id);
    this.tabs = this.tabs.map((tab) => (tab.id === id ? replacement : tab));
    if (wasActive) {
      this.activeId = replacement.id;
      this.selection = null;
      const workspace = await this.ensureWorkspace();
      await workspace.show(replacement);
    }
  }
  /** Opens an existing file in Split (a file just created or duplicated). */
  async openInSplit(path: string): Promise<void> {
    await this.openPaths([path], 'split');
  }
  // ---- external changes, the watch set and the session (WP3.7) ----------------------------------

  /** The files to watch changed (a tab opened, closed or saved elsewhere, a folder opened). */
  scheduleWatch(): void {
    clearTimeout(this.watchTimer);
    this.watchTimer = setTimeout(() => void this.sendWatchSet(), WATCH_DEBOUNCE_MS);
  }

  /**
   * Sends the whole watch set: the open documents, the linked files their previews fetched and
   * the open folder. What to do with the watcher's batches lives in `watch.ts`, a lazy chunk that
   * loads when the first batch arrives, so a document that nobody changes never loads it.
   */
  private async sendWatchSet(): Promise<void> {
    if (!this.listeningToFiles) {
      this.listeningToFiles = true;
      try {
        this.stopFileChanges = await this.platform.onFileChanged((changes) => {
          void import('./watch').then(({ handleChanges }) => handleChanges(this, changes));
        });
      } catch {
        return;
      }
    }
    const set = {
      documents: [
        ...new Set(this.tabs.flatMap((tab) => (tab.path !== null ? [tab.path] : []))),
      ].sort(),
      linked: [...new Set(this.linkedPaths())].sort(),
      folder: this.openFolderPath ?? this.launch.folderPath ?? null,
    };
    const key = JSON.stringify(set);
    if (key === this.sentWatchKey) return;
    this.sentWatchKey = key;
    try {
      await this.platform.watch(set);
    } catch {
      // The watcher is a convenience; a failure leaves the documents as they are.
      this.sentWatchKey = '';
    }
  }

  /** The open documents and the folder: when either changes the watch set is sent again. */
  private syncWatch(): void {
    const paths = this.tabs.flatMap((tab) => (tab.path ? [tab.path] : []));
    const folder = this.openFolderPath ?? this.launch.folderPath ?? null;
    const key = JSON.stringify([paths, folder]);
    if (key === this.lastWatchKey) return;
    const hadAny = this.lastWatchKey !== '';
    this.lastWatchKey = key;
    // Nothing to watch and nothing watched before: the watcher chunk is not needed.
    if (paths.length > 0 || folder !== null || hadAny) this.scheduleWatch();
  }

  /** The files that documents fetched for their previews (bibliographies, includes). */
  linkedPaths(): string[] {
    return this.workspace?.linkedPaths() ?? [];
  }

  linkedFilesChanged(): void {
    this.scheduleWatch();
  }

  /** The text of a tab as it is in the editor now, or null when it was never shown. */
  tabText(id: number): string | null {
    return this.workspace?.textOf(id) ?? null;
  }

  /** Fetches the files a document refers to again, when one of them changed. */
  async refreshLinked(paths: readonly string[], structural: boolean): Promise<void> {
    await this.workspace?.refreshContext(paths, structural);
  }

  /** Reload on the external change banner (and the silent reload): the file replaces the tab. */
  reloadTab(id: number): Promise<unknown> {
    return this.enqueue(() => this.revertTab(id, true));
  }

  /** Keep Mine: the editor keeps its text; the next save asks about the newer file on disk. */
  keepMine(id: number): void {
    this.patchTab(id, { externalChange: false });
    // With auto-save on, keeping the editor's text saves it over the newer file now.
    if (this.autosave) void this.enqueue(() => this.saveQuietly(id, true));
  }

  /** Reopens the last session; tabs whose files are gone are skipped without a message. */
  private async restoreLastSession(): Promise<void> {
    const { restoreSession } = await import('./session');
    await restoreSession(this);
  }

  /** Stores the session for the next launch. */
  private async saveLastSession(): Promise<void> {
    try {
      const { saveSession } = await import('./session');
      await saveSession(this);
    } catch {
      // The session is a convenience: quitting must not wait on it.
    }
  }

  /**
   * Opens the tabs of a stored session (quietly skipping files that cannot be read) and shows the
   * one that was active.
   */
  async openSessionTabs(entries: readonly SessionTab[], active: number): Promise<void> {
    const activePath = entries[active]?.path;
    let show: number | null = null;
    for (const entry of entries) {
      if (this.tabs.some((tab) => tab.path === entry.path)) continue;
      try {
        const tab = await this.readTab(entry.path, entry.view);
        if (this.tabs.some((candidate) => candidate.path === tab.path)) continue;
        this.addTab(tab);
        if (entry.path === activePath || show === null) show = tab.id;
      } catch {
        // Moved, deleted or no longer readable: skipped.
      }
    }
    if (show !== null) await this.activate(show);
  }

  // ---- title bar and status bar actions --------------------------------------------------------

  /** The pill: a flavor for this document, or null to detect it again. */
  async chooseFlavor(flavor: FlavorId | null): Promise<void> {
    const tab = this.active;
    if (!tab || !this.workspace) return;
    let next: { flavor: FlavorId; reason: Tab['reason'] };
    if (flavor) {
      next = { flavor, reason: 'chosen' };
    } else {
      const context = tab.path ? await this.platform.documentContext(tab.path) : null;
      next = detectFlavor({
        path: tab.path,
        text: this.workspace.snapshot().text,
        chosen: null,
        defaultFlavor: this.settings.defaultFlavor,
        autoDetect: this.settings.preview.autoDetectFlavor,
        inObsidianVault: context?.obsidianVault ?? false,
      });
    }
    this.patchTab(tab.id, { chosenFlavor: flavor, ...next });
    if (tab.path) await this.platform.setDocState(tab.path, { flavor });
    const updated = this.tabs.find((candidate) => candidate.id === tab.id);
    if (updated) await this.workspace.applyFlavor(updated);
  }

  chooseFlavorQueued(flavor: FlavorId | null): Promise<unknown> {
    return this.enqueue(() => this.chooseFlavor(flavor));
  }

  setDefaultFlavor(flavor: FlavorId): Promise<unknown> {
    return this.enqueue(() => this.patchSettings({ defaultFlavor: flavor }));
  }

  toggleLineEnding(): void {
    const tab = this.active;
    if (!tab) return;
    const lineEnding = tab.format.lineEnding === 'lf' ? 'crlf' : 'lf';
    this.patchTab(tab.id, { format: { ...tab.format, lineEnding } });
  }

  /** The Preferences button of the toolbar: the same window as the menu item. */
  async openPreferences(): Promise<void> {
    try {
      await this.platform.openPreferences();
    } catch (error) {
      this.error = errorMessage(error);
    }
  }

  async setZoom(zoom: number): Promise<void> {
    await this.patchSettings({ view: { zoom } });
  }

  async openRecent(path: string): Promise<void> {
    const granted = await this.platform.openRecent(path);
    await this.openPaths([granted]);
  }

  openRecentQueued(path: string): Promise<unknown> {
    return this.enqueue(() => this.openRecent(path));
  }

  clearRecents(): Promise<unknown> {
    return this.enqueue(() => this.platform.clearRecents());
  }

  async revealActive(): Promise<void> {
    const path = this.active?.path;
    if (path) await this.platform.revealInFinder(path);
  }

  async copyActivePath(): Promise<void> {
    const path = this.active?.path;
    if (!path) return;
    try {
      await this.platform.writeClipboard({ text: path });
    } catch {
      this.error = 'The path could not be copied.';
    }
  }

  /** The buttons of the title bar, the tab strip and the welcome screen: same path as the menu. */
  run(action: MenuAction): Promise<unknown> {
    return this.enqueue(() => this.handleAction(action));
  }

  openFiles(): Promise<unknown> {
    return this.run('open');
  }

  // ---- menu actions -----------------------------------------------------------------------------

  async handleAction(action: MenuAction): Promise<void> {
    await this.commandMap.get(action)?.run();
  }

  /** The command with this id (a menu action or a palette-only command). */
  command(id: string): Command | undefined {
    return this.commandMap.get(id);
  }

  /** Every command, for the palette. */
  get commands(): readonly Command[] {
    return this.commandList;
  }

  /** The Open dialog (File > Open…). */
  async openFilesDialog(): Promise<void> {
    const paths = await this.platform.openDialog({ multiple: true });
    if (paths.length > 0) await this.openPaths(paths);
  }

  async closeActiveTab(): Promise<void> {
    if (this.active) await this.closeTab(this.active.id);
  }

  async saveActive(forceAs: boolean): Promise<void> {
    if (this.active) await this.saveTab(this.active.id, forceAs);
  }

  /** The editor is on show and the active document can be formatted. */
  get canFormat(): boolean {
    return this.menuState.canFormat;
  }

  /** A format command (Bold, Heading 2, ...) in the editor; nothing in Preview. */
  runFormat(action: MenuAction): void {
    const tab = this.active;
    if (tab && this.workspace && tab.view !== 'preview')
      this.workspace.run(action as FormatCommand);
  }

  undo(): void {
    this.workspace?.undo();
  }

  redo(): void {
    this.workspace?.redo();
  }

  /** The preview's pieces for the find bar (null before a document is shown). */
  previewFindHost(): PreviewFindHost | null {
    return this.workspace?.previewFindHost() ?? null;
  }

  /** The document for export, print and Copy as HTML (null before a document is shown). */
  exportSource(): ExportSource | null {
    return this.workspace?.exportSource() ?? null;
  }

  /** Find goes to the preview: in Preview view, or in Split with the focus in the preview pane. */
  previewFindWanted(): boolean {
    const view = this.active?.view;
    if (view === 'preview') return true;
    if (view !== 'split') return false;
    return document.activeElement?.closest('section[aria-label="Preview"]') != null;
  }

  /** The editor's own find commands (not in Preview). */
  findAction(action: MenuAction): void {
    const tab = this.active;
    const workspace = this.workspace;
    if (!tab || !workspace || tab.view === 'preview') return;
    if (action === 'find') workspace.openSearch(false);
    else if (action === 'find-replace') workspace.openSearch(true);
    else if (action === 'find-next') workspace.findNext();
    else workspace.findPrevious();
  }

  /** View > Exact Preview (Pandoc): per window, not stored. */
  toggleExactPreview(): void {
    if (!this.canExactPreview && !this.exactPreview) return;
    this.exactPreview = !this.exactPreview;
  }

  /** The workspace asks whether the exact preview should show now. */
  exactPreviewWanted(): boolean {
    return this.exactPreviewActive;
  }

  async setViewMode(mode: ViewMode): Promise<void> {
    if (this.active && this.workspace) await this.workspace.setView(this.active, mode);
  }

  stepZoom(direction: 1 | -1): Promise<void> {
    return this.setZoom(stepZoom(this.settings.view.zoom, direction));
  }

  cycleTab(step: 1 | -1): Promise<void> {
    return this.cycle(step);
  }

  /** Shows a sidebar tab, and the sidebar if it was hidden (the palette commands). */
  async showSidebarTab(tab: SidebarTab): Promise<void> {
    this.setSidebarTab(tab);
    if (!this.settings.view.sidebarVisible) {
      await this.patchSettings({ view: { sidebarVisible: true } });
    }
  }

  setSidebarTab(tab: SidebarTab): void {
    this.sidebarTab = tab;
  }

  // ---- links in the preview -----------------------------------------------------------------------

  private async followLink(tabId: number, link: PreviewLink): Promise<void> {
    const tab = this.tabs.find((candidate) => candidate.id === tabId);
    switch (link.kind) {
      case 'external':
        await this.platform.openExternal(link.href);
        return;
      case 'anchor':
        await this.workspace?.scrollToAnchor(decodeFragment(link.href.slice(1)));
        return;
      case 'document': {
        if (!tab?.path) {
          this.error = 'Save this document first. Links to other files are relative to its folder.';
          return;
        }
        const path = await this.platform.openLinkedDocument(tab.path, link.href);
        await this.openPaths([path]);
        const hash = link.href.indexOf('#');
        if (hash >= 0)
          await this.workspace?.scrollToAnchor(decodeFragment(link.href.slice(hash + 1)));
        return;
      }
      case 'file': {
        if (!tab?.path) {
          this.error = 'Save this document first. Links to other files are relative to its folder.';
          return;
        }
        const reveal = await this.platform.ask({
          title: 'Show this file in Finder?',
          message: `${link.href} is not a Markdown file, so Writedown cannot open it.`,
          ok: 'Show in Finder',
          cancel: 'Cancel',
        });
        if (reveal) await this.platform.revealLinkedFile(tab.path, link.href);
        return;
      }
    }
  }
}

/** The number of lines of a text, counted the way the editor counts them. */
function countLines(text: string): number {
  let lines = 1;
  for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) lines++;
  return lines;
}

function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}
