/**
 * The two sides of the main window. The shell (`shell.svelte.ts`) lives in the main chunk: tabs,
 * documents, saving, menus. The workspace (`workspace.ts`) lives in a lazy chunk with the editor
 * and the preview, so a window without a document never loads them. They talk through these
 * interfaces, and neither imports the other's code.
 */
import type { FormatCommand } from '@/editor/commands';
import type { LaunchOptions, Platform, Settings, ViewMode } from '@/lib/platform';
import type { PreviewLink } from '@/preview/events';
import type { PreviewFindHost } from '@/preview/find/types';
import type { Heading, RenderResult } from '@/preview/types';
import type { Tab } from './tab';
import type { WikilinkTarget } from './wikilinks';

/** One entry of the toolbar Insert menu (the commands themselves stay in the editor chunk). */
export interface InsertItem {
  id: string;
  label: string;
  icon: string;
}

/** What the shell can ask the workspace (editor and preview) to do. */
/** What export, print and Copy as HTML read from the workspace. */
export interface ExportSource {
  /** Every block of the document as sanitized HTML, and the facts the title rule needs. */
  result: RenderResult;
  /** The preview element (a selection inside it is what Copy as HTML copies). */
  preview: HTMLElement;
}

export interface WorkspaceApi {
  /** Shows a tab: swaps the editor state, the flavor, the view and the scroll positions. */
  show(tab: Tab): Promise<void>;
  /** Switches the view mode of the tab on show. */
  setView(tab: Tab, mode: ViewMode): Promise<void>;
  /** The text of the document on show, and a way to record it as the saved text afterwards. */
  snapshot(): { text: string; commit: () => void };
  /** `saving.newFinalNewline` for a new document: on adds a final newline when missing. */
  applyFinalNewline(on: boolean): void;
  /** Types text at the end of the document on show, as the keyboard would (the recovery check). */
  typeAtEnd(text: string): void;
  /** Another flavor for the tab on show: the editor parser and the renderer follow. */
  applyFlavor(tab: Tab): Promise<void>;
  /** Editor settings and the image resolver depend on the settings and the path. */
  applySettings(settings: Settings): void;
  /** The document was saved to another path: images resolve relative to it from now on. */
  pathChanged(tab: Tab): void;
  run(command: FormatCommand): void;
  /** Runs a command of the Insert menu on the document on show. */
  runInsert(id: string): void;
  undo(): void;
  redo(): void;
  openSearch(replace: boolean): void;
  findNext(): void;
  findPrevious(): void;
  /** The preview's pieces for the find bar, or null before a preview exists. */
  previewFindHost(): PreviewFindHost | null;
  /** The document for export, print and Copy as HTML, or null (no preview yet, or a parse error). */
  exportSource(): ExportSource | null;
  /** Click to source: the caret goes to the start of this line (0-based) without taking focus. */
  goToSourceLine(line: number): void;
  /**
   * Search result: both panes go to a line (0-based) and the editor caret to the match, found by
   * `snippet` (the cut line the search returned) plus `start` within it.
   */
  revealMatch(tab: Tab, line: number, snippet: string, start: number): void;
  /** Scrolls to the heading or element with this id (already decoded). */
  scrollToAnchor(id: string): Promise<void>;
  /**
   * Outline click: scrolls the preview and the editor to the heading, also with sync scroll off,
   * and moves the editor caret there when the editor is shown.
   */
  revealHeading(tab: Tab, heading: Heading): Promise<void>;
  /** The exact preview (Pandoc) may have to start or stop (the shell state changed). */
  syncExact(): void;
  /** Forgets the state of a tab that was closed. */
  drop(tabId: number): void;
  /**
   * Where the reader is in a tab: the caret (1-based line, column from 0), the top source line
   * (0-based, may be fractional) and the preview scroll offset. Null for a tab never shown.
   */
  position(tabId: number): TabPosition | null;
  /** The text of a tab (the editor's for the tab on show), or null for a tab never shown. */
  textOf(tabId: number): string | null;
  /**
   * A tab's editor state for another window: the text, the text as of the last save, and the
   * CodeMirror state as JSON with the undo history. Null for a tab that was never shown (its
   * text is still `tab.initialText`).
   */
  exportTab(tabId: number): { text: string; savedText: string; editorState: unknown } | null;
  /** The files the documents fetched for their previews (bibliographies, includes, projects). */
  linkedPaths(): string[];
  /**
   * Files a document refers to changed on disk: fetches them again and renders the tab on show
   * again when it uses one of `paths`, or, with `structural`, when it uses the vault index.
   */
  refreshContext(paths: readonly string[], structural: boolean): Promise<void>;
  focusEditor(): void;
}

/** Where the reader is in a document (see `WorkspaceApi.position`). */
export interface TabPosition {
  cursor: { line: number; column: number };
  topLine: number;
  previewScrollTop: number;
}

/** What the workspace tells the shell. */
export interface WorkspaceHost {
  readonly platform: Platform;
  readonly settings: Settings;
  /** The startup switches, once: the first document shown reports the perf marks. */
  takeStartup(): {
    perf: boolean;
    bench: boolean;
    benchSearch?: string | null;
    benchPdf?: string | null;
  } | null;
  /** Runs the search benchmark in the open folder and reports it (benchmark mode only). */
  runSearchBench(query: string): Promise<void>;
  /** Exports the open document as a PDF to the path (PDF benchmark mode only). */
  runPdfBench(path: string): Promise<void>;
  readonly launch: LaunchOptions;
  getTab(id: number): Tab | undefined;
  patchTab(id: number, patch: Partial<Tab>): void;
  /** 1-based line and column of the caret. */
  setCursor(line: number, column: number): void;
  /**
   * The source line (0-based, may be fractional) the outline measures the current section by:
   * the caret line in Editor and Split, the line at the top of the preview in Preview.
   */
  setOutlineLine(line: number): void;
  /** The counts of the selected text, or null without a selection. */
  setSelection(selection: { words: number; characters: number } | null): void;
  /** A click on a link in the preview. */
  openLink(tabId: number, link: PreviewLink): void;
  /** A click on a wikilink that has no `href` (drawn before the vault index arrived). */
  openWikilink(tabId: number, link: WikilinkTarget): void;
  showError(message: string): void;
  /** The document with this tab id was edited (auto-save starts its wait). */
  documentEdited?(id: number): void;
  /** The set of linked files a document fetched changed: the watch set follows. */
  linkedFilesChanged(): void;
  /** The exact preview (Pandoc) is on, Pandoc is found and the active flavor has one. */
  exactPreviewWanted(): boolean;
  setSplitRatio(ratio: number): void;
  /** The Insert menu entries of the flavor on show (empty when it has none). */
  setInserts(items: InsertItem[]): void;
}
