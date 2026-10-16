/**
 * The editor and the preview of the main window, shared by every tab.
 *
 * One `EditorView` and one `PreviewController` serve all documents (memory rule): a tab keeps its
 * `EditorState` (text, selection, undo history), and showing a tab swaps that state in and
 * renders the preview once. Background tabs hold nothing else.
 *
 * Components stay thin: `Workspace.svelte` gives this controller its DOM elements. All behavior
 * (switching, dirty tracking, preview clicks, timing marks, the typing benchmark) lives here, and
 * what the shell needs to know goes through `WorkspaceHost`.
 */

import { type EditorState, Text } from '@codemirror/state';
import { tick } from 'svelte';
import type { FormatCommand } from '@/editor/commands';
import { EditorController } from '@/editor/controller';
import { pastedImageName, stemOf } from '@/editor/image-input';
import type { ImageDrop, Settings, ViewMode } from '@/lib/platform';
import { afterNextPaint, whenSettled } from '@/perf/marks';
import { type BenchTarget, runTypingBench } from '@/perf/typing-bench';
import { linkFromEvent, PreviewController, taskLineFromEvent } from '@/preview/controller';
import { embedsUse } from '@/preview/embed-links';
import type { PreviewFindHost } from '@/preview/find/types';
import { loadPipeline } from '@/preview/pipeline';
import type { Analysis, DocContext, Heading, Pipeline } from '@/preview/types';
import { ContextFetcher } from './context';
import { noteHeadingsFor } from './noteheadings';
import { sourceLineOfClick } from './preview-click';
import { ScrollSync } from './scrollsync';
import type { Tab } from './tab';
import type { ExportSource, TabPosition, WorkspaceApi, WorkspaceHost } from './types';

export interface WorkspaceHosts {
  /** Receives the CodeMirror editor. */
  editor: HTMLElement;
  /** The `<article>` whose children are the rendered preview. */
  preview: HTMLElement;
  /** The element that scrolls the preview. */
  previewScroll: HTMLElement;
}

/** How long a selection must stay put before its words are counted. */
const SELECTION_DEBOUNCE_MS = 200;
/** Scroll events this soon after an outline click are the click's own. */
const HEADING_JUMP_MUTE_MS = 250;
/** How often the position of a heading is measured again after a jump (frames). */
const HEADING_JUMP_RETRIES = 3;

/** The state with the caret at a saved position; a line past the end leaves the caret at the top. */
function withCaret(state: EditorState, cursor: Tab['restoreCursor']): EditorState {
  if (!cursor || cursor.line < 1 || cursor.line > state.doc.lines) return state;
  const line = state.doc.line(cursor.line);
  const anchor = line.from + Math.max(0, Math.min(cursor.column, line.length));
  return state.update({ selection: { anchor } }).state;
}

function imageError(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : '';
  return message === ''
    ? 'The image could not be saved.'
    : `The image could not be saved. ${message}`;
}

export class WorkspaceController implements WorkspaceApi {
  private readonly host: WorkspaceHost;
  private readonly hosts: WorkspaceHosts;
  private readonly editor: EditorController;
  private preview: PreviewController | undefined;
  private pipeline: Pipeline | undefined;
  /** What the packs need from outside the documents (bibliographies, includes, vault). */
  private readonly fetcher: ContextFetcher;
  private lastContext: DocContext | undefined;
  private completionSignature: string | null = null;
  private readonly states = new Map<number, EditorState>();
  /** The document of each tab as of its last save or load, for the dirty check. */
  private readonly saved = new Map<number, Text>();
  private currentId: number | null = null;
  private mode: ViewMode = 'split';
  private switching = false;
  private lastDirty = false;
  private renderCount = 0;
  private headings: Heading[] = [];
  private scroll: ScrollSync | undefined;
  /** The exact preview (Pandoc), a lazy module that exists only while it is on. */
  private exact: import('@/preview/pandoc-preview').PandocPreview | null = null;
  private exactLoading = false;
  private stopExactScroll: (() => void) | null = null;
  private exactFrame = 0;
  /** The caret line (0-based) for the preview's cursor block and the outline. */
  private cursorLine = 0;
  private highlightFrame = 0;
  private syncWasOn: boolean;
  private selectionTimer: ReturnType<typeof setTimeout> | undefined;
  private selectionShown = false;
  private readonly renderListeners = new Set<(renderMs: number) => void>();
  private applied: Settings['editor'] | null = null;
  private appliedShortcuts = '{}';
  private startup: {
    perf: boolean;
    bench: boolean;
    benchSearch?: string | null;
    benchPdf?: string | null;
  } | null = null;
  private startupChecked = false;
  private startupFlow = false;
  private pageHidden = document.visibilityState === 'hidden';
  private destroyed = false;
  private readonly stopSelection: () => void;
  private readonly stopInserts: () => void;

  constructor(hosts: WorkspaceHosts, host: WorkspaceHost) {
    this.host = host;
    this.hosts = hosts;
    this.fetcher = new ContextFetcher(
      host.platform,
      (tabId) => {
        // Something a document needs has arrived: render again with it.
        if (!this.destroyed && tabId === this.currentId) {
          this.preview?.renderNow();
          this.exact?.renderNow();
        }
      },
      () => {
        if (!this.destroyed) this.host.linkedFilesChanged();
      },
    );
    this.editor = new EditorController({
      parent: hosts.editor,
      doc: '',
      onChange: () => this.documentChanged(),
      onCursor: () => {},
    });
    this.stopSelection = this.editor.onSelection((info) => {
      this.host.setCursor(info.line + 1, info.column + 1);
      this.selectionChanged(info.selectedText);
      this.cursorMoved(info.line);
    });
    this.stopInserts = this.editor.onInserts((inserts) =>
      this.host.setInserts(inserts.map(({ id, label, icon }) => ({ id, label, icon }))),
    );
    this.editor.onImages((files, pos, source) => void this.pasteImages(files, pos, source));
    this.syncWasOn = host.settings.view.syncScroll;
    this.scroll = new ScrollSync({
      editor: this.editor,
      scroller: hosts.previewScroll,
      article: hosts.preview,
      following: () =>
        this.exact === null &&
        this.mode === 'split' &&
        this.host.settings.view.syncScroll &&
        this.previewWanted(),
      previewOnly: () => this.mode === 'preview' && this.exact === null,
      completeNow: () => this.preview?.completeNow(),
      onPreviewLine: (line) => this.host.setOutlineLine(line),
    });
    this.applySettings(host.settings);

    // Nothing in a document may navigate the window. Clicks are handled here, in capture order.
    hosts.preview.addEventListener('click', this.onPreviewClick);
    hosts.preview.addEventListener('auxclick', this.onPreviewAuxClick);
    hosts.preview.addEventListener('keydown', this.onPreviewKeyDown);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  // ---- images pasted or dropped into the editor --------------------------------------------

  /** The saved document on show that images can go next to, or null (and the reader is told). */
  private imageTarget(): { id: number; path: string } | null {
    const tab = this.currentId === null ? undefined : this.host.getTab(this.currentId);
    if (!tab || this.mode === 'preview') return null;
    if (!tab.path) {
      this.host.showError(
        'Save the document first. Pasted and dropped images are saved in an “assets” folder next to it.',
      );
      return null;
    }
    return { id: tab.id, path: tab.path };
  }

  /** Image files from a paste or a drop on the page: saved next to the document, then linked. */
  private async pasteImages(files: File[], pos: number, source: 'paste' | 'drop'): Promise<void> {
    const target = this.imageTarget();
    if (!target) return;
    const links: Array<{ src: string; alt: string }> = [];
    for (const file of files) {
      const name = source === 'paste' ? pastedImageName() : stemOf(file.name);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const src = await this.host.platform.savePastedImage(target.path, bytes, name);
        links.push({ src, alt: source === 'paste' ? '' : name });
      } catch (error) {
        this.host.showError(imageError(error));
      }
    }
    this.insertImages(target.id, pos, links);
  }

  /** Image files dropped on the window (paths from Rust): linked, or copied next to the document. */
  async dropImages(drop: ImageDrop): Promise<void> {
    if (this.destroyed) return;
    const target = this.imageTarget();
    if (!target) return;
    const pos =
      this.editor.posAtPoint(drop.x, drop.y) ?? this.editor.getState().selection.main.head;
    const links: Array<{ src: string; alt: string }> = [];
    for (const path of drop.paths) {
      try {
        const src = await this.host.platform.importDroppedImage(target.path, path);
        links.push({ src, alt: stemOf(path.slice(path.lastIndexOf('/') + 1)) });
      } catch (error) {
        this.host.showError(imageError(error));
      }
    }
    this.insertImages(target.id, pos, links);
  }

  private insertImages(id: number, pos: number, links: Array<{ src: string; alt: string }>): void {
    // Another tab came on show while the images were saved: they stay in the folder, unlinked.
    if (this.destroyed || this.currentId !== id || links.length === 0) return;
    this.editor.insertImageLinks(pos, links);
  }

  // ---- showing a tab ------------------------------------------------------------------------

  async show(tab: Tab): Promise<void> {
    if (this.destroyed) return;
    if (!this.startupChecked) {
      this.startupChecked = true;
      this.startup = this.host.takeStartup();
    }
    if (this.currentId === tab.id && this.preview) return; // already on show
    this.leave(tab.id);
    this.currentId = tab.id;
    this.switching = true;
    let first = false;
    try {
      let state = this.states.get(tab.id);
      if (!state) {
        // A tab moved here from another window brings its state, undo history included.
        const moved = tab.transfer
          ? EditorController.stateFromJSON(tab.transfer.editorState, tab.flavor)
          : null;
        if (moved && tab.transfer) {
          state = moved;
          this.saved.set(tab.id, Text.of(tab.transfer.savedText.split('\n')));
        } else {
          state = EditorController.createState(tab.initialText ?? '', tab.flavor);
          state = withCaret(state, tab.restoreCursor);
          this.saved.set(tab.id, state.doc);
        }
        this.states.set(tab.id, state);
        this.host.patchTab(tab.id, { initialText: null, restoreCursor: null, transfer: null });
        first = true;
      }
      this.editor.setState(state);
      this.editor.setFlavor(tab.flavor);
    } finally {
      this.switching = false;
    }
    this.syncDirty();
    this.selectionChanged(null);
    this.mark('doc-loaded');

    const pipeline = await loadPipeline(tab.flavor);
    if (this.destroyed || this.currentId !== tab.id) return;
    // Files the document refers to are read again each time it is shown.
    this.fetcher.reset(tab.id);
    this.lastContext = undefined;
    this.completionSignature = null;
    await this.fetcher.ready(tab.id, pipeline, () => this.editor.getText(), tab.path);
    if (this.destroyed || this.currentId !== tab.id) return;
    await this.present(tab, pipeline, first);
  }

  /** The preview and the scroll positions of the tab that is now on show. */
  private async present(tab: Tab, pipeline: Pipeline, first: boolean): Promise<void> {
    // The view classes follow the tab that the shell has just made active.
    await tick();
    if (this.destroyed || this.currentId !== tab.id) return;
    this.mode = tab.view;
    const wantPreview = this.previewWanted();
    this.setImageResolver(tab);

    const before = this.renderCount;
    if (!this.preview) {
      this.pipeline = pipeline;
      this.preview = new PreviewController({
        container: this.hosts.preview,
        getSource: () => this.editor.getText(),
        pipeline,
        getContext: () => this.currentContext(),
        onGoToLine: (line) => {
          this.editor.revealLine(line - 1);
          this.editor.focus();
        },
        resolveImage: this.imageResolver(tab),
        onRendered: (info) => this.rendered(info),
        onAnalyzed: (analysis) => this.analyzed(analysis),
      });
      this.setImageResolver(tab);
      this.preview.setVisible(wantPreview);
    } else {
      this.preview.setVisible(wantPreview);
      if (pipeline !== this.pipeline) {
        this.pipeline = pipeline;
        this.preview.setPipeline(pipeline);
      }
    }
    if (this.renderCount === before) this.preview.renderNow();

    if (tab.view !== 'preview') {
      this.editor.remeasure();
      if (tab.editorTopLine > 0) this.editor.scrollToLine(tab.editorTopLine, 'top');
    }
    if (wantPreview && tab.previewScrollTop > 0) {
      this.preview.completeNow();
      this.hosts.previewScroll.scrollTop = tab.previewScrollTop;
    } else if (wantPreview) {
      this.hosts.previewScroll.scrollTop = 0;
      // Only the Preview view has no editor to carry the saved position to the preview.
      if (tab.view === 'preview' && tab.editorTopLine > 0) {
        this.preview.completeNow();
        this.scrollPreviewToLine(tab.editorTopLine);
      }
    }
    this.viewSettled();
    this.syncExact();
    if (first && this.startup && !wantPreview && !this.pageHidden) void this.editorOnlyStartup();
  }

  /**
   * The view mode or the tab changed: the cursor block, the outline line and the scroll map
   * follow what is now on show.
   */
  private viewSettled(): void {
    this.scroll?.invalidate();
    this.applyHighlight();
    if (this.mode === 'preview') this.scroll?.reportPreviewLine();
    else this.host.setOutlineLine(this.editor.getSelectionInfo().line);
  }

  /** Remembers the scroll positions of the tab that is going away. */
  private leave(nextId: number): void {
    const id = this.currentId;
    if (id === null || id === nextId) return;
    this.states.set(id, this.editor.getState());
    this.capture(id);
  }

  private capture(id: number): void {
    const patch: Partial<Tab> = {};
    if (this.mode !== 'preview') patch.editorTopLine = this.editor.topVisibleLine();
    if (this.mode !== 'editor') patch.previewScrollTop = this.hosts.previewScroll.scrollTop;
    this.host.patchTab(id, patch);
  }

  private previewWanted(): boolean {
    return this.mode !== 'editor' && !this.pageHidden;
  }

  async setView(tab: Tab, mode: ViewMode): Promise<void> {
    if (this.destroyed || tab.id !== this.currentId || tab.view === mode) return;
    this.capture(tab.id);
    this.host.patchTab(tab.id, { view: mode });
    await tick();
    if (this.destroyed || this.currentId !== tab.id) return;
    this.mode = mode;
    const latest = this.host.getTab(tab.id) ?? tab;
    const wantPreview = this.previewWanted();
    this.preview?.setVisible(wantPreview);
    if (mode !== 'preview') {
      this.editor.remeasure();
      this.editor.scrollToLine(latest.editorTopLine, 'top');
    }
    if (wantPreview && this.preview) {
      this.preview.completeNow();
      this.hosts.previewScroll.scrollTop = latest.previewScrollTop;
    }
    this.viewSettled();
    this.syncExact();
  }

  async applyFlavor(tab: Tab): Promise<void> {
    if (this.destroyed || tab.id !== this.currentId) return;
    this.editor.setFlavor(tab.flavor);
    this.syncExact();
    const pipeline = await loadPipeline(tab.flavor);
    if (this.destroyed || this.currentId !== tab.id || pipeline === this.pipeline) return;
    await this.fetcher.ready(tab.id, pipeline, () => this.editor.getText(), tab.path);
    if (this.destroyed || this.currentId !== tab.id) return;
    this.pipeline = pipeline;
    this.completionSignature = null;
    this.preview?.setPipeline(pipeline);
    this.syncExact();
  }

  /** The context for the next render: what the pack needs, as far as it has been fetched. */
  private currentContext(): DocContext | undefined {
    const id = this.currentId;
    if (id === null || !this.pipeline) return undefined;
    const path = this.host.getTab(id)?.path ?? null;
    this.lastContext = this.fetcher.contextFor(
      id,
      this.pipeline,
      () => this.editor.getText(),
      path,
    );
    return this.lastContext;
  }

  /** Gives the editor the completion data of the context, when it changed. */
  private feedCompletions(): void {
    const context = this.lastContext;
    const completions = this.pipeline?.completions;
    if (!context || !completions) return;
    if (context.signature === this.completionSignature) return;
    this.completionSignature = context.signature;
    const data = completions.call(this.pipeline, context);
    const id = this.currentId;
    if (id !== null && this.host.getTab(id)?.flavor === 'obsidian') {
      // `[[Note#` offers the headings of that note (read when asked for, not up front).
      data.noteHeadings = noteHeadingsFor(
        this.host.platform,
        () => this.host.getTab(id)?.path ?? null,
        context.vault,
      );
    }
    this.editor.setCompletionData(data);
  }

  /** Scrolls the preview so that the block at this source line (0-based) is at the top. */
  private scrollPreviewToLine(line: number): void {
    const scroller = this.hosts.previewScroll;
    let target: Element | null = null;
    for (const block of this.hosts.preview.querySelectorAll('.wd-block[data-line]')) {
      if (Number(block.getAttribute('data-line')) > line) break;
      target = block;
    }
    if (!target) return;
    scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  }

  /** The source line (0-based) of the block at the top of the preview, or null. */
  private previewTopLine(): number | null {
    const top = this.hosts.previewScroll.getBoundingClientRect().top;
    let line: number | null = null;
    for (const block of this.hosts.preview.querySelectorAll('.wd-block[data-line]')) {
      if (block.getBoundingClientRect().top > top + 1) break;
      line = Number(block.getAttribute('data-line'));
    }
    return line;
  }

  position(tabId: number): TabPosition | null {
    const tab = this.host.getTab(tabId);
    const live = tabId === this.currentId;
    const state = live ? this.editor.getState() : this.states.get(tabId);
    if (!state || !tab) return null;
    const head = state.selection.main.head;
    const at = state.doc.lineAt(head);
    const cursor = { line: at.number, column: head - at.from };
    if (!live) {
      return { cursor, topLine: tab.editorTopLine, previewScrollTop: tab.previewScrollTop };
    }
    const topLine =
      this.mode === 'preview'
        ? (this.previewTopLine() ?? tab.editorTopLine)
        : this.editor.topVisibleLine();
    const previewScrollTop =
      this.mode === 'editor' ? tab.previewScrollTop : this.hosts.previewScroll.scrollTop;
    return { cursor, topLine, previewScrollTop };
  }

  textOf(tabId: number): string | null {
    if (tabId === this.currentId) return this.editor.getText();
    return this.states.get(tabId)?.doc.toString() ?? null;
  }

  exportTab(tabId: number): { text: string; savedText: string; editorState: unknown } | null {
    const state = tabId === this.currentId ? this.editor.getState() : this.states.get(tabId);
    if (!state) return null;
    const saved = this.saved.get(tabId) ?? state.doc;
    return {
      text: state.doc.toString(),
      savedText: saved.toString(),
      editorState: EditorController.stateToJSON(state),
    };
  }

  linkedPaths(): string[] {
    return this.fetcher.linkedPaths();
  }

  async refreshContext(paths: readonly string[], structural: boolean): Promise<void> {
    const id = this.currentId;
    const pipeline = this.pipeline;
    if (this.destroyed || id === null || !pipeline?.needs) return;
    if (!this.fetcher.uses(id, paths, structural)) return;
    const path = this.host.getTab(id)?.path ?? null;
    this.fetcher.reset(id);
    this.lastContext = undefined;
    this.completionSignature = null;
    await this.fetcher.ready(id, pipeline, () => this.editor.getText(), path);
    if (this.destroyed || this.currentId !== id) return;
    this.preview?.renderNow();
    if (embedsUse(path, paths)) {
      const { refreshEmbeds } = await import('@/preview/rules/obsidian/embed-enhance');
      await refreshEmbeds(paths);
    }
  }

  pathChanged(tab: Tab): void {
    if (tab.id === this.currentId) {
      this.setImageResolver(tab);
      // Relative links mean other files now.
      if (this.pipeline?.needs) {
        this.fetcher.reset(tab.id);
        this.preview?.renderNow();
      }
    }
  }

  drop(tabId: number): void {
    this.fetcher.drop(tabId);
    this.states.delete(tabId);
    this.saved.delete(tabId);
    if (this.currentId === tabId) this.currentId = null;
  }

  // ---- commands from the menu and the toolbar ------------------------------------------------

  run(command: FormatCommand): void {
    this.editor.run(command);
  }

  runInsert(id: string): void {
    this.editor.runInsert(id);
  }

  undo(): void {
    this.editor.undo();
  }

  redo(): void {
    this.editor.redo();
  }

  openSearch(replace: boolean): void {
    this.editor.openSearch(replace);
  }

  findNext(): void {
    this.editor.findNext();
  }

  findPrevious(): void {
    this.editor.findPrevious();
  }

  previewFindHost(): PreviewFindHost | null {
    const preview = this.preview;
    if (!preview) return null;
    return {
      scroller: this.hosts.previewScroll,
      sources: () => preview.findSources(),
      reveal: (index) => preview.revealBlock(index),
      onBlocksChanged: (listener) => preview.onBlocksChanged(listener),
      restoreFocus: () => this.hosts.previewScroll.focus({ preventScroll: true }),
    };
  }

  exportSource(): ExportSource | null {
    const result = this.preview?.renderForExport();
    return result ? { result, preview: this.hosts.preview } : null;
  }

  /** Click to source: the editor scrolls on its own, so sync scroll must not answer. */
  goToSourceLine(line: number): void {
    this.scroll?.mute(HEADING_JUMP_MUTE_MS);
    this.editor.goToLine(line);
  }

  focusEditor(): void {
    this.editor.focus();
  }

  revealMatch(tab: Tab, line: number, snippet: string, start: number): void {
    if (this.destroyed || tab.id !== this.currentId) return;
    this.scroll?.mute(HEADING_JUMP_MUTE_MS);
    const doc = this.editor.getState().doc;
    const row = doc.line(Math.min(Math.max(line, 0), doc.lines - 1) + 1);
    const found = snippet ? row.text.indexOf(snippet) : -1;
    this.editor.revealPosition(line, (found >= 0 ? found : 0) + start);
    if (this.preview && this.previewWanted()) {
      this.preview.completeNow();
      this.alignPreviewToLine(line, HEADING_JUMP_RETRIES);
    }
  }

  /** Puts the block that holds a source line (0-based) at the top edge of the preview. */
  private alignPreviewToLine(line: number, retries: number): void {
    if (this.destroyed) return;
    const scroll = this.hosts.previewScroll;
    let target: Element | null = null;
    for (const block of this.hosts.preview.querySelectorAll('.wd-block[data-line]')) {
      if (Number(block.getAttribute('data-line')) <= line) target = block;
      else break;
    }
    if (!target) return;
    const delta = target.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
    if (Math.abs(delta) >= 1) scroll.scrollTop += delta;
    if (retries > 0) {
      requestAnimationFrame(() => {
        if (this.currentId === null) return;
        const again =
          (target as Element).getBoundingClientRect().top - scroll.getBoundingClientRect().top;
        if (Math.abs(again) >= 1) this.alignPreviewToLine(line, retries - 1);
      });
    }
  }

  async scrollToAnchor(id: string): Promise<void> {
    const preview = this.preview;
    if (!preview) return;
    if (this.previewWanted()) {
      preview.completeNow();
      // In a large document the block of the heading may not have its content yet.
      preview.revealHeading(id);
      const target = this.hosts.preview.querySelector(`[id="${CSS.escape(id)}"]`);
      if (!target) return;
      const scroll = this.hosts.previewScroll;
      const delta = target.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
      scroll.scrollTop += delta;
      return;
    }
    const heading = this.headings.find((candidate) => candidate.id === id);
    if (heading) this.editor.revealLine(heading.line);
  }

  async revealHeading(tab: Tab, heading: Heading): Promise<void> {
    if (this.destroyed || tab.id !== this.currentId) return;
    // Both panes are scrolled here, so the scroll events of the jump are not followed again.
    this.scroll?.mute(HEADING_JUMP_MUTE_MS);
    if (this.mode !== 'preview') this.editor.revealLine(heading.line);
    else this.host.patchTab(tab.id, { editorTopLine: heading.line });
    if (this.preview && this.previewWanted()) {
      this.preview.completeNow();
      this.alignPreviewTo(heading, HEADING_JUMP_RETRIES);
    }
    this.host.setOutlineLine(heading.line);
  }

  /**
   * Puts a heading at the top edge of the preview. Blocks far from the screen are estimates until
   * they are drawn (large documents), so the position is measured again for a few frames.
   */
  private alignPreviewTo(heading: Heading, retries: number): void {
    if (this.destroyed) return;
    const scroll = this.hosts.previewScroll;
    const target =
      this.hosts.preview.querySelector(`[id="${CSS.escape(heading.id)}"]`) ??
      this.hosts.preview.querySelector(`.wd-block[data-line="${heading.line}"]`);
    if (!target) return;
    const delta = target.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
    if (Math.abs(delta) >= 1) scroll.scrollTop += delta;
    if (retries > 0) {
      requestAnimationFrame(() => {
        if (this.currentId === null) return;
        const again = target.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
        if (Math.abs(again) >= 1) this.alignPreviewTo(heading, retries - 1);
      });
    }
  }

  // ---- the text -----------------------------------------------------------------------------

  snapshot(): { text: string; commit: () => void } {
    const id = this.currentId;
    const doc = this.editor.getState().doc;
    return {
      text: this.editor.getText(),
      commit: () => {
        if (id === null) return;
        this.saved.set(id, doc);
        if (this.currentId === id) this.syncDirty();
      },
    };
  }

  /**
   * `saving.newFinalNewline` for a new document at its first save. Off (default) saves the text
   * as typed; on adds a final newline when there is none (never a second one).
   */
  applyFinalNewline(on: boolean): void {
    if (!on) return;
    const doc = this.editor.getState().doc;
    if (doc.length === 0 || doc.sliceString(doc.length - 1) === '\n') return;
    this.editor.view.dispatch({ changes: { from: doc.length, insert: '\n' } });
  }

  /** Types text at the end of the document on show, as the keyboard would (the recovery check). */
  typeAtEnd(text: string): void {
    const doc = this.editor.getState().doc;
    this.editor.view.dispatch({
      changes: { from: doc.length, insert: text },
      selection: { anchor: doc.length + text.length },
      userEvent: 'input.type',
    });
  }

  /** The dirty flag is the comparison of the document with its saved text, never a counter. */
  private syncDirty(): void {
    const id = this.currentId;
    const saved = id === null ? undefined : this.saved.get(id);
    if (id === null || !saved) return;
    const dirty = !this.editor.getState().doc.eq(saved);
    const known = this.host.getTab(id)?.textDirty;
    if (dirty !== this.lastDirty || dirty !== known) {
      this.lastDirty = dirty;
      this.host.patchTab(id, { textDirty: dirty });
    }
  }

  private documentChanged(): void {
    if (this.switching) return;
    this.syncDirty();
    if (this.currentId !== null) this.host.documentEdited?.(this.currentId);
    this.preview?.schedule();
    this.exact?.schedule();
  }

  // ---- the exact preview (Pandoc) ---------------------------------------------------

  /**
   * Starts or stops the exact preview to match the shell (on, Pandoc found, a flavor that has one)
   * and the view (the editor alone shows no preview). Called whenever one of them may have changed.
   */
  syncExact(): void {
    if (this.destroyed) return;
    const wanted =
      this.host.exactPreviewWanted() && this.previewWanted() && this.currentId !== null;
    if (!wanted) {
      this.stopExact();
      return;
    }
    if (this.exact) {
      this.exact.forgetImages();
      this.exact.renderNow();
      return;
    }
    if (this.exactLoading) return;
    this.exactLoading = true;
    void import('@/preview/pandoc-preview')
      .then(({ PandocPreview }) => {
        if (
          this.destroyed ||
          this.exact ||
          !this.host.exactPreviewWanted() ||
          !this.previewWanted()
        ) {
          return;
        }
        this.exact = new PandocPreview({
          platform: this.host.platform,
          scroller: this.hosts.previewScroll,
          article: this.hosts.preview,
          getText: () => this.editor.getText(),
          getContext: () => {
            const tab = this.currentId === null ? undefined : this.host.getTab(this.currentId);
            return {
              flavor: tab?.flavor ?? 'gfm',
              path: tab?.path ?? null,
              linkedPaths: this.fetcher.linkedPaths(),
            };
          },
          resolveImage: () => {
            const tab = this.currentId === null ? undefined : this.host.getTab(this.currentId);
            return tab ? this.imageResolver(tab) : undefined;
          },
          onLink: (event) => {
            const link = linkFromEvent(event);
            if (link && this.currentId !== null) this.host.openLink(this.currentId, link);
          },
        });
        this.stopExactScroll = this.editor.onScroll(this.onExactScroll);
        this.scroll?.invalidate();
      })
      .catch(() => {})
      .finally(() => {
        this.exactLoading = false;
      });
  }

  private stopExact(): void {
    if (!this.exact) return;
    this.stopExactScroll?.();
    this.stopExactScroll = null;
    cancelAnimationFrame(this.exactFrame);
    this.exact.dispose();
    this.exact = null;
    this.scroll?.invalidate();
  }

  /** Sync scroll by heading anchors only: the last source heading above the top line. */
  private readonly onExactScroll = (): void => {
    if (this.exactFrame !== 0 || !this.exact) return;
    this.exactFrame = requestAnimationFrame(() => {
      this.exactFrame = 0;
      if (!this.exact || this.mode !== 'split' || !this.host.settings.view.syncScroll) return;
      const top = this.editor.topVisibleLine();
      let index = -1;
      for (let i = 0; i < this.headings.length; i += 1) {
        if ((this.headings[i]?.line ?? Infinity) <= top) index = i;
        else break;
      }
      this.exact.followHeading(index);
    });
  };

  /** The reading ruler of the preview is a lazy module that exists only while the ruler is on. */
  private previewRuler: { dispose(): void } | null = null;
  private rulerLoading = false;
  private rulerWanted = false;

  private wantRuler(on: boolean): void {
    this.rulerWanted = on;
    if (!on) {
      this.previewRuler?.dispose();
      this.previewRuler = null;
      return;
    }
    if (this.previewRuler || this.rulerLoading) return;
    this.rulerLoading = true;
    void import('./a11y')
      .then(({ PreviewRuler }) => {
        if (this.destroyed || !this.rulerWanted) return;
        this.previewRuler = new PreviewRuler(this.hosts.previewScroll);
      })
      .catch(() => {})
      .finally(() => {
        this.rulerLoading = false;
      });
  }

  applySettings(settings: Settings): void {
    const next = settings.editor;
    const last = this.applied;
    if (!last || last.tabSize !== next.tabSize) this.editor.setTabSize(next.tabSize);
    if (!last || last.softWrap !== next.softWrap) this.editor.setSoftWrap(next.softWrap);
    if (!last || last.lineNumbers !== next.lineNumbers)
      this.editor.setLineNumbers(next.lineNumbers);
    if (!last || last.spellcheck !== next.spellcheck) this.editor.setSpellcheck(next.spellcheck);
    if (!last || last.insertSpaces !== next.insertSpaces)
      this.editor.setInsertSpaces(next.insertSpaces);
    if (!last || last.currentLine !== next.currentLine)
      this.editor.setCurrentLine(next.currentLine);
    if (!last || last.autoPair !== next.autoPair) this.editor.setAutoPair(next.autoPair);
    if (!last || last.typewriter !== next.typewriter) this.editor.setTypewriter(next.typewriter);
    if (!last || last.continueLists !== next.continueLists)
      this.editor.setContinueLists(next.continueLists);
    this.applied = { ...next };
    const shortcuts = JSON.stringify(settings.shortcuts);
    if (shortcuts !== this.appliedShortcuts) {
      this.appliedShortcuts = shortcuts;
      this.editor.setShortcuts(settings.shortcuts);
    }
    this.editor.setReadingAids({
      ruler: settings.a11y.ruler,
      spotlight: settings.a11y.spotlight,
    });
    this.wantRuler(settings.a11y.ruler);
    // The zoom changes the height of the preview's blocks.
    this.scroll?.invalidate();
    if (settings.view.syncScroll !== this.syncWasOn) {
      this.syncWasOn = settings.view.syncScroll;
      // Turned on: the preview comes to where the editor is.
      if (this.syncWasOn && this.mode === 'split') this.scroll?.alignPreview();
    }
  }

  // ---- what the preview reports --------------------------------------------------------------

  private rendered(info: { renderMs: number; first: boolean; result?: Analysis }): void {
    this.renderCount++;
    for (const listener of this.renderListeners) listener(info.renderMs);
    if (info.result) this.takeAnalysis(info.result);
    this.feedCompletions();
    if (info.first && this.startup && !this.startupFlow) {
      this.startupFlow = true;
      void this.afterFirstRender();
    }
  }

  private analyzed(analysis: Analysis): void {
    this.renderCount++;
    this.takeAnalysis(analysis);
  }

  private takeAnalysis(analysis: Analysis): void {
    this.headings = analysis.headings;
    if (this.currentId !== null) {
      this.host.patchTab(this.currentId, { stats: analysis.stats, headings: analysis.headings });
    }
    // The layout changed: the scroll map is measured again when it is next needed.
    this.scroll?.invalidate();
  }

  // ---- the cursor block and the outline ----------------------------------------------------------

  private cursorMoved(line: number): void {
    this.cursorLine = line;
    if (this.mode !== 'preview') this.host.setOutlineLine(line);
    // At most one update per frame, however fast the caret moves.
    if (this.highlightFrame) return;
    this.highlightFrame = requestAnimationFrame(() => {
      this.highlightFrame = 0;
      this.applyHighlight();
    });
  }

  /** The block under the caret is marked in Editor and Split view, and nothing in Preview view. */
  private applyHighlight(): void {
    this.preview?.highlightLine(this.mode === 'preview' ? null : this.cursorLine);
  }

  private selectionChanged(text: string | null): void {
    clearTimeout(this.selectionTimer);
    if (text === null) {
      if (this.selectionShown) this.host.setSelection(null);
      this.selectionShown = false;
      return;
    }
    this.selectionTimer = setTimeout(() => {
      const stats = this.pipeline?.analyze(text).stats;
      if (!stats) return;
      this.selectionShown = true;
      this.host.setSelection({ words: stats.words, characters: stats.characters });
    }, SELECTION_DEBOUNCE_MS);
  }

  // ---- the preview: tasks, links, images ------------------------------------------------------

  private imageResolver(tab: Tab): ((source: string) => Promise<string>) | undefined {
    const path = tab.path;
    return path ? (source) => this.host.platform.resolveImage(path, source) : undefined;
  }

  private setImageResolver(tab: Tab): void {
    this.preview?.setImageResolver(this.imageResolver(tab) ?? null);
  }

  private readonly onPreviewClick = (event: MouseEvent): void => {
    const line = taskLineFromEvent(event);
    if (line !== null) {
      event.preventDefault();
      this.editor.toggleTaskAtLine(line);
      return;
    }
    if (!(event.target instanceof Element) || !event.target.closest('a')) {
      if (this.mode === 'split') {
        const source = sourceLineOfClick(event, this.hosts.preview);
        if (source !== null) this.goToSourceLine(source);
      }
      return;
    }
    // Whatever the link is, the window itself never navigates.
    event.preventDefault();
    const link = linkFromEvent(event);
    if (link && this.currentId !== null) {
      this.host.openLink(this.currentId, link);
      return;
    }
    // A wikilink drawn before the vault index arrived has no `href`: resolve it now.
    const element = event.target.closest('a.wikilink');
    const id = this.currentId;
    if (element && id !== null) {
      void import('./wikilinks').then(({ wikilinkOf }) => {
        const wikilink = wikilinkOf(element);
        if (wikilink) this.host.openWikilink(id, wikilink);
      });
    }
  };

  private readonly onPreviewAuxClick = (event: MouseEvent): void => {
    if (event.target instanceof Element && event.target.closest('a')) event.preventDefault();
  };

  private readonly onPreviewKeyDown = (event: KeyboardEvent): void => {
    const line = taskLineFromEvent(event);
    if (line === null) return;
    event.preventDefault(); // Space would scroll the pane
    this.editor.toggleTaskAtLine(line);
  };

  // ---- page visibility, timing marks, the typing benchmark ---------------------------------------

  private readonly onVisibilityChange = (): void => {
    const hidden = document.visibilityState === 'hidden';
    if (hidden === this.pageHidden) return;
    // For the measurement harness: a run during which the page was hidden is not valid.
    this.pageHidden = hidden;
    this.markAlways(hidden ? 'page-hidden' : 'page-visible');
    // A hidden preview is not rendered; it catches up when shown again.
    this.preview?.setVisible(this.previewWanted());
  };

  private mark(name: string): void {
    if (this.startup?.perf) this.host.platform.perfMark(name);
  }

  private markAlways(name: string): void {
    if (this.host.launch.perf) this.host.platform.perfMark(name);
  }

  /** Startup marks after the first preview render, then the typing benchmark if requested. */
  private async afterFirstRender(): Promise<void> {
    await afterNextPaint();
    this.mark('first-preview-painted');
    await this.preview?.whenSettled();
    await whenSettled();
    this.mark('ready');
    if (this.startup?.bench && !this.destroyed) await this.runBench();
    const pdfPath = this.startup?.benchPdf;
    if (pdfPath && this.startup && !this.destroyed) {
      this.startup.benchPdf = null; // once, however often the document becomes ready
      await this.host.runPdfBench(pdfPath);
    }
  }

  /** A document opened without a preview (Editor view) is at rest once the editor is drawn. */
  private async editorOnlyStartup(): Promise<void> {
    await afterNextPaint();
    this.mark('first-preview-painted');
    await whenSettled();
    this.mark('ready');
  }

  private async runBench(): Promise<void> {
    const searchTerm = this.startup?.benchSearch;
    if (searchTerm != null) {
      await this.host.runSearchBench(searchTerm);
      return;
    }
    const target: BenchTarget = {
      typeCharacter: () => this.editor.typeAtMiddleLine('x'),
      documentBytes: () => new TextEncoder().encode(this.editor.getText()).length,
      onPreviewRendered: (listener) => {
        this.renderListeners.add(listener);
        return () => this.renderListeners.delete(listener);
      },
    };
    const report = await runTypingBench(target);
    await this.host.platform.benchReport(report);
  }

  destroy(): void {
    // The tabs outlive the workspace: each keeps its text, undo history and saved text, so a
    // workspace made later shows them as they were (as a tab moved from another window).
    // The tabs are patched after the teardown that called this, not during it.
    if (this.currentId !== null) this.states.set(this.currentId, this.editor.getState());
    const kept = [...this.states].map(([id, state]) => ({
      id,
      transfer: {
        editorState: EditorController.stateToJSON(state),
        savedText: (this.saved.get(id) ?? state.doc).toString(),
      },
    }));
    const host = this.host;
    queueMicrotask(() => {
      for (const { id, transfer } of kept) host.patchTab(id, { transfer });
    });
    this.destroyed = true;
    clearTimeout(this.selectionTimer);
    cancelAnimationFrame(this.highlightFrame);
    this.scroll?.dispose();
    this.previewRuler?.dispose();
    this.stopExact();
    this.stopSelection();
    this.stopInserts();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.hosts.preview.removeEventListener('click', this.onPreviewClick);
    this.hosts.preview.removeEventListener('auxclick', this.onPreviewAuxClick);
    this.hosts.preview.removeEventListener('keydown', this.onPreviewKeyDown);
    this.preview?.dispose();
    this.editor.destroy();
    this.states.clear();
    this.saved.clear();
  }
}
