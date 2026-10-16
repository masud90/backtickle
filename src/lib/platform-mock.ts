/**
 * In-memory stand-in for the Rust side. Used by `npm run dev` in a plain browser, by the
 * Playwright UI tests and by unit tests. Loaded on demand by `getPlatform()`.
 *
 * It follows the same rules as the Rust side: a path can only be read or saved after it was
 * granted (dialogs, `--open`, `open-files` events, Open Recent, links from a granted document),
 * recents keep their order and cap, settings are clamped, and a save fails with the same error
 * codes (`modified-externally`, `lossy`, `read-only`, `not-allowed`).
 *
 * Tests shape the mock before the page loads by defining `window.__WRITEDOWN_MOCK_SEED__`
 * (Playwright: `page.addInitScript`). While the page runs they fire events and read what the
 * app did through `window.__WRITEDOWN_MOCK__` (see `MockControl`).
 */
import type {
  BenchReport,
  CloseReason,
  DeepPartial,
  DocState,
  DocumentContext,
  DocumentFile,
  DocxRequest,
  Encoding,
  FileChange,
  FolderEntry,
  FolderListing,
  ImageDrop,
  LaunchOptions,
  LineEnding,
  LinkedText,
  LinkedTextPurpose,
  LocationKind,
  MenuAction,
  MenuState,
  PandocPreviewRequest,
  Platform,
  PlatformError,
  PlatformErrorCode,
  RecentEntry,
  RecoveryEntry,
  SaveFormat,
  SaveOptions,
  SaveResult,
  SearchBenchReport,
  SearchFileResult,
  SearchRequest,
  SearchResult,
  Session,
  Settings,
  Snippet,
  TabTransfer,
  TextFile,
  VaultIndex,
  WatchSet,
  WindowTransfer,
} from './platform';
import { canonicalShortcut, EDITOR_PREFIX } from './shortcut-keys';

export const MOCK_APP_VERSION = '0.0.0-mock';
/** The Rust side refuses files larger than this. */
export const MAX_TEXT_FILE_BYTES = 50 * 1024 * 1024;
/** The five snippets of a first use (the same as `src-tauri/src/snippets.rs`). */
export const STARTER_SNIPPETS: Snippet[] = [
  {
    id: 'starter-callout',
    name: 'Callout',
    trigger: 'callout',
    body: '> [!NOTE]\n> {{selection}}\n',
  },
  {
    id: 'starter-table',
    name: 'Table',
    trigger: 'table',
    body: '| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n',
  },
  {
    id: 'starter-tasks',
    name: 'Task list',
    trigger: 'tasks',
    body: '- [ ] First task\n- [ ] Second task\n- [ ] Third task\n',
  },
  {
    id: 'starter-footnote',
    name: 'Footnote',
    trigger: 'footnote',
    body: 'Text with a note.[^1]\n\n[^1]: The note.\n',
  },
  {
    id: 'starter-frontmatter',
    name: 'Frontmatter',
    trigger: 'frontmatter',
    body: '---\ntitle: \ndate: {{date}}\n---\n',
  },
];

let snippetCounter = 0;

/** What the backend does to a list: drop nameless entries, clear bad triggers, unique ids. */
function cleanSnippets(list: Snippet[]): Snippet[] {
  const seen = new Set<string>();
  const out: Snippet[] = [];
  for (const entry of list.slice(0, 500)) {
    const name = entry.name.trim().slice(0, 100);
    if (!name) continue;
    let id = entry.id.trim();
    while (!id || seen.has(id)) id = `s-${++snippetCounter}`;
    seen.add(id);
    const trigger = entry.trigger.trim();
    out.push({
      id,
      name,
      trigger: /^[A-Za-z0-9_-]{1,32}$/.test(trigger) ? trigger : '',
      body: entry.body.slice(0, 20000),
    });
  }
  return out;
}

/** The mock's idea of the home folder, shown as `~` in recents. */
export const MOCK_HOME = '/Users/mock';
/** The modification time of a seeded file that does not name one. */
export const MOCK_FILE_MODIFIED_MS = 1_700_000_000_000;

const DOCUMENT_EXTENSIONS = [
  'md',
  'markdown',
  'mdown',
  'mkd',
  'mkdn',
  'mdx',
  'qmd',
  'rmd',
  'mmd',
  'txt',
];
const IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'avif',
  'bmp',
  'ico',
  'tif',
  'tiff',
  'heic',
];
const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd', 'mkdn'];
const BIBLIOGRAPHY_EXTENSIONS = ['bib', 'bibtex', 'json', 'yaml', 'yml'];
/** The limits of `readLinkedText` by purpose, and of `quartoProject`. */
const LINKED_TEXT_LIMITS: Record<LinkedTextPurpose, number> = {
  bibliography: 10 * 1024 * 1024,
  include: 5 * 1024 * 1024,
  embed: 5 * 1024 * 1024,
};
const MAX_QUARTO_PROJECT_BYTES = 1024 * 1024;
const QUARTO_LEVELS = 8;
const MAX_VAULT_INDEX_ENTRIES = 20_000;
const SKIPPED_VAULT_FOLDERS = ['.obsidian', '.trash', 'node_modules'];
const FLAVORS = ['commonmark', 'gfm', 'obsidian', 'pandoc', 'quarto', 'mdx'];
const MAX_DOC_STATES = 500;
const MAX_LEVEL_ENTRIES = 5000;
const MAX_INDEX_FILES = 20_000;
const MAX_IGNORED_NAMES = 200;
const MAX_CURSOR_LINE = 100_000_000;
const MAX_CURSOR_COLUMN = 10_000_000;
const MAX_RECENTS = 100;

/** A seeded file with the metadata `readDocument` reports. Only `text` is required. */
export interface MockFileSeed {
  /** The text as it is on disk, line endings and all (`\r\n` makes a CRLF file). */
  text: string;
  encoding?: Encoding;
  legacyEncoding?: string | null;
  lossy?: boolean;
  lineEnding?: LineEnding;
  mixedLineEndings?: boolean;
  readOnly?: boolean;
  /** The size on disk. Computed from the text and the encoding if omitted. */
  bytes?: number;
  modifiedMs?: number;
}

type Choice = 'save' | 'discard' | 'cancel';

export interface MockSeed {
  /** Files the mock can serve, by path: the text, or the text with its metadata. */
  files?: Record<string, string | MockFileSeed>;
  /**
   * What the Phase 0 open dialog (`openFileDialog`) returns: a path, or null for "cancelled".
   * Without this field it returns the first file of `files`, or null if there are none.
   */
  dialog?: string | null;
  /** Overrides for the launch options, for example `{ welcome: true }` or `{ perf: true }`. */
  launch?: Partial<LaunchOptions>;

  // Answers of the Phase 1 dialogs. A single value answers every call; an array answers the
  // calls in order, and once it is used up the dialog is "cancelled".
  /** `openDialog`: the paths chosen (`[]` is "cancelled"), or a list of such answers. */
  openDialog?: string[] | string[][];
  /** `saveDialog`: the path chosen, null for "cancelled", or a list of such answers. */
  saveDialog?: string | null | Array<string | null>;
  confirmUnsaved?: Choice | Choice[];
  ask?: boolean | boolean[];

  /** The recents list, newest first. A string is a path. */
  recents?: Array<string | { path: string; openedAtMs?: number; bytes?: number; exists?: boolean }>;
  settings?: DeepPartial<Settings>;
  /** The snippets file; without it the five starter snippets are there. */
  snippets?: Snippet[];
  docState?: Record<string, DocState>;
  /** Answers of `documentContext` by path; anything not listed is derived from the path. */
  documentContext?: Record<string, Partial<DocumentContext>>;
  /** Local images: the resolved path of each, and the URL `resolveImage` answers with. */
  images?: Record<string, string>;
  /** Bytes `readImageBytes` answers with, by resolved path (default: a 1x1 PNG). */
  imageBytes?: Record<string, number[]>;
  /** Other existing local paths (files or folders) that links can point to. */
  existing?: string[];
  /** Folders that contain `.obsidian`. */
  vaults?: string[];
  /**
   * A vault with an index: `vaultIndex` lists the seeded files (`files`, `images`, `existing`)
   * under `root`, with the same skip rules as Rust. The root also counts as a vault folder.
   */
  vault?: { root: string };
  home?: string;
  // ---- Phase 3 ----
  /** Folders with nothing in them (folders that hold seeded files exist anyway). */
  folders?: string[];
  /** `folderDialog`: the folder chosen, null for "cancelled", or a list of such answers. */
  folderDialog?: string | null | Array<string | null>;
  /** The session `getSession` returns. */
  session?: Session | null;
  /** Recovery entries left by a crash (used when the page has none stored yet). */
  recovery?: RecoveryEntry[];
  /** The text on the clipboard (`readClipboardText`). */
  clipboard?: string;
  /** `choosePandoc`: the path chosen, null for "cancelled", or a list of such answers. */
  pandocDialog?: string | null | Array<string | null>;
  /** `chooseDefaultFolder`: the folder chosen, null for "cancelled", or a list of such answers. */
  defaultFolderDialog?: string | null | Array<string | null>;
  /** What `pandocInfo` returns. Default null (no Pandoc). */
  pandoc?: { path: string; version: string } | null;
  /** What `defaultMarkdownApp` returns. Default: another app named Typora, not Writedown. */
  defaultApp?: { isWritedown: boolean; appName: string | null };
  /** `makeDefaultMarkdownApp` rejects with this message (the system did not change it). */
  makeDefaultError?: string;
  /** `exportDocx`: `error` makes it reject with that message; `hold` keeps it pending until `finishDocx`. */
  exportDocx?: { error?: string; hold?: boolean };
  /** `exportPdf`: `error` makes it reject with that message. */
  exportPdf?: { error?: string };
  /** `renderWithQuarto`: `target` is the answer (default `terminal`); `error` makes it reject with that message. */
  renderWithQuarto?: { target?: 'rstudio' | 'terminal'; error?: string };
  /**
   * `pandocPreview`: `html` is the answer (default `<p>Pandoc preview</p>`), a function gets the
   * request; `error` makes it reject; `hold` keeps it pending until `finishPandocPreview`.
   */
  pandocPreview?: {
    html?: string | ((request: PandocPreviewRequest) => string);
    error?: string;
    hold?: boolean;
  };
  /** Results of `searchFolder` by query; a query that is not listed finds nothing. */
  searchResults?: Record<
    string,
    { files: SearchFileResult[]; truncated?: boolean; error?: string | null }
  >;
  /** Searches stay pending until `finishSearch(id)` or `cancelSearch(id)`. */
  searchHold?: boolean;
  /** Files "opened before the page was ready": they are granted and `takePendingOpenFiles` returns them. */
  pendingOpenFiles?: string[];
}

export interface MockSave {
  path: string;
  text: string;
  format: SaveFormat;
  options: SaveOptions;
  result: SaveResult;
}

export interface MockAsk {
  title: string;
  message: string;
  ok: string;
  cancel: string;
}

/** What tests use to drive and inspect the mock: `window.__WRITEDOWN_MOCK__`. */
export interface MockControl {
  // Fire events, as the Rust side would.
  /** Files opened from Finder, the Dock or drag and drop (documents only; granted). */
  openFiles(paths: string[]): void;
  menuAction(action: MenuAction): void;
  closeRequested(reason: CloseReason): void;
  /** Applies an update as if another window had made it, and notifies the listeners. */
  settingsChanged(patch?: DeepPartial<Settings>): void;
  /** Notifies the listeners with the current recents. */
  recentsChanged(): void;
  /** Someone else changed the file: its modification time moves on (and its text, if given). */
  externallyModify(path: string, text?: string): void;
  /** Replaces the answers of the dialogs (same shapes as in the seed). */
  setAnswers(answers: Pick<MockSeed, 'openDialog' | 'saveDialog' | 'confirmUnsaved' | 'ask'>): void;

  // ---- Phase 3 ----
  /** A batch of changes from the (fake) watcher, delivered to every `onFileChanged` handler. */
  fileChanged(changes: FileChange[]): void;
  /** Image files dropped on the window at a point of the page (CSS pixels). */
  dropImages(paths: string[], x: number, y: number): void;
  /** Images written by `savePastedImage` and `importDroppedImage`, in order. */
  readonly savedImages: Array<{ path: string; bytes: number; from: string | null }>;
  /** Someone else created a file (not recorded as an app operation). */
  externallyCreate(path: string, text?: string): void;
  /** Someone else removed a file or a folder with everything in it. */
  externallyRemove(path: string): void;
  /** Replaces the answers of `folderDialog`. */
  setFolderAnswers(answers: string | null | Array<string | null>): void;
  /** Replaces the answers of `choosePandoc`. */
  setPandocAnswers(answers: string | null | Array<string | null>): void;
  /** Replaces the answers of `chooseDefaultFolder`. */
  setDefaultFolderAnswers(answers: string | null | Array<string | null>): void;
  /** Scripts what `pandocInfo` returns. */
  setPandoc(info: { path: string; version: string } | null): void;
  /** Scripts what `defaultMarkdownApp` returns. */
  setDefaultMarkdownApp(app: { isWritedown: boolean; appName: string | null }): void;
  /** Makes `makeDefaultMarkdownApp` reject with this message, or succeed with null. */
  setMakeDefaultError(message: string | null): void;
  /** Scripts the result of a search for `query`. */
  setSearchResult(
    query: string,
    result: {
      files: SearchFileResult[];
      truncated?: boolean;
      error?: string | null;
    },
  ): void;
  /** Ends a held search with its scripted result. */
  finishSearch(id: number): void;
  /** Ends a held `exportDocx`, with an error message or successfully. */
  finishDocx(error?: string): void;
  /** Ends a held `pandocPreview` (the oldest) with HTML, or with an error message. */
  finishPandocPreview(result: { html?: string; error?: string }): void;
  /** Scripts the answers of `pandocPreview` from now on. */
  setPandocPreview(answer: MockSeed['pandocPreview']): void;
  /** Every `pandocPreview` request, in order. */
  readonly pandocPreviewRequests: PandocPreviewRequest[];
  /** How many `cancelPandocPreview` calls happened. */
  readonly pandocPreviewCancels: number;
  /** The files and folders of the fake tree, sorted. */
  tree(): { files: string[]; folders: string[] };
  /** The folders granted by `folderDialog` or the launch options. */
  readonly grantedFolders: string[];
  readonly folderDialogs: Array<'open' | 'move'>;
  /** File operations in order (also failed ones are not recorded). */
  readonly fileOps: Array<{
    op: string;
    from: string | null;
    to: string | null;
  }>;
  readonly trashed: string[];
  readonly clipboardWrites: Array<{ text: string; html: string | null }>;
  readonly clipboard: string;
  /** How many times `printPage` was called. */
  readonly prints: number;
  /** For each `printPage` call: the HTML of the element `#wd-print-root` at that moment, or null. */
  readonly printRoots: Array<string | null>;
  /** HTML (or other text) written by `writeExport`. */
  readonly exports: Array<{ path: string; contents: string }>;
  readonly docxRequests: DocxRequest[];
  /** For each `exportPdf` call: the path and the HTML of `#wd-print-root` at that moment, or null. */
  readonly pdfExports: Array<{ path: string; root: string | null }>;
  /** The path of each `renderWithQuarto` call. */
  readonly renderRequests: string[];
  readonly searches: SearchRequest[];
  readonly cancelledSearches: number[];
  readonly watches: WatchSet[];
  /** The recovery entries stored now (they survive a page reload, like a file on disk). */
  readonly recoveryEntries: RecoveryEntry[];
  /** Every session `setSession` stored, in order. */
  readonly sessions: Session[];
  /** The session as stored now. */
  readonly session: Session | null;

  // What the app did, in order. The arrays are live.
  readonly saves: MockSave[];
  readonly externalUrls: string[];
  /** Paths shown in Finder by `revealInFinder` and `revealLinkedFile`. */
  readonly reveals: string[];
  readonly menuStates: MenuState[];
  readonly windowTitles: string[];
  /** How many times the page asked to open the Preferences window. */
  readonly preferencesOpened: number;
  readonly finishCloses: CloseReason[];
  /** The reasons `cancelClose` was called with. */
  readonly cancelCloses: CloseReason[];
  /** What each `saveDialog` call was asked for (the suggested name and the folder). */
  readonly saveDialogs: Array<{
    suggestedName: string;
    directory: string | null;
    kind?: 'document' | 'html' | 'docx' | 'pdf';
  }>;
  /** The settings as they are now. */
  readonly settings: Settings;
  /** The snippets as stored. */
  readonly snippets: Snippet[];
  /** The names `confirmUnsaved` was asked about. */
  readonly confirmations: string[];
  readonly asks: MockAsk[];
  /** How many times the page acknowledged `close-requested`. */
  readonly ackCloses: number;
  /** The paths currently granted. */
  readonly granted: string[];
  /** The text and metadata of a file as it is "on disk" now, or undefined. */
  file(path: string): (Required<Omit<MockFileSeed, 'bytes'>> & { bytes: number }) | undefined;
  // ---- Phase 5: several windows (the mock models a window as a page) ----
  /** The label of this page's window: `?mockWindow=doc-1` in the URL, else `main`. */
  readonly windowLabel: string;
  /** The tabs this window moved to new windows, in order, with the label each got. */
  readonly movedTabs: Array<{ label: string; transfer: TabTransfer }>;
  /** Every value `setDocumentEdited` was given, in order (the unsaved dot). */
  readonly documentEdited: boolean[];
  /** The documents `setWindowDocuments` last reported. */
  readonly windowDocuments: string[];
  /** Paths for which `focusOpenDocument` found another window and asked it to show them. */
  readonly focusedElsewhere: string[];
  /** Every `restoreWindows` call: the labels it created. */
  readonly restoredWindows: string[][];
  /** Forgets everything recorded above (not the files, recents or settings). */
  reset(): void;
}

declare global {
  interface Window {
    __WRITEDOWN_MOCK_SEED__?: MockSeed;
    /** Test control and inspection object of the mock platform. */
    __WRITEDOWN_MOCK__?: MockControl;
    /** Marks reported through `perfMark`, in order (milliseconds since page load). */
    __WRITEDOWN_MOCK_MARKS__?: Array<{ name: string; ms: number }>;
    /** The last typing benchmark report. */
    __WRITEDOWN_MOCK_BENCH__?: BenchReport;
    /** The last search benchmark report. */
    __WRITEDOWN_MOCK_SEARCH_BENCH__?: SearchBenchReport;
  }
}

// ---- helpers shared by the rules ---------------------------------------------------------------

function fail(code: PlatformErrorCode, message: string): Promise<never> {
  const error: PlatformError = { code, message };
  return Promise.reject(error);
}

const NOT_ALLOWED = 'Writedown has not been given access to this file. Open it with File > Open.';
const NOT_FOUND = 'The file was not found. It may have been moved or deleted.';
const EXISTS = 'An item with that name already exists in this folder.';
const INVALID_NAME =
  'That name cannot be used. A name cannot be empty, contain / or :, or start with a dot.';

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash <= 0 ? '/' : path.slice(0, slash);
}

/** Collapses `.` and `..` like the real path resolution does. */
function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

/** Normalizes line endings to `\n` and reports the majority, like the Rust reader. */
function normalizeLineEndings(text: string): {
  text: string;
  lineEnding: LineEnding;
  mixed: boolean;
} {
  let lf = 0;
  let crlf = 0;
  let cr = 0;
  const normalized = text.replace(/\r\n|\r|\n/g, (match) => {
    if (match === '\r\n') crlf++;
    else if (match === '\r') cr++;
    else lf++;
    return '\n';
  });
  const kinds = [lf, crlf, cr].filter((count) => count > 0).length;
  return {
    text: normalized,
    lineEnding: crlf > lf + cr ? 'crlf' : 'lf',
    mixed: kinds > 1 || cr > 0,
  };
}

function encodedLength(text: string, encoding: Encoding): number {
  switch (encoding) {
    case 'utf-8':
      return new TextEncoder().encode(text).length;
    case 'utf-8-bom':
      return new TextEncoder().encode(text).length + 3;
    default:
      return text.length * 2 + 2; // UTF-16: two bytes per code unit, plus the byte order mark
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pickInt(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clamp(Math.round(value), min, max)
    : fallback;
}

function pickFloat(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

function pickBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function pickChoice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function section(source: unknown, key: string): Record<string, unknown> {
  const value = (source as Record<string, unknown> | undefined)?.[key];
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** The settings defaults of the Rust side. */
export function defaultSettings(): Settings {
  return {
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
      insertSpaces: true,
      currentLine: true,
      autoPair: false,
      continueLists: true,
      typewriter: false,
      livePreview: false,
      paneHeaders: true,
      tabSize: 2,
      softWrap: true,
      lineNumbers: true,
      spellcheck: true,
    },
    view: {
      sidebarVisible: true,
      sidebarWidth: 240,
      splitRatio: 0.5,
      syncScroll: true,
      zoom: 1,
    },
    restoreSession: true,
    vibrancy: true,
    shortcuts: {},
    files: {
      ignore: ['node_modules', '_site', '_freeze', 'renv', 'venv', '__pycache__'],
    },
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
    saving: {
      autoSave: false,
      newLineEnding: 'lf',
      newFinalNewline: false,
      defaultFolder: null,
    },
  };
}

/** An absolute path, or null; null or '' clears; anything else keeps the fallback (as `settings.rs`). */
function pickFolderPath(value: unknown, fallback: string | null): string | null {
  if (value === null || value === '') return null;
  if (
    typeof value === 'string' &&
    value.startsWith('/') &&
    value.length <= 1024 &&
    !value.includes('\0')
  ) {
    return value;
  }
  return fallback;
}

/** Overrides only: a command id to a shortcut string or null. Unknown ids and unparsable strings are dropped; the object replaces the old one. */
/** A menu action id (letters, digits and dashes; Settings and Quit stay fixed) or an editor key. */
function isShortcutCommand(id: string): boolean {
  if (id.startsWith(EDITOR_PREFIX)) return id.length > EDITOR_PREFIX.length;
  return /^[a-z][a-z0-9-]*$/.test(id) && id !== 'settings' && id !== 'quit';
}

function pickShortcuts(
  value: unknown,
  fallback: Record<string, string | null>,
): Record<string, string | null> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ...fallback };
  const out: Record<string, string | null> = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!isShortcutCommand(id)) continue;
    if (entry === null) out[id] = null;
    else if (typeof entry === 'string') {
      const canonical = canonicalShortcut(entry);
      if (canonical !== null) out[id] = canonical;
    }
  }
  return out;
}

function pickNames(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const names: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const name = item.trim();
    if (name !== '' && name.length <= 255 && !name.includes('/') && !names.includes(name)) {
      names.push(name);
    }
  }
  return names.slice(0, MAX_IGNORED_NAMES);
}

/** Null clears; an absolute path to a file named `pandoc` sets; anything else keeps. */
function pickPandocPath(value: unknown, fallback: string | null): string | null {
  if (value === null || value === '') return null;
  if (
    typeof value === 'string' &&
    value.startsWith('/') &&
    value.length <= 1024 &&
    value.slice(value.lastIndexOf('/') + 1) === 'pandoc'
  ) {
    return value;
  }
  return fallback;
}

/**
 * The settings in `source` on top of `base`: a missing or wrongly typed value keeps the base,
 * numbers are clamped (the same rules as `settings.rs`).
 */
export function mergeSettings(base: Settings, source: unknown): Settings {
  const s = (source ?? {}) as Record<string, unknown>;
  const editor = section(source, 'editor');
  const view = section(source, 'view');
  const preview = section(source, 'preview');
  const a11y = section(source, 'a11y');
  const saving = section(source, 'saving');
  return {
    version: 1,
    defaultFlavor: pickChoice(
      s.defaultFlavor,
      FLAVORS as Settings['defaultFlavor'][],
      base.defaultFlavor,
    ),
    openExistingIn: pickChoice(
      s.openExistingIn,
      ['editor', 'split', 'preview'],
      base.openExistingIn,
    ),
    openNewIn: pickChoice(s.openNewIn, ['editor', 'split'], base.openNewIn),
    recentLimit: pickInt(s.recentLimit, base.recentLimit, 1, 100),
    appearance: pickChoice(s.appearance, ['system', 'light', 'dark'], base.appearance),
    readingWpm: pickInt(s.readingWpm, base.readingWpm, 50, 1000),
    editor: {
      fontFamily: pickChoice(
        editor.fontFamily,
        ['jetbrains-mono', 'sf-mono', 'menlo'],
        base.editor.fontFamily,
      ),
      fontSize: pickInt(editor.fontSize, base.editor.fontSize, 9, 32),
      lineHeight: pickFloat(editor.lineHeight, base.editor.lineHeight, 1.2, 2.4),
      insertSpaces: pickBool(editor.insertSpaces, base.editor.insertSpaces),
      currentLine: pickBool(editor.currentLine, base.editor.currentLine),
      autoPair: pickBool(editor.autoPair, base.editor.autoPair),
      continueLists: pickBool(editor.continueLists, base.editor.continueLists),
      typewriter: pickBool(editor.typewriter, base.editor.typewriter),
      livePreview: pickBool(editor.livePreview, base.editor.livePreview),
      paneHeaders: pickBool(editor.paneHeaders, base.editor.paneHeaders),
      tabSize: pickInt(editor.tabSize, base.editor.tabSize, 1, 8),
      softWrap: pickBool(editor.softWrap, base.editor.softWrap),
      lineNumbers: pickBool(editor.lineNumbers, base.editor.lineNumbers),
      spellcheck: pickBool(editor.spellcheck, base.editor.spellcheck),
    },
    view: {
      sidebarVisible: pickBool(view.sidebarVisible, base.view.sidebarVisible),
      sidebarWidth: pickInt(view.sidebarWidth, base.view.sidebarWidth, 180, 480),
      splitRatio: pickFloat(view.splitRatio, base.view.splitRatio, 0.2, 0.8),
      syncScroll: pickBool(view.syncScroll, base.view.syncScroll),
      zoom: pickFloat(view.zoom, base.view.zoom, 0.5, 2),
    },
    restoreSession: pickBool(s.restoreSession, base.restoreSession),
    vibrancy: pickBool(s.vibrancy, base.vibrancy),
    shortcuts: pickShortcuts(s.shortcuts, base.shortcuts),
    files: {
      ignore: pickNames(section(source, 'files').ignore, base.files.ignore),
    },
    export: {
      pandocPath: pickPandocPath(section(source, 'export').pandocPath, base.export.pandocPath),
    },
    preview: {
      autoDetectFlavor: pickBool(preview.autoDetectFlavor, base.preview.autoDetectFlavor),
      font: pickChoice(
        preview.font,
        ['inter', 'system', 'literata', 'atkinson', 'lexend', 'opendyslexic'],
        base.preview.font,
      ),
      fontSize: pickInt(preview.fontSize, base.preview.fontSize, 12, 28),
      columnWidth: pickInt(preview.columnWidth, base.preview.columnWidth, 560, 1040),
      hashtagPills: pickBool(preview.hashtagPills, base.preview.hashtagPills),
      obsidianCommentsDimmed: pickBool(
        preview.obsidianCommentsDimmed,
        base.preview.obsidianCommentsDimmed,
      ),
      smartPunctuation: pickBool(preview.smartPunctuation, base.preview.smartPunctuation),
      math: pickBool(preview.math, base.preview.math),
      remoteImages: pickBool(preview.remoteImages, base.preview.remoteImages),
      codeCards: pickChoice(preview.codeCards, ['dark', 'light'], base.preview.codeCards),
    },
    a11y: {
      dyslexia: pickBool(a11y.dyslexia, base.a11y.dyslexia),
      dyslexiaFont: pickChoice(
        a11y.dyslexiaFont,
        ['opendyslexic', 'atkinson', 'lexend'],
        base.a11y.dyslexiaFont,
      ),
      ruler: pickBool(a11y.ruler, base.a11y.ruler),
      rulerTint: pickChoice(
        a11y.rulerTint,
        ['yellow', 'blue', 'green', 'pink'],
        base.a11y.rulerTint,
      ),
      spotlight: pickBool(a11y.spotlight, base.a11y.spotlight),
      reduceMotion: pickChoice(a11y.reduceMotion, ['system', 'on', 'off'], base.a11y.reduceMotion),
      highContrast: pickChoice(a11y.highContrast, ['system', 'on', 'off'], base.a11y.highContrast),
      scale: pickFloat(a11y.scale, base.a11y.scale, 1, 1.5),
    },
    saving: {
      autoSave: pickBool(saving.autoSave, base.saving.autoSave),
      newLineEnding: pickChoice(saving.newLineEnding, ['lf', 'crlf'], base.saving.newLineEnding),
      newFinalNewline: pickBool(saving.newFinalNewline, base.saving.newFinalNewline),
      defaultFolder: pickFolderPath(saving.defaultFolder, base.saving.defaultFolder),
    },
  };
}

/** `~` for the home folder, like the Rust side. */
function displayFolder(folder: string, home: string): string {
  if (folder === home) return '~';
  return folder.startsWith(`${home}/`) ? `~/${folder.slice(home.length + 1)}` : folder;
}

/** The cloud service of a path, from the same folder rules as `context.rs`. */
export function detectLocation(path: string, home: string): LocationKind {
  if (!path.startsWith(`${home}/`)) return 'local';
  const names = path
    .slice(home.length + 1)
    .split('/')
    .filter(Boolean)
    .map((name) => name.toLowerCase());
  if (names.length < 2) return 'local';
  if (names[0] === 'dropbox') return 'dropbox';
  if (names[0] !== 'library') return 'local';
  if (names[1] === 'mobile documents') {
    return names[2] === 'com~apple~clouddocs' && names.length > 3 ? 'icloud' : 'local';
  }
  if (names[1] === 'cloudstorage' && names.length >= 4) {
    const provider = names[2] ?? '';
    if (provider.startsWith('onedrive')) return 'onedrive';
    if (provider.startsWith('dropbox')) return 'dropbox';
    if (provider.startsWith('googledrive')) return 'google-drive';
  }
  return 'local';
}

/** The URL the mock gives a local image that has no seeded URL. */
/** A 1x1 transparent PNG, the default answer of `readImageBytes`. */
const MOCK_PNG = [
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0,
  0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45,
  180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
];

export function mockAssetUrl(path: string): string {
  return `asset://localhost/${encodeURIComponent(path)}`;
}

interface StoredFile {
  text: string;
  encoding: Encoding;
  legacyEncoding: string | null;
  lossy: boolean;
  lineEnding: LineEnding;
  mixedLineEndings: boolean;
  readOnly: boolean;
  bytes: number;
  modifiedMs: number;
}

function storeSeed(seed: string | MockFileSeed): StoredFile {
  const given = typeof seed === 'string' ? { text: seed } : seed;
  const normalized = normalizeLineEndings(given.text);
  const encoding = given.encoding ?? 'utf-8';
  return {
    text: normalized.text,
    encoding,
    legacyEncoding: given.legacyEncoding ?? null,
    lossy: given.lossy ?? false,
    lineEnding: given.lineEnding ?? normalized.lineEnding,
    mixedLineEndings: given.mixedLineEndings ?? normalized.mixed,
    readOnly: given.readOnly ?? false,
    bytes: given.bytes ?? encodedLength(given.text, encoding),
    modifiedMs: given.modifiedMs ?? MOCK_FILE_MODIFIED_MS,
  };
}

/** Answers for a dialog: one value for every call, or a list used in order. */
class Answers<T> {
  private queue: T[] | null = null;
  private single: { value: T } | null = null;

  private readonly fallback: T;
  private readonly isQueueOfAnswers: (value: unknown) => boolean;

  constructor(fallback: T, isQueueOfAnswers: (value: unknown) => boolean) {
    this.fallback = fallback;
    this.isQueueOfAnswers = isQueueOfAnswers;
  }

  set(value: unknown): void {
    if (value === undefined) {
      this.queue = null;
      this.single = null;
    } else if (this.isQueueOfAnswers(value)) {
      this.queue = [...(value as T[])];
      this.single = null;
    } else {
      this.queue = null;
      this.single = { value: value as T };
    }
  }

  next(defaultAnswer: T = this.fallback): T {
    if (this.single) return this.single.value;
    if (this.queue) return this.queue.length > 0 ? (this.queue.shift() as T) : this.fallback;
    return defaultAnswer;
  }
}

// ---- names and copies (the rules of file_ops.rs) -------------------------------------------------

/** The trimmed name, or null if it cannot be used (empty, `/`, `:`, control characters, leading dot, over 255 bytes). */
export function cleanName(name: string): string | null {
  const trimmed = name.trim();
  const control = [...trimmed].some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (
    trimmed === '' ||
    trimmed.startsWith('.') ||
    trimmed.includes('/') ||
    trimmed.includes(':') ||
    control ||
    new TextEncoder().encode(trimmed).length > 255
  ) {
    return null;
  }
  return trimmed;
}

/** `a copy.md`, `a copy 2.md`, ...: the name of the nth copy of `name`. */
export function copyName(name: string, number: number): string {
  const dot = name.lastIndexOf('.');
  const hasExtension = dot > 0 && dot + 1 < name.length;
  const stem = hasExtension ? name.slice(0, dot) : name;
  const extension = hasExtension ? name.slice(dot) : '';
  let base = stem;
  if (stem.endsWith(' copy')) base = stem.slice(0, -5);
  else {
    const numbered = /^(.*) copy (\d+)$/.exec(stem);
    if (numbered) base = numbered[1] as string;
  }
  return number <= 1 ? `${base} copy${extension}` : `${base} copy ${number}${extension}`;
}

/** True for the Markdown family (the files the Files tree lists). */
function isListedFile(name: string): boolean {
  return DOCUMENT_EXTENSIONS.includes(extensionOf(name));
}

function skippedName(name: string, ignore: string[]): boolean {
  return name.startsWith('.') || ignore.includes(name);
}

function underFolder(path: string, root: string): boolean {
  const base = root.replace(/\/$/, '');
  return path === base || path.startsWith(`${base}/`);
}

// ---- pasted and dropped images (the same rules as src-tauri/src/pasted_images.rs) ---------------

/** The image format of pasted bytes, as an extension, judged by the first bytes. */
export function sniffImage(bytes: Uint8Array): string | null {
  const starts = (...values: number[]) => values.every((value, i) => bytes[i] === value);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (starts(0xff, 0xd8, 0xff)) return 'jpg';
  if (starts(0x47, 0x49, 0x46, 0x38) && (bytes[4] === 0x37 || bytes[4] === 0x39)) return 'gif';
  const text = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes.length >= 12 && text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Letters, digits, `-`, `_` and `.`; anything else becomes `-`. Never empty, no leading dot. */
export function cleanImageStem(stem: string): string {
  let cleaned = '';
  for (const character of stem) {
    if (/[\p{L}\p{N}_.-]/u.test(character)) cleaned += character;
    else if (!cleaned.endsWith('-')) cleaned += '-';
  }
  const trimmed = [...cleaned.replace(/^[-.]+|[-.]+$/g, '')].slice(0, 80).join('');
  return trimmed === '' ? 'image' : trimmed;
}

/** The path of an image relative to a folder, encoded where Markdown needs it. */
export function relativeImageSrc(folder: string, path: string): string {
  return path
    .slice(folder.length + 1)
    .split('/')
    .map((part) =>
      part.replace(/[ ()<>[\]#?%\\"']/g, (c) =>
        Array.from(new TextEncoder().encode(c), (b) => `%${b.toString(16).toUpperCase()}`).join(''),
      ),
    )
    .join('/');
}

// ---- the platform ------------------------------------------------------------------------------

export function createMockPlatform(
  seed: MockSeed | undefined = typeof window === 'undefined'
    ? undefined
    : window.__WRITEDOWN_MOCK_SEED__,
): Platform {
  const home = seed?.home ?? MOCK_HOME;
  const files = new Map<string, StoredFile>(
    Object.entries(seed?.files ?? {}).map(([path, value]) => [path, storeSeed(value)]),
  );
  const images = new Map(Object.entries(seed?.images ?? {}));
  const existing = new Set(seed?.existing ?? []);
  const vaults = seed?.vaults ?? [];
  const granted = new Set<string>();
  /** What the app saw when it read or saved a file: modification time, size, lossy. */
  const seen = new Map<string, { modifiedMs: number; bytes: number; lossy: boolean }>();
  let clock = MOCK_FILE_MODIFIED_MS + 1000;
  const tick = () => {
    clock = Math.max(clock + 1, Date.now());
    return clock;
  };

  let settings = mergeSettings(defaultSettings(), seed?.settings);
  const docStates = new Map<string, DocState>();
  for (const [path, state] of Object.entries(seed?.docState ?? {})) {
    docStates.set(path, {
      flavor: state.flavor ?? null,
      cursor: state.cursor ?? null,
      scrollLine: state.scrollLine ?? null,
    });
  }
  let recents: Array<{
    path: string;
    openedAtMs: number;
    bytes?: number;
    exists?: boolean;
  }> = (seed?.recents ?? []).map((entry, index) =>
    typeof entry === 'string'
      ? { path: entry, openedAtMs: MOCK_FILE_MODIFIED_MS - index * 60_000 }
      : { openedAtMs: MOCK_FILE_MODIFIED_MS - index * 60_000, ...entry },
  );

  // Phase 3 state: folders, clipboard, export, search, session.
  const grantedFolders = new Set<string>();
  const explicitFolders = new Set<string>((seed?.folders ?? []).map((f) => f.replace(/\/$/, '')));
  const exportTargets = new Set<string>();
  let clipboardText = seed?.clipboard ?? '';
  let pandoc = seed?.pandoc ?? null;
  let defaultApp: { isWritedown: boolean; appName: string | null } = seed?.defaultApp ?? {
    isWritedown: false,
    appName: 'Typora',
  };
  let makeDefaultError: string | null = seed?.makeDefaultError ?? null;
  const searchResults = new Map(Object.entries(seed?.searchResults ?? {}));
  const pendingSearches = new Map<number, (result: SearchResult) => void>();
  const searchRequests = new Map<number, SearchRequest>();
  let previewAnswer = seed?.pandocPreview;
  const previewHolds: Array<{
    resolve: (html: string) => void;
    reject: (error: PlatformError) => void;
  }> = [];
  let docxHold: {
    resolve: () => void;
    reject: (error: PlatformError) => void;
  } | null = null;
  let storedSession: Session | null = seed?.session ? structuredClone(seed.session) : null;
  const folderAnswers = new Answers<string | null>(null, (v) => Array.isArray(v));
  folderAnswers.set(seed?.folderDialog);
  const pandocAnswers = new Answers<string | null>(null, (v) => Array.isArray(v));
  pandocAnswers.set(seed?.pandocDialog);
  const defaultFolderAnswers = new Answers<string | null>(null, (v) => Array.isArray(v));
  defaultFolderAnswers.set(seed?.defaultFolderDialog);
  const fileChangedHandlers = new Set<(changes: FileChange[]) => void>();
  const dropImageHandlers = new Set<(drop: ImageDrop) => void>();
  const droppedImages = new Set<string>();
  const savedImages: Array<{ path: string; bytes: number; from: string | null }> = [];
  /** `stem.ext` in the `assets` folder of `folder`, numbered like Rust if the name is taken. */
  const freeImagePath = (folder: string, stem: string, extension: string): string => {
    for (let number = 1; ; number++) {
      const name = number === 1 ? `${stem}.${extension}` : `${stem}-${number}.${extension}`;
      const path = `${folder}/assets/${name}`;
      if (!images.has(path) && !files.has(path) && !existing.has(path)) return path;
    }
  };
  const phase3 = {
    folderDialogs: [] as Array<'open' | 'move'>,
    fileOps: [] as Array<{
      op: string;
      from: string | null;
      to: string | null;
    }>,
    trashed: [] as string[],
    clipboardWrites: [] as Array<{ text: string; html: string | null }>,
    prints: 0,
    printRoots: [] as Array<string | null>,
    exports: [] as Array<{ path: string; contents: string }>,
    docxRequests: [] as DocxRequest[],
    previewRequests: [] as PandocPreviewRequest[],
    previewCancels: 0,
    pdfExports: [] as Array<{ path: string; root: string | null }>,
    renderRequests: [] as string[],
    searches: [] as SearchRequest[],
    cancelledSearches: [] as number[],
    watches: [] as WatchSet[],
    sessions: [] as Session[],
  };

  const openAnswers = new Answers<string[]>([], (v) => Array.isArray(v) && Array.isArray(v[0]));
  const saveAnswers = new Answers<string | null>(null, (v) => Array.isArray(v));
  const confirmAnswers = new Answers<Choice>('cancel', (v) => Array.isArray(v));
  const askAnswers = new Answers<boolean>(false, (v) => Array.isArray(v));
  openAnswers.set(seed?.openDialog);
  saveAnswers.set(seed?.saveDialog);
  confirmAnswers.set(seed?.confirmUnsaved);
  askAnswers.set(seed?.ask);

  // Phase 5: windows are pages of the same browser; they talk through the page's own storage
  // and a broadcast channel (both are per origin, so a test's pages share them).
  const windowLabel =
    (typeof location !== 'undefined'
      ? new URLSearchParams(location.search).get('mockWindow')
      : null) ??
    seed?.launch?.windowLabel ??
    'main';
  const windowStorage = (): Storage | null => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  };
  const readJson = <T>(key: string, fallback: T): T => {
    try {
      const text = windowStorage()?.getItem(key);
      return text ? (JSON.parse(text) as T) : fallback;
    } catch {
      return fallback;
    }
  };
  const writeJson = (key: string, value: unknown): void => {
    try {
      windowStorage()?.setItem(key, JSON.stringify(value));
    } catch {
      // storage unavailable: the multi-window mock then simply has no peers
    }
  };
  const RECOVERY_KEY = 'wd-mock-recovery';
  const recoveryStore = (): Record<string, RecoveryEntry> => {
    const stored = readJson<Record<string, RecoveryEntry> | null>(RECOVERY_KEY, null);
    if (stored) return stored;
    const seeded: Record<string, RecoveryEntry> = {};
    for (const entry of seed?.recovery ?? []) seeded[entry.id] = structuredClone(entry);
    writeJson(RECOVERY_KEY, seeded);
    return seeded;
  };
  const DOCS_KEY = 'wd-mock-window-docs';
  const nextLabel = (): string => {
    const next = readJson<number>('wd-mock-next-window', 0) + 1;
    writeJson('wd-mock-next-window', next);
    return `doc-${next}`;
  };
  const windowLog = {
    movedTabs: [] as Array<{ label: string; transfer: TabTransfer }>,
    documents: [] as string[],
    focusedElsewhere: [] as string[],
    restored: [] as string[][],
  };

  const log = {
    saves: [] as MockSave[],
    externalUrls: [] as string[],
    reveals: [] as string[],
    menuStates: [] as MenuState[],
    documentEdited: [] as boolean[],
    windowTitles: [] as string[],
    preferencesOpened: 0,
    finishCloses: [] as CloseReason[],
    cancelCloses: [] as CloseReason[],
    saveDialogs: [] as Array<{
      suggestedName: string;
      directory: string | null;
      kind?: 'document' | 'html' | 'docx' | 'pdf';
    }>,
    confirmations: [] as string[],
    asks: [] as MockAsk[],
    ackCloses: 0,
  };

  // Event listeners, and the queues of events that arrive before the page listens.
  const openHandlers = new Set<(paths: string[]) => void>();
  const menuHandlers = new Set<(action: MenuAction) => void>();
  const closeHandlers = new Set<(reason: CloseReason) => void>();
  let snippets: Snippet[] = cleanSnippets(seed?.snippets ?? STARTER_SNIPPETS);
  const settingsHandlers = new Set<(settings: Settings) => void>();
  const recentsHandlers = new Set<(recents: RecentEntry[]) => void>();
  let pendingFiles: string[] = [];
  let filesReady = false;
  let pendingActions: MenuAction[] = [];
  let actionsReady = false;

  // Rust grants the files and the folder of the stored session at launch.
  for (const tab of storedSession?.tabs ?? []) granted.add(tab.path);
  for (const window of storedSession?.windows ?? []) {
    for (const tab of window.tabs) granted.add(tab.path);
  }
  if (storedSession?.folder) grantedFolders.add(storedSession.folder.replace(/\/$/, ''));

  for (const path of seed?.pendingOpenFiles ?? []) {
    granted.add(path);
    pendingFiles.push(path);
  }

  const recentEntries = (): RecentEntry[] =>
    recents.map((entry) => {
      const file = files.get(entry.path);
      const exists = entry.exists ?? file !== undefined;
      return {
        path: entry.path,
        name: baseName(entry.path),
        folder: displayFolder(parentOf(entry.path), home),
        openedAtMs: entry.openedAtMs,
        bytes: exists ? (entry.bytes ?? file?.bytes ?? null) : null,
        exists,
      };
    });

  const notifyRecents = () => {
    const list = recentEntries();
    for (const handler of recentsHandlers) handler(list);
  };

  /** Moves a path to the front of the recents; notifies if the order or members changed. */
  const touchRecent = (path: string) => {
    const wasFirst = recents[0]?.path === path;
    const existed = recents.some((entry) => entry.path === path);
    recents = [
      { path, openedAtMs: Date.now() },
      ...recents.filter((entry) => entry.path !== path),
    ].slice(0, clamp(settings.recentLimit, 1, MAX_RECENTS));
    if (!wasFirst || !existed) notifyRecents();
  };

  const deliverFiles = (paths: string[]) => {
    const unique = [...new Set(paths)];
    if (unique.length === 0) return;
    if (!filesReady) {
      pendingFiles.push(...unique);
      return;
    }
    for (const handler of openHandlers) handler(unique);
  };

  // Another window asked this one (through `focusOpenDocument`) to show a file it holds.
  try {
    const channel = new BroadcastChannel('wd-mock-windows');
    channel.onmessage = (event: MessageEvent) => {
      const message = event.data as { to?: string; type?: string; paths?: string[] };
      if (message.to === windowLabel && message.type === 'open-files' && message.paths) {
        for (const path of message.paths) granted.add(path);
        deliverFiles(message.paths);
      }
    };
  } catch {
    // no BroadcastChannel: windows do not talk to each other
  }

  const deliverAction = (action: MenuAction) => {
    if (!actionsReady) {
      pendingActions.push(action);
      return;
    }
    for (const handler of menuHandlers) handler(action);
  };

  // ---- path rules ----

  /** True if the path is a granted folder or below one (a spelling with `..` never is). */
  const inGrantedFolder = (path: string): boolean =>
    path === normalizePath(path) && [...grantedFolders].some((root) => underFolder(path, root));
  const isPermitted = (path: string): boolean => granted.has(path) || inGrantedFolder(path);

  const requireGranted = (path: string): Promise<never> | null =>
    isPermitted(path) ? null : fail('not-allowed', NOT_ALLOWED);

  const pathExists = (path: string): boolean => {
    if (files.has(path) || images.has(path) || existing.has(path)) return true;
    const prefix = `${path.replace(/\/$/, '')}/`;
    for (const known of [...files.keys(), ...images.keys(), ...existing]) {
      if (known.startsWith(prefix)) return true; // a folder that holds something
    }
    return false;
  };

  /** Resolves an href like `links.rs`: a path, or an error. */
  const resolveHref = (fromPath: string, href: string): string | PlatformError => {
    const trimmed = href.trim();
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
    let candidate: string;
    if (scheme) {
      if (scheme[1]?.toLowerCase() !== 'file') {
        return {
          code: 'not-allowed',
          message: 'This link does not point to a file on this Mac.',
        };
      }
      let url: URL;
      try {
        url = new URL(trimmed);
      } catch {
        return {
          code: 'not-allowed',
          message: 'This link does not point to a file on this Mac.',
        };
      }
      if (url.hostname !== '' && url.hostname !== 'localhost') {
        return {
          code: 'not-allowed',
          message: 'This link does not point to a file on this Mac.',
        };
      }
      try {
        candidate = decodeURIComponent(url.pathname);
      } catch {
        return { code: 'not-found', message: NOT_FOUND };
      }
    } else {
      const cut = trimmed.search(/[#?]/);
      const raw = cut === -1 ? trimmed : trimmed.slice(0, cut);
      if (raw === '') return { code: 'not-found', message: NOT_FOUND };
      let decoded: string;
      try {
        decoded = decodeURIComponent(raw);
      } catch {
        return { code: 'not-found', message: NOT_FOUND };
      }
      if (decoded.includes('\0')) return { code: 'not-found', message: NOT_FOUND };
      candidate = decoded.startsWith('/') ? decoded : `${parentOf(fromPath)}/${decoded}`;
    }
    const resolved = normalizePath(candidate);
    if (!pathExists(resolved)) {
      return {
        code: 'not-found',
        message: 'The linked file was not found. It may have been moved or deleted.',
      };
    }
    return resolved;
  };

  /** Files reached through a link: they can start further linked reads, nothing else. */
  const readOnlyGranted = new Set<string>();
  const requireReadable = (path: string): Promise<never> | null =>
    isPermitted(path) || readOnlyGranted.has(path) ? null : fail('not-allowed', NOT_ALLOWED);

  /** The nearest vault folder above a path (the seeded vault root or one of `vaults`). */
  const vaultRootOf = (path: string): string | null => {
    const folders = [...vaults, ...(seed?.vault ? [seed.vault.root] : [])]
      .map((folder) => folder.replace(/\/$/, ''))
      .filter((folder) => path.startsWith(`${folder}/`));
    folders.sort((a, b) => b.length - a.length);
    return folders[0] ?? null;
  };

  const readTextOf = (path: string, limit: number): Promise<LinkedText> => {
    const file = files.get(path);
    if (!file) return fail('not-found', NOT_FOUND);
    if (file.bytes > limit) {
      return fail('too-large', 'The file is larger than its limit, which Writedown does not read.');
    }
    return Promise.resolve({ path, text: file.text });
  };

  const buildVaultIndex = (root: string): VaultIndex => {
    const known = new Set<string>([...files.keys(), ...images.keys(), ...existing]);
    const prefix = `${root}/`;
    const relatives = [...known]
      .filter((path) => path.startsWith(prefix))
      .map((path) => path.slice(prefix.length))
      .filter((relative) => {
        const parts = relative.split('/');
        const folders = parts.slice(0, -1);
        const name = parts[parts.length - 1] ?? '';
        return (
          !name.startsWith('.') &&
          !folders.some(
            (folder) => folder.startsWith('.') || SKIPPED_VAULT_FOLDERS.includes(folder),
          )
        );
      })
      .sort((a, b) => {
        const left = a.split('/');
        const right = b.split('/');
        for (let i = 0; i < Math.min(left.length, right.length); i++) {
          const l = left[i] as string;
          const r = right[i] as string;
          if (l !== r) return l < r ? -1 : 1;
        }
        return left.length - right.length;
      });
    const notes: string[] = [];
    const attachments: string[] = [];
    let truncated = false;
    for (const relative of relatives) {
      const extension = extensionOf(relative);
      const isNote = MARKDOWN_EXTENSIONS.includes(extension);
      if (!isNote && !IMAGE_EXTENSIONS.includes(extension) && extension !== 'pdf') continue;
      if (notes.length + attachments.length >= MAX_VAULT_INDEX_ENTRIES) {
        truncated = true;
        break;
      }
      (isNote ? notes : attachments).push(relative);
    }
    return { root, notes, attachments, truncated };
  };

  // ---- the fake folder tree (Phase 3) ----

  const folderExists = (path: string): boolean => {
    const base = path.replace(/\/$/, '');
    if (explicitFolders.has(base) || grantedFolders.has(base)) return true;
    const prefix = `${base}/`;
    return [...files.keys(), ...explicitFolders].some((known) => known.startsWith(prefix));
  };

  /** Every folder that exists: explicit ones and the parents of files, below `/`. */
  const allFolders = (): string[] => {
    const folders = new Set<string>(explicitFolders);
    for (const root of grantedFolders) folders.add(root);
    for (const known of [...files.keys(), ...explicitFolders]) {
      let parent = parentOf(known);
      while (parent !== '/' && !folders.has(parent)) {
        folders.add(parent);
        parent = parentOf(parent);
      }
    }
    return [...folders].sort();
  };

  const storeSettings = async (patch: DeepPartial<Settings>): Promise<Settings> => {
    const next = mergeSettings(settings, patch);
    const changed = JSON.stringify(next) !== JSON.stringify(settings);
    settings = next;
    if (changed) {
      for (const handler of settingsHandlers) handler(structuredClone(next));
      if (recents.length > next.recentLimit) {
        recents = recents.slice(0, next.recentLimit);
        notifyRecents();
      }
    }
    return structuredClone(next);
  };

  const requireFolder = (path: string): PlatformError | null => {
    if (!inGrantedFolder(path)) return { code: 'not-allowed', message: NOT_ALLOWED };
    if (files.has(path)) return { code: 'io', message: 'This item is not a folder.' };
    if (!folderExists(path)) return { code: 'not-found', message: NOT_FOUND };
    return null;
  };

  const requireItem = (path: string): PlatformError | null => {
    if (!isPermitted(path)) return { code: 'not-allowed', message: NOT_ALLOWED };
    if (!files.has(path) && !folderExists(path)) return { code: 'not-found', message: NOT_FOUND };
    return null;
  };

  const nameTaken = (folder: string, name: string): boolean => {
    const target = `${folder.replace(/\/$/, '')}/${name}`;
    return files.has(target) || folderExists(target);
  };

  /** Moves the files, folders, grants, recents, document state and stamps from `from` to `to`. */
  const relocate = (from: string, to: string) => {
    const remap = (path: string): string | null =>
      path === from ? to : path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : null;
    for (const [path, file] of [...files]) {
      const next = remap(path);
      if (next === null) continue;
      files.delete(path);
      files.set(next, file);
    }
    for (const path of [...explicitFolders]) {
      const next = remap(path);
      if (next === null) continue;
      explicitFolders.delete(path);
      explicitFolders.add(next);
    }
    for (const set of [granted, readOnlyGranted, grantedFolders]) {
      for (const path of [...set]) {
        const next = remap(path);
        if (next === null) continue;
        set.delete(path);
        set.add(next);
      }
    }
    for (const [path, stamp] of [...seen]) {
      const next = remap(path);
      if (next === null) continue;
      seen.delete(path);
      seen.set(next, stamp);
    }
    for (const [path, state] of [...docStates]) {
      const next = remap(path);
      if (next === null) continue;
      docStates.delete(path);
      docStates.set(next, state);
    }
    let changed = false;
    recents = recents.flatMap((entry) => {
      const next = remap(entry.path);
      if (next === null) return [entry];
      changed = true;
      return [{ ...entry, path: next }];
    });
    const seenPaths = new Set<string>();
    recents = recents.filter((entry) => !seenPaths.has(entry.path) && seenPaths.add(entry.path));
    if (changed) notifyRecents();
  };

  const scriptedSearch = (request: SearchRequest): SearchResult => {
    const scripted = searchResults.get(request.query);
    const found = scripted?.files ?? [];
    const matchCount = found.reduce((sum, file) => sum + file.matches.length, 0);
    return {
      id: request.id,
      files: structuredClone(found),
      matchCount,
      fileCount: found.length,
      truncated: scripted?.truncated ?? false,
      cancelled: false,
      error: scripted?.error ?? null,
    };
  };

  const recordOp = (op: string, from: string | null, to: string | null) => {
    phase3.fileOps.push({ op, from, to });
  };

  const control: MockControl = {
    fileChanged(changes) {
      for (const handler of fileChangedHandlers) handler(structuredClone(changes));
    },
    dropImages(paths, x, y) {
      const accepted = paths.filter((path) => IMAGE_EXTENSIONS.includes(extensionOf(path)));
      for (const path of accepted) droppedImages.add(path);
      if (accepted.length === 0) return;
      for (const handler of dropImageHandlers) handler({ paths: accepted, x, y });
    },
    savedImages,
    externallyCreate(path, text = '') {
      files.set(path, storeSeed(text));
    },
    externallyRemove(path) {
      for (const known of [...files.keys()]) {
        if (known === path || known.startsWith(`${path}/`)) files.delete(known);
      }
      for (const known of [...explicitFolders]) {
        if (known === path || known.startsWith(`${path}/`)) explicitFolders.delete(known);
      }
    },
    setFolderAnswers(answers) {
      folderAnswers.set(answers);
    },
    setPandocAnswers(answers) {
      pandocAnswers.set(answers);
    },
    setDefaultFolderAnswers(answers) {
      defaultFolderAnswers.set(answers);
    },
    setPandoc(info) {
      pandoc = info;
    },
    setDefaultMarkdownApp(app) {
      defaultApp = { ...app };
    },
    setMakeDefaultError(message) {
      makeDefaultError = message;
    },
    setSearchResult(query, result) {
      searchResults.set(query, result);
    },
    finishSearch(id) {
      const finish = pendingSearches.get(id);
      const request = searchRequests.get(id);
      if (finish && request) finish(scriptedSearch(request));
    },
    finishDocx(error) {
      const hold = docxHold;
      docxHold = null;
      if (!hold) return;
      if (error) hold.reject({ code: 'io', message: error });
      else hold.resolve();
    },
    finishPandocPreview(result) {
      const hold = previewHolds.shift();
      if (!hold) return;
      if (result.error) hold.reject({ code: 'io', message: result.error });
      else hold.resolve(result.html ?? '');
    },
    setPandocPreview(answer) {
      previewAnswer = answer;
    },
    get pandocPreviewRequests() {
      return phase3.previewRequests;
    },
    get pandocPreviewCancels() {
      return phase3.previewCancels;
    },
    tree() {
      return { files: [...files.keys()].sort(), folders: allFolders() };
    },
    get grantedFolders() {
      return [...grantedFolders];
    },
    folderDialogs: phase3.folderDialogs,
    fileOps: phase3.fileOps,
    trashed: phase3.trashed,
    clipboardWrites: phase3.clipboardWrites,
    get clipboard() {
      return clipboardText;
    },
    get prints() {
      return phase3.prints;
    },
    printRoots: phase3.printRoots,
    exports: phase3.exports,
    docxRequests: phase3.docxRequests,
    pdfExports: phase3.pdfExports,
    renderRequests: phase3.renderRequests,
    searches: phase3.searches,
    cancelledSearches: phase3.cancelledSearches,
    watches: phase3.watches,
    sessions: phase3.sessions,
    get session() {
      return storedSession ? structuredClone(storedSession) : null;
    },
    openFiles(paths) {
      const accepted: string[] = [];
      for (const path of paths) {
        if (!DOCUMENT_EXTENSIONS.includes(extensionOf(path)) || !files.has(path)) continue;
        granted.add(path);
        accepted.push(path);
      }
      deliverFiles(accepted);
    },
    menuAction(action) {
      deliverAction(action);
    },
    closeRequested(reason) {
      for (const handler of closeHandlers) handler(reason);
    },
    settingsChanged(patch) {
      const next = mergeSettings(settings, patch);
      settings = next;
      for (const handler of settingsHandlers) handler(structuredClone(next));
    },
    recentsChanged() {
      notifyRecents();
    },
    externallyModify(path, text) {
      const file = files.get(path);
      if (!file) return;
      if (text !== undefined) {
        const normalized = normalizeLineEndings(text);
        file.text = normalized.text;
        file.bytes = encodedLength(text, file.encoding);
      }
      file.modifiedMs = tick();
    },
    setAnswers(answers) {
      if ('openDialog' in answers) openAnswers.set(answers.openDialog);
      if ('saveDialog' in answers) saveAnswers.set(answers.saveDialog);
      if ('confirmUnsaved' in answers) confirmAnswers.set(answers.confirmUnsaved);
      if ('ask' in answers) askAnswers.set(answers.ask);
    },
    saves: log.saves,
    externalUrls: log.externalUrls,
    reveals: log.reveals,
    menuStates: log.menuStates,
    documentEdited: log.documentEdited,
    windowTitles: log.windowTitles,
    get preferencesOpened() {
      return log.preferencesOpened;
    },
    finishCloses: log.finishCloses,
    cancelCloses: log.cancelCloses,
    saveDialogs: log.saveDialogs,
    get settings() {
      return structuredClone(settings);
    },
    get snippets() {
      return structuredClone(snippets);
    },
    confirmations: log.confirmations,
    asks: log.asks,
    get ackCloses() {
      return log.ackCloses;
    },
    get granted() {
      return [...granted];
    },
    file(path) {
      const file = files.get(path);
      return file ? { ...file } : undefined;
    },
    windowLabel,
    get recoveryEntries() {
      return Object.values(recoveryStore());
    },
    movedTabs: windowLog.movedTabs,
    windowDocuments: windowLog.documents,
    focusedElsewhere: windowLog.focusedElsewhere,
    restoredWindows: windowLog.restored,
    reset() {
      windowLog.movedTabs.length = 0;
      windowLog.focusedElsewhere.length = 0;
      windowLog.restored.length = 0;
      log.saves.length = 0;
      log.externalUrls.length = 0;
      log.reveals.length = 0;
      log.menuStates.length = 0;
      log.documentEdited.length = 0;
      log.windowTitles.length = 0;
      log.preferencesOpened = 0;
      log.finishCloses.length = 0;
      log.cancelCloses.length = 0;
      log.saveDialogs.length = 0;
      log.confirmations.length = 0;
      log.asks.length = 0;
      log.ackCloses = 0;
      phase3.folderDialogs.length = 0;
      phase3.fileOps.length = 0;
      phase3.trashed.length = 0;
      phase3.clipboardWrites.length = 0;
      phase3.prints = 0;
      phase3.printRoots.length = 0;
      phase3.exports.length = 0;
      phase3.docxRequests.length = 0;
      phase3.previewRequests.length = 0;
      phase3.previewCancels = 0;
      phase3.pdfExports.length = 0;
      phase3.renderRequests.length = 0;
      phase3.searches.length = 0;
      phase3.cancelledSearches.length = 0;
      phase3.watches.length = 0;
      phase3.sessions.length = 0;
    },
  };
  if (typeof window !== 'undefined') window.__WRITEDOWN_MOCK__ = control;

  const subscribe = <T>(set: Set<T>, handler: T): Promise<() => void> => {
    set.add(handler);
    return Promise.resolve(() => {
      set.delete(handler);
    });
  };

  return {
    kind: 'mock',
    appVersion: async () => MOCK_APP_VERSION,
    ping: async () => 'pong (mock)',

    launchOptions: async () => {
      const given = seed?.launch;
      const launch: LaunchOptions = {
        openPath: null,
        folderPath: null,
        welcome: false,
        perf: false,
        bench: false,
        view: null,
        ...given,
        windowLabel,
        restoreSession:
          given?.restoreSession ??
          !(given?.openPath || given?.folderPath || given?.welcome === true),
      };
      if (launch.openPath) granted.add(launch.openPath);
      if (launch.folderPath) grantedFolders.add(launch.folderPath.replace(/\/$/, ''));
      return launch;
    },

    openFileDialog: async () => {
      const path =
        seed && 'dialog' in seed ? (seed.dialog ?? null) : (files.keys().next().value ?? null);
      if (path) granted.add(path);
      return path;
    },

    readTextFile: async (path): Promise<TextFile> => {
      if (!granted.has(path)) {
        throw new Error('This file was not chosen in the open dialog.');
      }
      const file = files.get(path);
      if (file === undefined) {
        throw new Error(`File not found: ${path}`);
      }
      if (file.bytes > MAX_TEXT_FILE_BYTES) {
        throw new Error('File is larger than 50 MB.');
      }
      return { path, text: file.text, bytes: file.bytes };
    },

    perfMark: (name) => {
      if (typeof window === 'undefined') return;
      const marks = window.__WRITEDOWN_MOCK_MARKS__ ?? [];
      marks.push({ name, ms: performance.now() });
      window.__WRITEDOWN_MOCK_MARKS__ = marks;
    },

    benchReport: async (report) => {
      if (typeof window !== 'undefined') window.__WRITEDOWN_MOCK_BENCH__ = report;
    },
    benchSearchReport: async (report) => {
      if (typeof window !== 'undefined') window.__WRITEDOWN_MOCK_SEARCH_BENCH__ = report;
    },

    // ---- dialogs ----
    openDialog: async ({ multiple }) => {
      const chosen = openAnswers.next([]);
      const picked = multiple ? chosen : chosen.slice(0, 1);
      for (const path of picked) granted.add(path);
      return [...picked];
    },
    saveDialog: async ({ suggestedName, directory, kind }) => {
      log.saveDialogs.push(
        kind === undefined ? { suggestedName, directory } : { suggestedName, directory, kind },
      );
      let path = saveAnswers.next(null);
      if (
        path &&
        (kind === 'html' || kind === 'docx' || kind === 'pdf') &&
        !path.toLowerCase().endsWith(`.${kind}`)
      ) {
        path = `${path}.${kind}`;
      }
      if (path) {
        // An export path is only allowed for the export, not granted as a document.
        if (kind === 'html' || kind === 'docx' || kind === 'pdf') exportTargets.add(path);
        else granted.add(path);
      }
      return path;
    },
    confirmUnsaved: async (name) => {
      log.confirmations.push(name);
      return confirmAnswers.next('cancel');
    },
    ask: async (options) => {
      log.asks.push({ ...options });
      return askAnswers.next(false);
    },

    // ---- documents ----
    readDocument: async (path): Promise<DocumentFile> => {
      const refused = requireGranted(path);
      if (refused) return refused;
      const file = files.get(path);
      if (!file) return fail('not-found', NOT_FOUND);
      if (file.bytes > MAX_TEXT_FILE_BYTES) {
        return fail('too-large', 'The file is larger than 50 MB, which Writedown does not open.');
      }
      seen.set(path, {
        modifiedMs: file.modifiedMs,
        bytes: file.bytes,
        lossy: file.lossy,
      });
      touchRecent(path);
      return {
        path,
        text: file.text,
        encoding: file.encoding,
        legacyEncoding: file.legacyEncoding,
        lossy: file.lossy,
        lineEnding: file.lineEnding,
        mixedLineEndings: file.mixedLineEndings,
        readOnly: file.readOnly,
        bytes: file.bytes,
        modifiedMs: file.modifiedMs,
      };
    },

    saveDocument: async (path, text, format, options): Promise<SaveResult> => {
      const refused = requireGranted(path);
      if (refused) return refused;
      const file = files.get(path);
      const known = seen.get(path);
      if (file?.readOnly) {
        return fail(
          'read-only',
          'This file or its folder is read-only. Use Save As to save a copy elsewhere.',
        );
      }
      if (!options.overwriteExternalChange) {
        if (!file) {
          if (options.expectedModifiedMs !== null) {
            return fail(
              'modified-externally',
              'The file was moved or deleted since you opened it.',
            );
          }
        } else {
          const timeChanged =
            options.expectedModifiedMs !== null
              ? options.expectedModifiedMs !== file.modifiedMs
              : known !== undefined && known.modifiedMs !== file.modifiedMs;
          const sizeChanged = known !== undefined && known.bytes !== file.bytes;
          if (timeChanged || sizeChanged) {
            return fail('modified-externally', 'The file changed on disk since you opened it.');
          }
        }
      }
      if (known?.lossy && !options.allowLossy) {
        return fail(
          'lossy',
          'Some characters of this file could not be read and were replaced. Saving would make that permanent.',
        );
      }
      const written = format.lineEnding === 'crlf' ? text.replace(/\r?\n/g, '\r\n') : text;
      const bytes = encodedLength(written, format.encoding);
      const modifiedMs = tick();
      files.set(path, {
        text: text.replace(/\r\n/g, '\n'),
        encoding: format.encoding,
        legacyEncoding: null,
        lossy: false,
        lineEnding: format.lineEnding,
        mixedLineEndings: false,
        readOnly: false,
        bytes,
        modifiedMs,
      });
      seen.set(path, { modifiedMs, bytes, lossy: false });
      const result: SaveResult = { path, bytes, modifiedMs };
      log.saves.push({
        path,
        text,
        format: { ...format },
        options: { ...options },
        result,
      });
      touchRecent(path);
      return result;
    },

    documentContext: async (path): Promise<DocumentContext> => {
      const refused = requireGranted(path);
      if (refused) return refused;
      const given = seed?.documentContext?.[path];
      const derivedVault = vaults.some((vault) => path.startsWith(`${vault.replace(/\/$/, '')}/`));
      return {
        obsidianVault: given?.obsidianVault ?? derivedVault,
        location: given?.location ?? detectLocation(path, home),
      };
    },

    revealInFinder: async (path) => {
      const refused = requireGranted(path);
      if (refused) return refused;
      log.reveals.push(path);
    },

    openExternal: async (url) => {
      let parsed: URL;
      try {
        parsed = new URL(url.trim());
      } catch {
        return fail('not-allowed', 'Only web and email links can be opened from a document.');
      }
      const allowed =
        ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== '') ||
        parsed.protocol === 'mailto:';
      if (!allowed) {
        return fail('not-allowed', 'Only web and email links can be opened from a document.');
      }
      log.externalUrls.push(parsed.href);
    },

    openLinkedDocument: async (fromPath, href) => {
      const refused = requireGranted(fromPath);
      if (refused) return refused;
      const resolved = resolveHref(fromPath, href);
      if (typeof resolved !== 'string') return Promise.reject(resolved);
      if (!files.has(resolved) || !DOCUMENT_EXTENSIONS.includes(extensionOf(resolved))) {
        return fail(
          'not-markdown',
          'This link points to something Writedown does not open as a document.',
        );
      }
      granted.add(resolved);
      return resolved;
    },

    revealLinkedFile: async (fromPath, href) => {
      const refused = requireGranted(fromPath);
      if (refused) return refused;
      const resolved = resolveHref(fromPath, href);
      if (typeof resolved !== 'string') return Promise.reject(resolved);
      log.reveals.push(resolved);
    },

    resolveImage: async (docPath, src) => {
      const refused = requireGranted(docPath);
      if (refused) return refused;
      let resolved = resolveHref(docPath, src);
      if (typeof resolved !== 'string' && resolved.code === 'not-found') {
        // Not next to the note: a path relative to the root of its vault, inside that vault.
        const root = vaultRootOf(docPath);
        const inVault = root === null ? null : resolveHref(`${root}/_`, src);
        if (typeof inVault === 'string' && root !== null && inVault.startsWith(`${root}/`)) {
          resolved = inVault;
        }
      }
      if (typeof resolved !== 'string') return Promise.reject(resolved);
      if (!IMAGE_EXTENSIONS.includes(extensionOf(resolved)) || files.has(resolved)) {
        return fail('not-allowed', 'Only image files can be shown in the preview.');
      }
      return images.get(resolved) ?? mockAssetUrl(resolved);
    },

    savePastedImage: async (docPath, bytes, name) => {
      const refused = requireGranted(docPath);
      if (refused) return refused;
      const extension = sniffImage(bytes);
      if (extension === null) {
        return fail('not-allowed', 'Only PNG, JPEG, GIF and WebP images can be pasted.');
      }
      const path = freeImagePath(parentOf(docPath), cleanImageStem(name), extension);
      images.set(path, mockAssetUrl(path));
      savedImages.push({ path, bytes: bytes.length, from: null });
      return relativeImageSrc(parentOf(docPath), path);
    },

    importDroppedImage: async (docPath, source) => {
      const refused = requireGranted(docPath);
      if (refused) return refused;
      if (!droppedImages.has(source)) return fail('not-allowed', NOT_ALLOWED);
      const folder = parentOf(docPath);
      if (source.startsWith(`${folder}/`)) return relativeImageSrc(folder, source);
      const name = source.slice(source.lastIndexOf('/') + 1);
      const dot = name.lastIndexOf('.');
      const path = freeImagePath(folder, cleanImageStem(name.slice(0, dot)), extensionOf(source));
      images.set(path, mockAssetUrl(path));
      savedImages.push({ path, bytes: 0, from: source });
      return relativeImageSrc(folder, path);
    },

    readImageBytes: async (docPath, src, maxBytes) => {
      const refused = requireGranted(docPath);
      if (refused) return refused;
      let resolved = resolveHref(docPath, src);
      if (typeof resolved !== 'string' && resolved.code === 'not-found') {
        const root = vaultRootOf(docPath);
        const inVault = root === null ? null : resolveHref(`${root}/_`, src);
        if (typeof inVault === 'string' && root !== null && inVault.startsWith(`${root}/`)) {
          resolved = inVault;
        }
      }
      if (typeof resolved !== 'string') return Promise.reject(resolved);
      if (!IMAGE_EXTENSIONS.includes(extensionOf(resolved)) || files.has(resolved)) {
        return fail('not-allowed', 'Only image files can be shown in the preview.');
      }
      const bytes = new Uint8Array(seed?.imageBytes?.[resolved] ?? MOCK_PNG);
      if (bytes.length > maxBytes) return fail('too-large', 'This image is too large.');
      return bytes;
    },

    readLinkedText: async (fromPath, href, purpose) => {
      const refused = requireReadable(fromPath);
      if (refused) return refused;
      const resolved = resolveHref(fromPath, href);
      if (typeof resolved !== 'string') return Promise.reject(resolved);
      const extension = extensionOf(resolved);
      const allowed =
        purpose === 'bibliography'
          ? BIBLIOGRAPHY_EXTENSIONS.includes(extension)
          : purpose === 'include'
            ? DOCUMENT_EXTENSIONS.includes(extension)
            : MARKDOWN_EXTENSIONS.includes(extension);
      if (!files.has(resolved) || !allowed) {
        return purpose === 'bibliography'
          ? fail(
              'not-allowed',
              'A bibliography must be a .bib, .bibtex, .json, .yaml or .yml file.',
            )
          : fail(
              'not-markdown',
              'This link points to something Writedown does not read as a document.',
            );
      }
      if (purpose === 'embed') {
        const root = vaultRootOf(fromPath);
        if (root === null || !resolved.startsWith(`${root}/`)) {
          return fail('not-allowed', 'A note can only be embedded from inside its own vault.');
        }
      }
      const read = await readTextOf(resolved, LINKED_TEXT_LIMITS[purpose]);
      readOnlyGranted.add(resolved);
      return read;
    },

    vaultIndex: async (docPath) => {
      const refused = requireReadable(docPath);
      if (refused) return refused;
      const root = vaultRootOf(docPath);
      return root === null ? null : buildVaultIndex(root);
    },

    quartoProject: async (docPath) => {
      const refused = requireReadable(docPath);
      if (refused) return refused;
      let folder = parentOf(docPath);
      for (let level = 0; level < QUARTO_LEVELS; level++) {
        if (folder === home || folder === '/') break;
        const candidate = `${folder}/_quarto.yml`;
        if (files.has(candidate)) return readTextOf(candidate, MAX_QUARTO_PROJECT_BYTES);
        folder = parentOf(folder);
      }
      return null;
    },

    // ---- recents, settings, document state ----
    recentDocuments: async () => recentEntries(),
    openRecent: async (path) => {
      if (!recents.some((entry) => entry.path === path)) return fail('not-allowed', NOT_ALLOWED);
      const entry = recentEntries().find((candidate) => candidate.path === path);
      if (!entry?.exists) return fail('not-found', NOT_FOUND);
      granted.add(path);
      return path;
    },
    removeRecent: async (path) => {
      const before = recents.length;
      recents = recents.filter((entry) => entry.path !== path);
      if (recents.length !== before) notifyRecents();
    },
    clearRecents: async () => {
      if (recents.length === 0) return;
      recents = [];
      notifyRecents();
    },
    getSettings: async () => structuredClone(settings),
    getSnippets: async () => structuredClone(snippets),
    setSnippets: async (list) => {
      snippets = cleanSnippets(list);
      return structuredClone(snippets);
    },
    updateSettings: (patch) => storeSettings(patch),
    getDocState: async (path) => {
      const refused = requireGranted(path);
      if (refused) return refused;
      const state = docStates.get(path);
      if (state) {
        docStates.delete(path); // reading counts as use
        docStates.set(path, state);
      }
      return {
        flavor: state?.flavor ?? null,
        cursor: state?.cursor ? { ...state.cursor } : null,
        scrollLine: state?.scrollLine ?? null,
      };
    },
    setDocState: async (path, patch) => {
      const refused = requireGranted(path);
      if (refused) return refused;
      const current = docStates.get(path) ?? {
        flavor: null,
        cursor: null,
        scrollLine: null,
      };
      let { flavor, cursor, scrollLine } = current;
      if (patch.flavor === null) flavor = null;
      else if (typeof patch.flavor === 'string' && FLAVORS.includes(patch.flavor)) {
        flavor = patch.flavor;
      }
      if (patch.cursor === null) cursor = null;
      else if (patch.cursor !== undefined) {
        const { line, column } = patch.cursor as {
          line?: unknown;
          column?: unknown;
        };
        if (
          Number.isInteger(line) &&
          Number.isInteger(column) &&
          (line as number) >= 1 &&
          (line as number) <= MAX_CURSOR_LINE &&
          (column as number) >= 0 &&
          (column as number) <= MAX_CURSOR_COLUMN
        ) {
          cursor = { line: line as number, column: column as number };
        }
      }
      if (patch.scrollLine === null) scrollLine = null;
      else if (
        Number.isInteger(patch.scrollLine) &&
        (patch.scrollLine as number) >= 1 &&
        (patch.scrollLine as number) <= MAX_CURSOR_LINE
      ) {
        scrollLine = patch.scrollLine as number;
      }
      docStates.delete(path);
      if (flavor !== null || cursor !== null || scrollLine !== null) {
        docStates.set(path, { flavor, cursor, scrollLine });
        while (docStates.size > MAX_DOC_STATES) {
          const oldest = docStates.keys().next().value;
          if (oldest === undefined) break;
          docStates.delete(oldest);
        }
      }
    },

    // ---- folders and file operations (Phase 3) ----
    folderDialog: async (purpose) => {
      phase3.folderDialogs.push(purpose);
      const path = folderAnswers.next(null);
      if (path) grantedFolders.add(path.replace(/\/$/, ''));
      return path;
    },
    listFolder: async (path): Promise<FolderListing> => {
      const problem = requireFolder(path);
      if (problem) return Promise.reject(problem);
      const base = path.replace(/\/$/, '');
      const ignore = settings.files.ignore;
      const entries: FolderEntry[] = [];
      const folderNames = new Set<string>();
      for (const known of [...files.keys(), ...explicitFolders, ...grantedFolders]) {
        if (!known.startsWith(`${base}/`)) continue;
        const rest = known.slice(base.length + 1);
        const slash = rest.indexOf('/');
        const isFolder = slash !== -1 || !files.has(known);
        const name = slash === -1 ? rest : rest.slice(0, slash);
        if (name === '' || skippedName(name, ignore)) continue;
        if (isFolder) {
          if (!folderNames.has(name)) {
            folderNames.add(name);
            entries.push({
              name,
              path: `${base}/${name}`,
              kind: 'folder',
              bytes: null,
              modifiedMs: MOCK_FILE_MODIFIED_MS,
            });
          }
        } else if (isListedFile(name)) {
          const file = files.get(known) as StoredFile;
          entries.push({
            name,
            path: known,
            kind: 'file',
            bytes: file.bytes,
            modifiedMs: file.modifiedMs,
          });
        }
      }
      const key = (entry: FolderEntry) =>
        [entry.kind === 'file' ? 1 : 0, entry.name.toLowerCase()] as const;
      entries.sort((a, b) => {
        const [ka, na] = key(a);
        const [kb, nb] = key(b);
        return ka !== kb ? ka - kb : na < nb ? -1 : na > nb ? 1 : 0;
      });
      return {
        path: base,
        entries: entries.slice(0, MAX_LEVEL_ENTRIES),
        truncated: entries.length > MAX_LEVEL_ENTRIES,
      };
    },
    fileIndex: async (folder) => {
      const problem = requireFolder(folder);
      if (problem) return Promise.reject(problem);
      const base = folder.replace(/\/$/, '');
      const ignore = settings.files.ignore;
      const paths = [...files.keys()]
        .filter((known) => known.startsWith(`${base}/`))
        .filter((known) => {
          const parts = known.slice(base.length + 1).split('/');
          return (
            !parts.some((part) => skippedName(part, ignore)) && isListedFile(parts.at(-1) ?? '')
          );
        })
        .sort();
      return {
        paths: paths.slice(0, MAX_INDEX_FILES),
        truncated: paths.length > MAX_INDEX_FILES,
      };
    },
    createFile: async (folder, name) => {
      const problem = requireFolder(folder);
      if (problem) return Promise.reject(problem);
      const clean = cleanName(name);
      if (clean === null) return fail('invalid-name', INVALID_NAME);
      if (nameTaken(folder, clean)) return fail('exists', EXISTS);
      const path = `${folder.replace(/\/$/, '')}/${clean}`;
      files.set(path, storeSeed(''));
      recordOp('create-file', null, path);
      return path;
    },
    createFolder: async (folder, name) => {
      const problem = requireFolder(folder);
      if (problem) return Promise.reject(problem);
      const clean = cleanName(name);
      if (clean === null) return fail('invalid-name', INVALID_NAME);
      if (nameTaken(folder, clean)) return fail('exists', EXISTS);
      const path = `${folder.replace(/\/$/, '')}/${clean}`;
      explicitFolders.add(path);
      recordOp('create-folder', null, path);
      return path;
    },
    renamePath: async (path, newName) => {
      const problem = requireItem(path);
      if (problem) return Promise.reject(problem);
      const clean = cleanName(newName);
      if (clean === null) return fail('invalid-name', INVALID_NAME);
      const target = `${parentOf(path)}/${clean}`;
      if (target === path) return path;
      const caseOnly = target.toLowerCase() === path.toLowerCase();
      if (!caseOnly && nameTaken(parentOf(path), clean)) return fail('exists', EXISTS);
      relocate(path, target);
      recordOp('rename', path, target);
      return target;
    },
    movePath: async (path, toFolder) => {
      const problem = requireItem(path);
      if (problem) return Promise.reject(problem);
      const folderProblem = requireFolder(toFolder);
      if (folderProblem) return Promise.reject(folderProblem);
      if (underFolder(toFolder, path) && !files.has(path)) {
        return fail('io', 'A folder cannot be moved into itself.');
      }
      const target = `${toFolder.replace(/\/$/, '')}/${baseName(path)}`;
      if (target === path || nameTaken(toFolder, baseName(path))) return fail('exists', EXISTS);
      relocate(path, target);
      recordOp('move', path, target);
      return target;
    },
    duplicatePath: async (path) => {
      const problem = requireItem(path);
      if (problem) return Promise.reject(problem);
      const file = files.get(path);
      if (!file) return fail('io', 'Only files can be duplicated.');
      let target = '';
      for (let number = 1; number <= 1000; number++) {
        const candidate = `${parentOf(path)}/${copyName(baseName(path), number)}`;
        if (!files.has(candidate) && !folderExists(candidate)) {
          target = candidate;
          break;
        }
      }
      if (target === '') return fail('io', 'Too many copies of this file exist.');
      files.set(target, { ...file, modifiedMs: tick() });
      granted.add(target);
      recordOp('duplicate', path, target);
      return target;
    },
    trashPath: async (path) => {
      const problem = requireItem(path);
      if (problem) return Promise.reject(problem);
      if (grantedFolders.has(path)) {
        return fail('io', 'The open folder cannot be moved to the Trash from here.');
      }
      control.externallyRemove(path);
      for (const set of [granted, readOnlyGranted]) {
        for (const known of [...set]) {
          if (known === path || known.startsWith(`${path}/`)) set.delete(known);
        }
      }
      phase3.trashed.push(path);
      recordOp('trash', path, null);
    },

    // ---- watching and search ----
    watch: async (set) => {
      phase3.watches.push(structuredClone(set));
    },
    onFileChanged: (handler) => subscribe(fileChangedHandlers, handler),
    onDropImages: (handler) => subscribe(dropImageHandlers, handler),
    searchFolder: (request) => {
      phase3.searches.push({ ...request });
      searchRequests.set(request.id, { ...request });
      if (!seed?.searchHold) return Promise.resolve(scriptedSearch(request));
      return new Promise<SearchResult>((resolve) => {
        pendingSearches.set(request.id, (result) => {
          pendingSearches.delete(request.id);
          resolve(result);
        });
      });
    },
    cancelSearch: async (id) => {
      phase3.cancelledSearches.push(id);
      const finish = pendingSearches.get(id);
      const request = searchRequests.get(id);
      if (finish && request) {
        finish({
          id,
          files: [],
          matchCount: 0,
          fileCount: 0,
          truncated: false,
          cancelled: true,
          error: null,
        });
      }
    },

    // ---- clipboard, print, export ----
    writeClipboard: async ({ text, html }) => {
      clipboardText = text;
      phase3.clipboardWrites.push({ text, html: html ?? null });
    },
    readClipboardText: async () => clipboardText,
    printPage: async () => {
      phase3.prints++;
      phase3.printRoots.push(document.getElementById('wd-print-root')?.innerHTML ?? null);
    },
    writeExport: async (path, contents) => {
      if (!exportTargets.has(path)) return fail('not-allowed', NOT_ALLOWED);
      exportTargets.delete(path);
      phase3.exports.push({ path, contents });
    },
    pandocInfo: async () => (pandoc ? { ...pandoc } : null),
    defaultMarkdownApp: async () => ({ ...defaultApp }),
    makeDefaultMarkdownApp: async () => {
      if (makeDefaultError !== null) return fail('io', makeDefaultError);
      defaultApp = { isWritedown: true, appName: 'Writedown' };
    },
    choosePandoc: async () => {
      const path = pandocAnswers.next(null);
      if (path === null) return null;
      // Rust accepts an absolute path to a file named `pandoc` that runs `--version`.
      if (!path.startsWith('/') || path.slice(path.lastIndexOf('/') + 1) !== 'pandoc') {
        return fail('io', 'That file is not Pandoc. Choose the file named pandoc.');
      }
      await storeSettings({ export: { pandocPath: path } });
      return path;
    },
    chooseDefaultFolder: async () => {
      const path = defaultFolderAnswers.next(null);
      if (path === null) return null;
      await storeSettings({ saving: { defaultFolder: path } });
      return path;
    },
    exportDocx: (request) => {
      if (!exportTargets.has(request.outPath)) return fail('not-allowed', NOT_ALLOWED);
      phase3.docxRequests.push({ ...request });
      if (seed?.exportDocx?.error) return fail('io', seed.exportDocx.error);
      if (seed?.exportDocx?.hold) {
        return new Promise<void>((resolve, reject) => {
          docxHold = { resolve, reject };
        });
      }
      exportTargets.delete(request.outPath);
      return Promise.resolve();
    },

    pandocPreview: (request) => {
      phase3.previewRequests.push(structuredClone(request));
      if (previewAnswer?.error) return fail('io', previewAnswer.error);
      if (previewAnswer?.hold) {
        return new Promise<string>((resolve, reject) => {
          previewHolds.push({ resolve, reject });
        });
      }
      const html = previewAnswer?.html;
      return Promise.resolve(
        typeof html === 'function' ? html(request) : (html ?? '<p>Pandoc preview</p>'),
      );
    },
    cancelPandocPreview: async () => {
      phase3.previewCancels += 1;
    },

    exportPdf: async (path) => {
      if (!exportTargets.has(path)) return fail('not-allowed', NOT_ALLOWED);
      phase3.pdfExports.push({
        path,
        root: document.getElementById('wd-print-root')?.innerHTML ?? null,
      });
      exportTargets.delete(path);
      if (seed?.exportPdf?.error) return fail('io', seed.exportPdf.error);
    },

    renderWithQuarto: async (path) => {
      phase3.renderRequests.push(path);
      if (seed?.renderWithQuarto?.error) return fail('io', seed.renderWithQuarto.error);
      return seed?.renderWithQuarto?.target ?? 'terminal';
    },

    // ---- session ----
    getSession: async () => (storedSession ? structuredClone(storedSession) : null),
    setSession: async (session) => {
      storedSession = structuredClone(session);
      phase3.sessions.push(structuredClone(session));
    },

    // ---- crash recovery (Phase 5) ----
    recoveryWrite: async (id, entry) => {
      if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return fail('io', 'The recovery entry is not valid.');
      const store = recoveryStore();
      store[id] = { ...structuredClone(entry), id, savedAtMs: Date.now() };
      writeJson(RECOVERY_KEY, store);
    },
    recoveryRemove: async (ids) => {
      const store = recoveryStore();
      for (const id of ids) delete store[id];
      writeJson(RECOVERY_KEY, store);
    },
    recoveryList: async () => {
      const list = Object.values(recoveryStore())
        .map((entry) => structuredClone(entry))
        .sort((a, b) => a.savedAtMs - b.savedAtMs || a.id.localeCompare(b.id));
      // Rust allows the files of the entries again at launch, like the session's.
      for (const entry of list) if (entry.path && files.has(entry.path)) granted.add(entry.path);
      return list;
    },

    // ---- several windows (Phase 5) ----
    moveTab: async (transfer) => {
      const label = nextLabel();
      writeJson(`wd-mock-transfer:${label}`, transfer);
      const docs = readJson<Record<string, string[]>>(DOCS_KEY, {});
      if (transfer.path) {
        docs[windowLabel] = (docs[windowLabel] ?? []).filter((path) => path !== transfer.path);
        docs[label] = [transfer.path];
        writeJson(DOCS_KEY, docs);
      }
      windowLog.movedTabs.push({ label, transfer: structuredClone(transfer) });
      return label;
    },
    takeTransfer: async (): Promise<WindowTransfer | null> => {
      const key = `wd-mock-transfer:${windowLabel}`;
      const transfer = readJson<WindowTransfer | null>(key, null);
      if (transfer) {
        if (transfer.kind === 'tab' && transfer.path) granted.add(transfer.path);
        if (transfer.kind === 'session') for (const tab of transfer.tabs) granted.add(tab.path);
        try {
          windowStorage()?.removeItem(key);
        } catch {
          // ignored
        }
      }
      return transfer;
    },
    setDocumentEdited: async (edited) => {
      log.documentEdited.push(edited);
    },
    setWindowDocuments: async (paths) => {
      windowLog.documents.length = 0;
      windowLog.documents.push(...paths);
      const docs = readJson<Record<string, string[]>>(DOCS_KEY, {});
      docs[windowLabel] = [...paths];
      writeJson(DOCS_KEY, docs);
    },
    focusOpenDocument: async (path) => {
      const docs = readJson<Record<string, string[]>>(DOCS_KEY, {});
      const holder = Object.entries(docs).find(
        ([label, paths]) => label !== windowLabel && paths.includes(path),
      );
      if (!holder) return false;
      windowLog.focusedElsewhere.push(path);
      try {
        const channel = new BroadcastChannel('wd-mock-windows');
        channel.postMessage({ to: holder[0], type: 'open-files', paths: [path] });
        channel.close();
      } catch {
        // no channel: the other window is not told
      }
      return true;
    },
    restoreWindows: async () => {
      const labels: string[] = [];
      for (const entry of storedSession?.windows ?? []) {
        const label = nextLabel();
        writeJson(`wd-mock-transfer:${label}`, {
          kind: 'session',
          tabs: entry.tabs,
          active: entry.active,
        } satisfies WindowTransfer);
        labels.push(label);
      }
      windowLog.restored.push(labels);
      return labels;
    },

    // ---- window and lifecycle ----
    takePendingOpenFiles: async () => {
      filesReady = true;
      const taken = [...new Set(pendingFiles)];
      pendingFiles = [];
      return taken;
    },
    updateMenuState: async (state) => {
      log.menuStates.push({ ...state });
    },
    setWindowTitle: async (title) => {
      log.windowTitles.push(title);
    },
    closeSelf: async () => {},
    openPreferences: async () => {
      log.preferencesOpened++;
    },
    ackClose: async () => {
      log.ackCloses++;
    },
    finishClose: async (reason: CloseReason) => {
      log.finishCloses.push(reason);
    },
    cancelClose: async (reason: CloseReason) => {
      log.cancelCloses.push(reason);
    },

    onOpenFiles: (handler) => subscribe(openHandlers, handler),
    onMenuAction: async (handler) => {
      menuHandlers.add(handler);
      actionsReady = true;
      const queued = pendingActions;
      pendingActions = [];
      for (const action of queued) handler(action);
      return () => {
        menuHandlers.delete(handler);
      };
    },
    onCloseRequested: (handler) =>
      subscribe(closeHandlers, (reason: CloseReason) => {
        log.ackCloses++; // the Tauri platform acknowledges before it calls the handler
        handler(reason);
      }),
    onSettingsChanged: (handler) => subscribe(settingsHandlers, handler),
    onRecentsChanged: (handler) => subscribe(recentsHandlers, handler),
  };
}
