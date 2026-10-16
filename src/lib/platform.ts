/**
 * The only bridge between the web UI and the Rust side.
 *
 * - This is the only module that may import `@tauri-apps/api`.
 * - Everything else talks to the backend through the `Platform` interface, so tests and the
 *   plain `npm run dev` server can run against the in-memory mock (`platform-mock.ts`).
 * - New backend capabilities are added here as typed methods, never as raw `invoke` calls
 *   elsewhere.
 * - Every promise from a Phase 1 method that fails rejects with a `PlatformError`
 *   (`{ code, message }`); `isPlatformError` tells one from any other error. The Phase 0
 *   methods (`openFileDialog`, `readTextFile`) keep rejecting with a plain message.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type PlatformKind = 'tauri' | 'mock';

/** The Markdown flavors (the same ids as `src/flavors`, which is built in parallel). */
export type FlavorId = 'commonmark' | 'gfm' | 'obsidian' | 'pandoc' | 'quarto' | 'mdx';

/** `Partial`, applied to nested objects too: the shape of a settings update. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

// ---- Phase 0 -------------------------------------------------------------------------------

/** A text file read through the Rust side (Phase 0 `readTextFile`). */
export interface TextFile {
  /** The path that was read (canonical). */
  path: string;
  /** The text. Bytes that are not valid UTF-8 are replaced; use `readDocument` for real files. */
  text: string;
  /** Size of the file on disk, in bytes. */
  bytes: number;
}

/** What the app was started with: command-line arguments and measurement switches. */
export interface LaunchOptions {
  /** `--open <path>`: the file to show at startup. The path is already allowed for reading. */
  openPath: string | null;
  /** `--welcome`: start without a document. */
  welcome: boolean;
  /** `WRITEDOWN_PERF=1`: report timing marks through `perfMark`. */
  perf: boolean;
  /** `WRITEDOWN_BENCH=typing` together with `perf`: run the typing benchmark after startup. */
  bench: boolean;
  /** `WRITEDOWN_BENCH=search`: the term the search benchmark looks for; otherwise null or absent. */
  benchSearch?: string | null;
  /** `WRITEDOWN_BENCH=pdf`: the path the opened document is exported to as a PDF once ready. */
  benchPdf?: string | null;
  /** `WRITEDOWN_BENCH=recovery-edit`: type a fixed sentence after startup and keep the recovery entry. */
  benchRecovery?: boolean;
  /**
   * `--view editor|split|preview`: the view mode of the document opened with `--open`. Both
   * platforms always send it (null without `--view`); it is optional in the type only so that
   * Phase 0 code and tests that build a `LaunchOptions` by hand still compile.
   */
  view?: ViewMode | null;
  /**
   * `--folder <path>`: the folder to open in the Files tab at startup (already granted). Both
   * platforms send it (null without `--folder`); optional in the type like `view`.
   */
  folderPath?: string | null;
  /**
   * False when the app was started with `--open`, `--folder` or `--welcome`: the last session is
   * not restored. The `restoreSession` setting is a second switch the shell also checks.
   */
  restoreSession?: boolean;
  /**
   * The label of this window: `main`, or `doc-<n>` for a window a tab was moved to (Phase 5).
   * Both platforms send it; optional in the type like `view`, and absent means `main`.
   */
  windowLabel?: string;
}

/** Result of the search benchmark (see `src/perf/search-bench.ts`). */
export interface SearchBenchRun {
  ms: number;
  files: number;
  matches: number;
  truncated: boolean;
}

export interface SearchBenchReport {
  query: string;
  runs: SearchBenchRun[];
  /** Set when the benchmark could not run (no folder, a failed search). */
  error: string | null;
}

/** Result of the typing benchmark (see `src/perf/typing-bench.ts`). */
export interface BenchReport {
  renderMs: number[];
  e2eMs: number[];
  docBytes: number;
}

// ---- Documents -----------------------------------------------------------------------------

export type Encoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be';
export type LineEnding = 'lf' | 'crlf';

/** A document as read from disk by `readDocument`. */
export interface DocumentFile {
  /** The canonical path. */
  path: string;
  /** Line endings normalized to `\n`; the byte order mark is removed. */
  text: string;
  /** How it will be saved. */
  encoding: Encoding;
  /** For example `'windows-1252'` when the file was decoded from a legacy encoding; saving converts it to UTF-8. */
  legacyEncoding: string | null;
  /** Undecodable bytes were replaced. */
  lossy: boolean;
  /** The majority line ending of the file (`'lf'` for a file without line breaks). */
  lineEnding: LineEnding;
  mixedLineEndings: boolean;
  /** The file or its folder cannot be written, so a save cannot replace the file. */
  readOnly: boolean;
  /** The size of the file on disk. */
  bytes: number;
  /** The file's modification time when it was read, in milliseconds since the epoch. */
  modifiedMs: number;
}

export interface SaveFormat {
  encoding: Encoding;
  lineEnding: LineEnding;
}

export interface SaveOptions {
  /** `null` for a new file; otherwise the file is refused if it changed since it was read. */
  expectedModifiedMs: number | null;
  /** Set after the user agreed to overwrite a file that changed on disk. */
  overwriteExternalChange?: boolean;
  /** Set after the user agreed to save a document that was read with replaced bytes. */
  allowLossy?: boolean;
}

export interface SaveResult {
  /** The canonical path that was written. */
  path: string;
  bytes: number;
  modifiedMs: number;
}

export type PlatformErrorCode =
  | 'not-allowed'
  | 'not-found'
  | 'too-large'
  | 'read-only'
  | 'modified-externally'
  | 'lossy'
  | 'not-markdown'
  | 'cancelled'
  | 'io'
  | 'exists'
  | 'invalid-name';

/** What a rejected Phase 1 method carries. `message` is a plain sentence for the user. */
export interface PlatformError {
  code: PlatformErrorCode;
  message: string;
}

const ERROR_CODES: readonly string[] = [
  'not-allowed',
  'not-found',
  'too-large',
  'read-only',
  'modified-externally',
  'lossy',
  'not-markdown',
  'cancelled',
  'io',
  'exists',
  'invalid-name',
];

/** True for the error object a rejected Phase 1 method carries. */
export function isPlatformError(value: unknown): value is PlatformError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    typeof (value as PlatformError).code === 'string' &&
    ERROR_CODES.includes((value as PlatformError).code) &&
    typeof (value as PlatformError).message === 'string'
  );
}

export type LocationKind = 'icloud' | 'onedrive' | 'dropbox' | 'google-drive' | 'local';

export interface DocumentContext {
  /** A folder above the document contains `.obsidian`. */
  obsidianVault: boolean;
  location: LocationKind;
}

/** Why a linked text is read: decides what may be read (extensions, size, location). */
export type LinkedTextPurpose = 'bibliography' | 'include' | 'embed';

/** A text file a document refers to, as `readLinkedText` and `quartoProject` return it. */
export interface LinkedText {
  /** The canonical path that was read. */
  path: string;
  /** Decoded, line endings normalized to `\n`. */
  text: string;
}

/** The notes and attachments of an Obsidian vault. */
export interface VaultIndex {
  /** The canonical path of the vault root. */
  root: string;
  /** Markdown notes, relative to `root`, `/` separated. */
  notes: string[];
  /** Images and PDF files, relative to `root`, `/` separated. */
  attachments: string[];
  /** The vault has more than 20,000 entries; the lists stop there. */
  truncated: boolean;
}

export interface RecentEntry {
  path: string;
  name: string;
  /** The folder, for display, with the home folder shown as `~`. */
  folder: string;
  openedAtMs: number;
  /** The size now, or null if the file is missing. */
  bytes: number | null;
  exists: boolean;
}

// ---- Settings and document state -------------------------------------------------------------

export type ViewMode = 'editor' | 'split' | 'preview';

export interface Settings {
  version: 1;
  /** 'gfm' */
  defaultFlavor: FlavorId;
  /** 'preview' */
  openExistingIn: ViewMode;
  /** 'split' */
  openNewIn: 'editor' | 'split';
  /** 20, 1 to 100 */
  recentLimit: number;
  /** 'system' */
  appearance: 'system' | 'light' | 'dark';
  /** 238, 50 to 1000 */
  readingWpm: number;
  editor: {
    /** 'jetbrains-mono' */
    fontFamily: 'jetbrains-mono' | 'sf-mono' | 'menlo';
    /** 13, 9 to 32 */
    fontSize: number;
    /** 1.7, 1.2 to 2.4 (a multiple of the font size) */
    lineHeight: number;
    /** 2, 1 to 8 */
    tabSize: number;
    /** true. Tab inserts spaces (today's behavior); false inserts a tab character. */
    insertSpaces: boolean;
    /** true. Highlight the line with the cursor. */
    currentLine: boolean;
    /** false. Close brackets, quotes, `**`, `__` and backticks as you type. */
    autoPair: boolean;
    /** true. Return continues a list or quote. */
    continueLists: boolean;
    /** false. Keep the cursor line in the vertical middle of the editor. */
    typewriter: boolean;
    /** false. Live preview: hide Markdown syntax outside the lines being edited. */
    livePreview: boolean;
    /** true. Show the "Editor" and "Preview" pane headers. */
    paneHeaders: boolean;
    softWrap: boolean;
    lineNumbers: boolean;
    spellcheck: boolean;
  };
  view: {
    sidebarVisible: boolean;
    /** 240, 180 to 480 */
    sidebarWidth: number;
    /** 0.5, 0.2 to 0.8 */
    splitRatio: number;
    syncScroll: boolean;
    /** 1, 0.5 to 2 */
    zoom: number;
  };
  /** true. Open the documents and folder of the last session at launch. */
  restoreSession: boolean;
  /** true. Phase 5: the macOS sidebar material behind the sidebar. */
  vibrancy: boolean;
  /** `{}`. Phase 5: shortcuts changed from the defaults, by command id; null removes the shortcut. Edited in Keyboard Shortcuts. */
  shortcuts: Record<string, string | null>;
  files: {
    /** `['node_modules', '_site', '_freeze', 'renv', 'venv', '__pycache__']`. Names skipped at any depth, besides hidden entries. */
    ignore: string[];
  };
  export: {
    /** null. The Pandoc to use for Word documents; null means look for one. Only an absolute path to a file named `pandoc` is accepted. */
    pandocPath: string | null;
  };
  /** Phase 4. */
  preview: {
    /** true. Off: the extension and your per-file choice only, then the default flavor. */
    autoDetectFlavor: boolean;
    /** 'inter' */
    font: 'inter' | 'system' | 'literata' | 'atkinson' | 'lexend' | 'opendyslexic';
    /** 15, 12 to 28 */
    fontSize: number;
    /** 720, 560 to 1040 (px, step 40 in Preferences) */
    columnWidth: number;
    /** false. Show #tags as pills outside Obsidian. */
    hashtagPills: boolean;
    /** false. Dim Obsidian `%%comments%%`. */
    obsidianCommentsDimmed: boolean;
    /** true. Smart punctuation in Pandoc / MMD and Quarto / RMD. */
    smartPunctuation: boolean;
    /** true. Off: math shows as its source text. */
    math: boolean;
    /** true. Off: no network request for remote images. */
    remoteImages: boolean;
    /** 'dark' */
    codeCards: 'dark' | 'light';
  };
  /** Phase 4. */
  a11y: {
    /** false */
    dyslexia: boolean;
    /** 'opendyslexic' */
    dyslexiaFont: 'opendyslexic' | 'atkinson' | 'lexend';
    /** false. Reading ruler. */
    ruler: boolean;
    /** 'yellow' */
    rulerTint: 'yellow' | 'blue' | 'green' | 'pink';
    /** false. Focus-line spotlight in the editor. */
    spotlight: boolean;
    /** 'system' (follow macOS) */
    reduceMotion: 'system' | 'on' | 'off';
    /** 'system' (follow macOS) */
    highContrast: 'system' | 'on' | 'off';
    /** 1.0, 1.0 to 1.5 (interface scale) */
    scale: number;
  };
  /** Phase 4. */
  saving: {
    /** false */
    autoSave: boolean;
    /** 'lf' */
    newLineEnding: 'lf' | 'crlf';
    /** false */
    newFinalNewline: boolean;
    /** null. Where the Save dialog starts: an absolute path or null. Whether it exists is checked when it is used; it grants no access. */
    defaultFolder: string | null;
  };
}

export interface DocState {
  /** The flavor the user chose for this file, or null. */
  flavor: FlavorId | null;
  /** Where the cursor was when the document was last left (1-based line, column from 0), or null. */
  cursor: { line: number; column: number } | null;
  /** The top visible source line (1-based) at that time, or null. */
  scrollLine: number | null;
}

// ---- Folders, search, export, session (Phase 3) ---------------------------------------------

/** Image files dropped on a window (`onDropImages`). */
export interface ImageDrop {
  paths: string[];
  x: number;
  y: number;
}

export interface FolderEntry {
  name: string;
  /** The absolute path. */
  path: string;
  kind: 'folder' | 'file';
  /** The size of a file; null for a folder. */
  bytes: number | null;
  modifiedMs: number | null;
}

/** One level of a folder: folders and Markdown-family files, hidden and ignored names left out. */
export interface FolderListing {
  path: string;
  entries: FolderEntry[];
  /** The level has more than 5,000 entries; the list stops there. */
  truncated: boolean;
}

/** What the watcher is asked to watch. Each `watch` call replaces the whole set. */
export interface WatchSet {
  documents: string[];
  linked: string[];
  folder: string | null;
}

export interface FileChange {
  path: string;
  kind: 'modified' | 'created' | 'removed';
  scope: 'document' | 'linked' | 'folder';
}

export interface SearchRequest {
  id: number;
  folder: string;
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface SearchMatch {
  /** 1-based. */
  line: number;
  /** The line, cut to 240 UTF-16 units around the first match. */
  text: string;
  /** Matched ranges in UTF-16 units of `text`. */
  ranges: [number, number][];
}

export interface SearchFileResult {
  path: string;
  matches: SearchMatch[];
}

export interface SearchResult {
  id: number;
  files: SearchFileResult[];
  matchCount: number;
  fileCount: number;
  truncated: boolean;
  cancelled: boolean;
  error: string | null;
}

/** What a DOCX export is asked for. */
export interface DocxRequest {
  docPath: string | null;
  outPath: string;
  input: string;
  from: string;
  citeproc: boolean;
}

/** What the exact preview asks of Pandoc. `bibliography` are the files the preview read. */
export interface PandocPreviewRequest {
  docPath: string | null;
  input: string;
  /** `markdown`, `gfm` or `commonmark`. */
  from: string;
  citeproc: boolean;
  bibliography: string[];
}

export type SidebarTab = 'outline' | 'files' | 'search' | 'snippets';

/** A snippet (Phase 5, WP5.5). `trigger` is empty for none; `id` empty for a new one. */
export interface Snippet {
  id: string;
  name: string;
  trigger: string;
  body: string;
}

export interface SessionTab {
  path: string;
  view: ViewMode;
}

/** Where a window sat on the screen, in logical pixels. */
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A document window other than `main` in the stored session (Phase 5). */
export interface SessionWindow {
  tabs: SessionTab[];
  active: number;
  bounds?: WindowBounds | null;
}

/** What is restored at the next launch. The top-level fields are the main window's. */
export interface Session {
  tabs: SessionTab[];
  /** The index of the active tab in `tabs`. */
  active: number;
  folder: string | null;
  sidebarTab: SidebarTab;
  /** Folders expanded in the Files tree (below `folder`). */
  expanded?: string[];
  /** Where the main window sat (kept when other windows exist). */
  bounds?: WindowBounds | null;
  /** The other document windows (Phase 5); absent means none. */
  windows?: SessionWindow[];
}

/**
 * A tab on its way to a new window (Move Tab to New Window). `tab` holds the serializable fields
 * of the shell's tab (the shell builds and reads it; this module only carries it); `editorState`
 * is the CodeMirror state as JSON with its undo history, or null when the tab was never shown.
 */
export interface TabTransfer {
  kind: 'tab';
  /** The canonical path, or null for a document without a file. Rust checks it is granted. */
  path: string | null;
  /** The document as it is in the editor now. */
  text: string;
  /** The text as of the last save or load, which the unsaved flag is measured against. */
  savedText: string;
  editorState: unknown;
  tab: Record<string, unknown>;
}

/** What the page keeps for a document with unsaved changes. */
export interface RecoveryWrite {
  text: string;
  /** The canonical path, or null for a document that has no file. */
  path: string | null;
  name: string;
  flavor: string;
  view: ViewMode;
  line: number;
  column: number;
  window: string;
  /** The file's modification time when it was opened or saved. */
  modifiedMs: number | null;
}

/** An entry as `recoveryList` returns it. */
export interface RecoveryEntry extends RecoveryWrite {
  id: string;
  savedAtMs: number;
}

/** Windows restored from the session start with these tabs instead of a transfer. */
export interface SessionTransfer {
  kind: 'session';
  tabs: SessionTab[];
  active: number;
}

/** What waits for a new window's page at startup. */
export type WindowTransfer = TabTransfer | SessionTransfer;

// ---- Menu, close and quit ---------------------------------------------------------------------

/**
 * The ids of the menu items the shell handles (the `menu-action` event carries one). The union
 * has no comments on purpose: a Rust test reads these strings from this file.
 */
export type MenuAction =
  | 'new'
  | 'open'
  | 'close-tab'
  | 'close-window'
  | 'save'
  | 'save-as'
  | 'reveal-in-finder'
  | 'undo'
  | 'redo'
  | 'find'
  | 'find-replace'
  | 'find-next'
  | 'find-previous'
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'code'
  | 'link'
  | 'image'
  | 'quote'
  | 'bullet-list'
  | 'numbered-list'
  | 'task-list'
  | 'code-block'
  | 'table'
  | 'rule'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'heading-5'
  | 'heading-6'
  | 'paragraph'
  | 'view-editor'
  | 'view-split'
  | 'view-preview'
  | 'toggle-sidebar'
  | 'toggle-sync-scroll'
  | 'toggle-typewriter'
  | 'toggle-live-preview'
  | 'toggle-exact-preview'
  | 'render-quarto'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'next-tab'
  | 'previous-tab'
  | 'move-tab-to-new-window'
  | 'markdown-guide'
  | 'open-folder'
  | 'quick-open'
  | 'duplicate'
  | 'rename'
  | 'move-to'
  | 'revert'
  | 'export-html'
  | 'export-docx'
  | 'export-pdf'
  | 'print'
  | 'copy-html'
  | 'paste-plain'
  | 'search-folder'
  | 'command-palette';

/** What the shell tells the menu bar about itself, so items can be enabled and checked. */
export interface MenuState {
  hasDocument: boolean;
  canSave: boolean;
  /** The editor is visible. */
  canFormat: boolean;
  viewMode: ViewMode | null;
  sidebarVisible: boolean;
  syncScroll: boolean;
  /** Typewriter scrolling is on (Phase 5). Missing means false. */
  typewriter?: boolean;
  /** Live preview in the editor is on. Missing means false. */
  livePreview?: boolean;
  tabCount: number;
  /** The active document is saved in a file (Duplicate, Rename, Move To, Revert, Copy as HTML). Missing means false. */
  hasPath?: boolean;
  /** Pandoc was found, so Export > Word Document is enabled. Missing means false. */
  canExportDocx?: boolean;
  /** Pandoc was found and the flavor has an exact preview (View > Exact Preview (Pandoc)). Missing means false. */
  canExactPreview?: boolean;
  /** The active document is a saved .qmd or .Rmd file, so File > Render with Quarto is enabled. Missing means false. */
  canRender?: boolean;
  /** The exact preview is on in this window. Missing means false. */
  exactPreview?: boolean;
}

/** Why the app asks the page to close: the window's close button or Close Window, or Quit. */
export type CloseReason = 'window' | 'quit';

// ---- The platform --------------------------------------------------------------------------

export interface Platform {
  readonly kind: PlatformKind;
  /** The application version, from the Tauri package info (the mock returns a fixed value). */
  appVersion(): Promise<string>;
  /** Round-trip check of the bridge: the Rust side answers "pong". */
  ping(): Promise<string>;
  /** Command-line arguments and measurement switches the app was started with. */
  launchOptions(): Promise<LaunchOptions>;
  /**
   * Shows the native open dialog. Resolves to the chosen path, or null if the user cancelled.
   * The Rust side runs the dialog and remembers the path: only paths chosen here or given with
   * `--open` can be read with `readTextFile`.
   */
  openFileDialog(): Promise<string | null>;
  /** Reads a file that was chosen with the dialog or `--open`. Anything else is refused. */
  readTextFile(path: string): Promise<TextFile>;
  /** Reports a startup timing mark. Does nothing unless the app runs with `WRITEDOWN_PERF=1`. */
  perfMark(name: string): void;
  /** Reports the typing benchmark result (only has an effect in benchmark mode). */
  benchReport(report: BenchReport): Promise<void>;
  /** Reports the search benchmark result (only has an effect in benchmark mode). */
  benchSearchReport(report: SearchBenchReport): Promise<void>;

  // Dialogs. Every path they return is granted: Rust trusts it from now on.
  /** The native open dialog, as a sheet. Resolves to the granted paths, or `[]` if cancelled. */
  openDialog(options: { multiple: boolean }): Promise<string[]>;
  /** The native save dialog, as a sheet. Resolves to the granted path, or null if cancelled. */
  saveDialog(options: {
    suggestedName: string;
    directory: string | null;
    /** `document` (default) grants the path as a document; `html`, `docx` and `pdf` only allow one export to it. */
    kind?: 'document' | 'html' | 'docx' | 'pdf';
  }): Promise<string | null>;
  /** The three-button sheet: Save (Return), Don't Save, Cancel (Escape). */
  confirmUnsaved(name: string): Promise<'save' | 'discard' | 'cancel'>;
  /** A native two-button sheet with the given labels. Resolves to true for `ok`. */
  ask(options: { title: string; message: string; ok: string; cancel: string }): Promise<boolean>;

  // Documents.
  /** Reads a granted file (encoding, line endings and all) and adds it to the recents. */
  readDocument(path: string): Promise<DocumentFile>;
  /** The safe save. Rejects with `modified-externally`, `lossy`, `read-only` or `io`. */
  saveDocument(
    path: string,
    text: string,
    format: SaveFormat,
    options: SaveOptions,
  ): Promise<SaveResult>;
  documentContext(path: string): Promise<DocumentContext>;
  revealInFinder(path: string): Promise<void>;
  /** Opens an http, https or mailto link with the system. Anything else is refused. */
  openExternal(url: string): Promise<void>;
  /** Resolves a link to a Markdown or text file and grants it. Resolves to its canonical path. */
  openLinkedDocument(fromPath: string, href: string): Promise<string>;
  /** Reveals the target of a link (any existing local file) in Finder. */
  revealLinkedFile(fromPath: string, href: string): Promise<void>;
  /**
   * The URL the web view can load a local image from. A path that is not found next to the
   * document may be relative to the root of the document's Obsidian vault.
   */
  resolveImage(docPath: string, src: string): Promise<string>;
  /**
   * The bytes of a local image, resolved like `resolveImage`, for HTML export and Copy as HTML
   * (they embed it as a `data:` URI). Rejects with `too-large` over `maxBytes`.
   */
  readImageBytes(docPath: string, src: string, maxBytes: number): Promise<Uint8Array>;
  /**
   * Saves a pasted image (PNG, JPEG, GIF or WebP bytes) into the `assets` folder next to a
   * saved document, under `name` (cleaned, numbered if taken). Resolves to the `src` to write in
   * the Markdown, relative to the document. Rejects with `not-allowed` for other bytes.
   */
  savePastedImage(docPath: string, bytes: Uint8Array, name: string): Promise<string>;
  /**
   * Links an image that was dropped on the window (a path from `onDropImages`): an image in the
   * document's folder is linked where it is, any other is copied into `assets`. Resolves to the
   * Markdown `src`.
   */
  importDroppedImage(docPath: string, source: string): Promise<string>;
  /**
   * Reads a bibliography, an included file or an embedded note that a document refers to
   * (resolved like `openLinkedDocument`). Embeds only inside the document's vault. The target is
   * read-only: it is not saved, not in the recents. Rejects with `not-found`, `not-allowed`,
   * `not-markdown` (wrong kind of file for an include or embed) or `too-large`.
   */
  readLinkedText(fromPath: string, href: string, purpose: LinkedTextPurpose): Promise<LinkedText>;
  /** The vault of a document: notes and attachments. Resolves to null when it is in no vault. */
  vaultIndex(docPath: string): Promise<VaultIndex | null>;
  /** The nearest `_quarto.yml` of a document, or null. */
  quartoProject(docPath: string): Promise<LinkedText | null>;

  // Folders and file operations (Phase 3). Every path must be granted: a folder from
  // `folderDialog` (with everything below it), or a document. Names are checked in Rust.
  /** The native folder sheet, for Open Folder (`open`) or Move To (`move`). Grants the chosen folder and everything below it. */
  folderDialog(purpose: 'open' | 'move'): Promise<string | null>;
  /** One level of a granted folder. Rejects with `not-allowed` or `not-found`. */
  listFolder(path: string): Promise<FolderListing>;
  /** Every Markdown-family file below a granted folder (absolute paths), for Quick Open. At most 20,000. */
  fileIndex(folder: string): Promise<{ paths: string[]; truncated: boolean }>;
  /** Creates an empty file and resolves to its path. Rejects with `exists` or `invalid-name`. */
  createFile(folder: string, name: string): Promise<string>;
  createFolder(folder: string, name: string): Promise<string>;
  /** Renames within the folder (`exists`, `invalid-name`: a name with `/` or `:` or a leading dot). Resolves to the new path; recents and document state follow. */
  renamePath(path: string, newName: string): Promise<string>;
  /** Moves into another granted folder; refuses an existing name. Resolves to the new path. */
  movePath(path: string, toFolder: string): Promise<string>;
  /** Copies a file as "name copy.md", "name copy 2.md", ... and resolves to the copy. */
  duplicatePath(path: string): Promise<string>;
  /** Moves to the macOS Trash. Never deletes. */
  trashPath(path: string): Promise<void>;

  // Watching and search (3.1w fills in the Tauri side; until then they reject).
  /** Replaces the whole watch set. */
  watch(set: WatchSet): Promise<void>;
  onFileChanged(handler: (changes: FileChange[]) => void): Promise<() => void>;
  /** Image files dropped on this window, and where (CSS pixels from the top left of the page). */
  onDropImages(handler: (drop: ImageDrop) => void): Promise<() => void>;
  searchFolder(request: SearchRequest): Promise<SearchResult>;
  cancelSearch(id: number): Promise<void>;

  // Clipboard, print, export.
  /** Text, and HTML if given, onto the system pasteboard. */
  writeClipboard(content: { text: string; html?: string }): Promise<void>;
  /** The plain text on the system pasteboard (Paste and Match Style). */
  readClipboardText(): Promise<string>;
  /** Shows the print panel for the page. */
  printPage(): Promise<void>;
  /** Writes an export to a path the save dialog just returned for it (kind `html`), once. */
  writeExport(path: string, contents: string): Promise<void>;
  /** The Pandoc that Word export would use, or null (3.6b; until then it rejects). */
  pandocInfo(): Promise<{ path: string; version: string } | null>;
  /**
   * Preferences: a file sheet for Pandoc. A chosen file named `pandoc` that runs `--version` is
   * stored in `export.pandocPath` (and announced through `onSettingsChanged`); the path is
   * returned. Resolves to null on Cancel; rejects with `io` for a file that is not Pandoc.
   */
  choosePandoc(): Promise<string | null>;
  /**
   * Preferences: a folder sheet for `saving.defaultFolder`. Stores the folder (it grants no
   * access) and returns it, or null on Cancel.
   */
  chooseDefaultFolder(): Promise<string | null>;
  /**
   * Preferences: the current default app for Markdown, read when Preferences opens.
   * `isWritedown` is true when it is this app; `appName` is null when macOS names none.
   */
  defaultMarkdownApp(): Promise<{ isWritedown: boolean; appName: string | null }>;
  /**
   * Preferences: makes Writedown the default app for Markdown. macOS shows its own confirmation;
   * resolves when the system reports the outcome, rejects with `io` when it did not change.
   */
  makeDefaultMarkdownApp(): Promise<void>;
  /** Exports a Word document through Pandoc (3.6b; until then it rejects). */
  exportDocx(request: DocxRequest): Promise<void>;
  /**
   * The document as HTML from Pandoc (exact preview). A newer call from the same window cancels
   * the running one, which then rejects with the message `cancelled`.
   */
  pandocPreview(request: PandocPreviewRequest): Promise<string>;
  /** Stops the running exact-preview render of this window. */
  cancelPandocPreview(): Promise<void>;
  /**
   * Writes the page (its print root) as a PDF to a path the save dialog just returned for it
   * (kind `pdf`), once, without the print panel. Resolves when the file is in place.
   */
  exportPdf(path: string): Promise<void>;
  /**
   * File > Render with Quarto: opens the saved .qmd or .Rmd document in RStudio, or runs the render
   * in Terminal. Resolves to where it went. Writedown runs nothing itself.
   */
  renderWithQuarto(path: string): Promise<'rstudio' | 'terminal'>;

  // Session.
  /** The session of the last run, or null. Its folder and files are already granted. */
  getSession(): Promise<Session | null>;
  /**
   * Stores this window's part of the session; tabs and folders that are not granted are dropped
   * by Rust, which also records where the window is and puts all windows together.
   */
  setSession(session: Session): Promise<void>;

  // Crash recovery (Phase 5).
  /** Keeps the text of a document with unsaved changes under `id` (8 to 64 letters, digits, `-`). */
  recoveryWrite(id: string, entry: RecoveryWrite): Promise<void>;
  /** Removes recovery entries (a document was saved, discarded or closed). */
  recoveryRemove(ids: string[]): Promise<void>;
  /** The entries left by a run that did not end cleanly, oldest first. */
  recoveryList(): Promise<RecoveryEntry[]>;

  // Several windows (Phase 5).
  /**
   * Move Tab to New Window: opens a document window beside this one that will show the tab, and
   * resolves to its label. The caller removes the tab from this window afterwards.
   */
  moveTab(transfer: TabTransfer): Promise<string>;
  /** The tab state (or session tabs) that waits for this window's page, once; null otherwise. */
  takeTransfer(): Promise<WindowTransfer | null>;
  /** Reports the documents (canonical paths) this window holds, so a file is never open twice. */
  setWindowDocuments(paths: string[]): Promise<void>;
  /** The window's active document has unsaved changes (the unsaved dot in the close button). */
  setDocumentEdited(edited: boolean): Promise<void>;
  /**
   * Before opening a file this window does not hold: if another window holds it, that window
   * comes to the front and shows it, and this resolves to true (open nothing here).
   */
  focusOpenDocument(path: string): Promise<boolean>;
  /** At launch, `main` asks for the other windows of the stored session to be opened (once). */
  restoreWindows(): Promise<string[]>;

  // Recents, settings, document state.
  recentDocuments(): Promise<RecentEntry[]>;
  /** Grants a path from the recents list and resolves to it. Any other path is refused. */
  openRecent(path: string): Promise<string>;
  removeRecent(path: string): Promise<void>;
  clearRecents(): Promise<void>;
  getSettings(): Promise<Settings>;
  /** The snippets (the starter set on first use). */
  getSnippets(): Promise<Snippet[]>;
  /** Replaces the whole list (cleaned like a read) and resolves to what was stored. */
  setSnippets(list: Snippet[]): Promise<Snippet[]>;
  /** Applies a deep partial update (values are clamped) and resolves to the new settings. */
  updateSettings(patch: DeepPartial<Settings>): Promise<Settings>;
  getDocState(path: string): Promise<DocState>;
  setDocState(path: string, patch: Partial<DocState>): Promise<void>;

  // Window and lifecycle.
  /**
   * Files opened before the page was ready (Finder, Dock, drag and drop). Call it once at
   * startup, after `onOpenFiles`: from then on the files arrive as `open-files` events.
   */
  takePendingOpenFiles(): Promise<string[]>;
  updateMenuState(state: MenuState): Promise<void>;
  setWindowTitle(title: string): Promise<void>;
  /** Opens the Preferences window, or brings it to the front: the same as the Settings menu item. */
  openPreferences(): Promise<void>;
  /** Preferences window only: closes this window (it is destroyed on close). The mock does nothing. */
  closeSelf(): Promise<void>;
  /** Tells Rust the page has seen `close-requested`. The Tauri platform does it by itself. */
  ackClose(): Promise<void>;
  /** The page is done: closes the window, or quits the app. */
  finishClose(reason: CloseReason): Promise<void>;
  /**
   * The user chose Cancel in the unsaved-changes question: ends the close or quit round. For a
   * quit that the system asked for (logout, restart, Dock menu Quit) it also cancels that quit.
   * Call it for the same `reason` the request came with, whenever the walk stops at Cancel.
   */
  cancelClose(reason: CloseReason): Promise<void>;

  // Events. Each resolves to a function that stops listening.
  /** Files opened from Finder, the Dock, by drag and drop, or from Open Recent. */
  onOpenFiles(handler: (paths: string[]) => void): Promise<() => void>;
  /** Menu items. Actions that arrived before the first listener are delivered to it. */
  onMenuAction(handler: (action: MenuAction) => void): Promise<() => void>;
  /**
   * The window's close button, Close Window, Quit, or a quit the system asked for (logout,
   * restart, Dock menu Quit, AppleScript `quit`) was used. The page must answer with
   * `finishClose` once every unsaved document is resolved, or with `cancelClose` if the user
   * chose Cancel. The Tauri platform acknowledges the request before it calls the handler.
   */
  onCloseRequested(handler: (reason: CloseReason) => void): Promise<() => void>;
  onSettingsChanged(handler: (settings: Settings) => void): Promise<() => void>;
  onRecentsChanged(handler: (recents: RecentEntry[]) => void): Promise<() => void>;
}

function isRunningInTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Any rejection becomes a `PlatformError`, so callers can rely on the shape. */
function toPlatformError(error: unknown): PlatformError {
  if (isPlatformError(error)) return error;
  const message =
    typeof error === 'string' && error !== ''
      ? error
      : error instanceof Error && error.message !== ''
        ? error.message
        : 'The operation failed.';
  return { code: 'io', message };
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toPlatformError(error);
  }
}

/** Subscribes to a backend event and resolves to the function that stops listening. */
function subscribe<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  return listen<T>(event, (message) => handler(message.payload));
}

function createTauriPlatform(): Platform {
  return {
    kind: 'tauri',
    appVersion: () => invoke<string>('app_version'),
    ping: () => invoke<string>('ping'),
    launchOptions: () => invoke<LaunchOptions>('launch_options'),
    openFileDialog: () => invoke<string | null>('pick_file'),
    readTextFile: (path) => invoke<TextFile>('read_text_file', { path }),
    perfMark: (name) => {
      // Fire and forget: a measurement must never break or delay the app.
      invoke('perf_mark', { name }).catch(() => {});
    },
    benchReport: (report) =>
      invoke('bench_report', {
        renderMs: report.renderMs,
        e2eMs: report.e2eMs,
        docBytes: report.docBytes,
      }),
    benchSearchReport: (report) =>
      invoke('bench_search_report', {
        query: report.query,
        runs: report.runs,
        error: report.error,
      }),

    openDialog: ({ multiple }) => call<string[]>('open_dialog', { multiple }),
    saveDialog: ({ suggestedName, directory, kind }) =>
      call<string | null>('save_dialog', { suggestedName, directory, kind }),
    confirmUnsaved: (name) => call<'save' | 'discard' | 'cancel'>('confirm_unsaved', { name }),
    ask: ({ title, message, ok, cancel }) => call<boolean>('ask', { title, message, ok, cancel }),

    readDocument: (path) => call<DocumentFile>('read_document', { path }),
    saveDocument: (path, text, format, options) =>
      call<SaveResult>('save_document', { path, text, format, options }),
    documentContext: (path) => call<DocumentContext>('document_context', { path }),
    revealInFinder: (path) => call<void>('reveal_in_finder', { path }),
    openExternal: (url) => call<void>('open_external', { url }),
    openLinkedDocument: (fromPath, href) =>
      call<string>('open_linked_document', { fromPath, href }),
    revealLinkedFile: (fromPath, href) => call<void>('reveal_linked_file', { fromPath, href }),
    resolveImage: (docPath, src) => call<string>('resolve_image', { docPath, src }),
    readImageBytes: async (docPath, src, maxBytes) =>
      new Uint8Array(await call<ArrayBuffer>('read_image_bytes', { docPath, src, maxBytes })),
    savePastedImage: async (docPath, bytes, name) => {
      try {
        // The bytes travel as the raw body; the strings as headers, which must be ASCII.
        return await invoke<string>('save_pasted_image', bytes, {
          headers: {
            'x-doc-path': encodeURIComponent(docPath),
            'x-image-name': encodeURIComponent(name),
          },
        });
      } catch (error) {
        throw toPlatformError(error);
      }
    },
    importDroppedImage: (docPath, source) =>
      call<string>('import_dropped_image', { docPath, source }),
    readLinkedText: (fromPath, href, purpose) =>
      call<LinkedText>('read_linked_text', { fromPath, href, purpose }),
    vaultIndex: (docPath) => call<VaultIndex | null>('vault_index', { docPath }),
    quartoProject: (docPath) => call<LinkedText | null>('quarto_project', { docPath }),

    folderDialog: (purpose) => call<string | null>('folder_dialog', { purpose }),
    listFolder: (path) => call<FolderListing>('list_folder', { path }),
    fileIndex: (folder) => call<{ paths: string[]; truncated: boolean }>('file_index', { folder }),
    createFile: (folder, name) => call<string>('create_file', { folder, name }),
    createFolder: (folder, name) => call<string>('create_folder', { folder, name }),
    renamePath: (path, newName) => call<string>('rename_path', { path, newName }),
    movePath: (path, toFolder) => call<string>('move_path', { path, toFolder }),
    duplicatePath: (path) => call<string>('duplicate_path', { path }),
    trashPath: (path) => call<void>('trash_path', { path }),

    watch: (set) => call<void>('watch', { set }),
    onFileChanged: (handler) => subscribe<FileChange[]>('file-changed', handler),
    onDropImages: (handler) => subscribe<ImageDrop>('drop-images', handler),
    searchFolder: (request) => call<SearchResult>('search_folder', { request }),
    cancelSearch: (id) => call<void>('cancel_search', { id }),

    writeClipboard: ({ text, html }) => call<void>('write_clipboard', { text, html: html ?? null }),
    readClipboardText: () => call<string>('read_clipboard_text'),
    printPage: () => call<void>('print_page'),
    writeExport: (path, contents) => call<void>('write_export', { path, contents }),
    pandocInfo: () => call<{ path: string; version: string } | null>('pandoc_info'),
    choosePandoc: () => call<string | null>('choose_pandoc'),
    chooseDefaultFolder: () => call<string | null>('choose_default_folder'),
    defaultMarkdownApp: () =>
      call<{ isWritedown: boolean; appName: string | null }>('default_markdown_app'),
    makeDefaultMarkdownApp: () => call<void>('make_default_markdown_app'),
    exportDocx: (request) => call<void>('export_docx', { request }),
    pandocPreview: (request) => call<string>('pandoc_preview', { request }),
    cancelPandocPreview: () => call<void>('cancel_pandoc_preview'),
    exportPdf: (path) => call<void>('export_pdf', { path }),
    renderWithQuarto: (path) => call<'rstudio' | 'terminal'>('render_with_quarto', { path }),

    getSession: () => call<Session | null>('get_session'),
    setSession: (session) => call<void>('set_session', { session }),
    moveTab: (transfer) => call<string>('move_tab', { payload: transfer }),
    takeTransfer: () => call<WindowTransfer | null>('take_transfer'),
    setWindowDocuments: (paths) => call<void>('set_window_documents', { paths }),
    setDocumentEdited: (edited) => call<void>('set_document_edited', { edited }),
    focusOpenDocument: (path) => call<boolean>('focus_open_document', { path }),
    restoreWindows: () => call<string[]>('restore_windows'),

    recoveryWrite: (id, entry) => call<void>('recovery_write', { id, entry }),
    recoveryRemove: (ids) => call<void>('recovery_remove', { ids }),
    recoveryList: () => call<RecoveryEntry[]>('recovery_list'),

    recentDocuments: () => call<RecentEntry[]>('recent_documents'),
    openRecent: (path) => call<string>('open_recent', { path }),
    removeRecent: (path) => call<void>('remove_recent', { path }),
    clearRecents: () => call<void>('clear_recents'),
    getSettings: () => call<Settings>('get_settings'),
    getSnippets: () => call<Snippet[]>('get_snippets'),
    setSnippets: (list) => call<Snippet[]>('set_snippets', { list }),
    updateSettings: (patch) => call<Settings>('update_settings', { patch }),
    getDocState: (path) => call<DocState>('get_doc_state', { path }),
    setDocState: (path, patch) => call<void>('set_doc_state', { path, patch }),

    takePendingOpenFiles: () => call<string[]>('take_pending_open_files'),
    updateMenuState: (state) => call<void>('update_menu_state', { state }),
    setWindowTitle: (title) => call<void>('set_window_title', { title }),
    openPreferences: () => call<void>('open_preferences'),
    closeSelf: async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    },
    ackClose: () => call<void>('ack_close'),
    finishClose: (reason) => call<void>('finish_close', { reason }),
    cancelClose: (reason) => call<void>('cancel_close', { reason }),

    onOpenFiles: (handler) => subscribe<string[]>('open-files', handler),
    onMenuAction: async (handler) => {
      const stop = await subscribe<MenuAction>('menu-action', handler);
      // The listener exists now: actions that arrived while the window was being created are
      // delivered, and later ones go straight to it.
      try {
        await call<void>('menu_ready');
      } catch (error) {
        stop();
        throw error;
      }
      return stop;
    },
    onCloseRequested: (handler) =>
      subscribe<CloseReason>('close-requested', (reason) => {
        // The page is alive and has seen the request. Rust would otherwise close the window
        // anyway after two seconds, so that a broken page can never trap the user.
        call<void>('ack_close').catch(() => {});
        handler(reason);
      }),
    onSettingsChanged: (handler) => subscribe<Settings>('settings-changed', handler),
    onRecentsChanged: (handler) => subscribe<RecentEntry[]>('recents-changed', handler),
  };
}

async function loadPlatform(): Promise<Platform> {
  if (isRunningInTauri()) {
    return createTauriPlatform();
  }
  // A separate chunk: the mock is never loaded inside the real app.
  const { createMockPlatform } = await import('./platform-mock');
  return createMockPlatform();
}

let platformPromise: Promise<Platform> | undefined;

/** Returns the platform for the current environment. The same instance is reused. */
export function getPlatform(): Promise<Platform> {
  platformPromise ??= loadPlatform().catch((error: unknown) => {
    platformPromise = undefined; // allow a retry after a failed load
    throw error;
  });
  return platformPromise;
}
