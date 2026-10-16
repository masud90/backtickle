/**
 * CodeMirror 6 editor for the Markdown source, wrapped in a small typed controller.
 *
 * One view serves every open document: each tab keeps an `EditorState` (text, selection, undo
 * history and flavor) and the shell swaps it in with `setState`. The settings that are global
 * (tab size, soft wrap, line numbers, spell check) live on the controller and are applied to a
 * state when it is swapped in, so a state saved earlier never shows a stale setting.
 */
import { history, historyField, insertNewline, redo, undo } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { findNext, findPrevious, search } from '@codemirror/search';
import {
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
  Prec,
  type StateEffect,
  type Text,
} from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type ViewUpdate,
} from '@codemirror/view';
import { type A11yEditorOptions, a11yExtension } from './a11y';
import { autoPairOff, autoPairOn } from './autopair';
import { type FormatCommand, formatCommands, toggleTask } from './commands';
import {
  type CompletionData,
  completionDataField,
  completionSetup,
  setCompletionDataEffect,
  snippetSource,
  snippetTabKeymap,
} from './complete';
import { openFindPanel } from './find';
import type { FlavorId } from './flavor';
import {
  type FlavorEditor,
  type InsertCommand,
  loadedFlavorEditor,
  loadFlavorEditor,
} from './flavors';
import { type ImageHandler, imageInput, imageMarkdown, setImageHandler } from './image-input';
import { editorKeymap, editorKeymapWith } from './keymap';
import { listKeymap } from './lists';
import { flavorFacet, markdownSupport, taskMarkers } from './markdown';
import { smartPaste } from './smart-paste/handler';
import { editorAppearance } from './theme';

export type { FormatCommand } from './commands';
export type { FlavorId } from './flavor';

/** 1-based line and column of the caret. */
export interface CursorPosition {
  line: number;
  column: number;
}

/**
 * The main selection. `line` and `column` are 0-based, like every other line number in the
 * editor and preview APIs (the status bar adds 1); `column` counts UTF-16 units from the line
 * start. `selectedText` is null for a caret.
 */
export interface EditorSelectionInfo {
  line: number;
  column: number;
  selectedText: string | null;
}

export interface EditorOptions {
  parent: HTMLElement;
  doc: string;
  /** The flavor of the first document. Defaults to GFM. */
  flavor?: FlavorId;
  /** The document changed. Called on every change, so it must be cheap. */
  onChange: () => void;
  /** The caret moved or the document changed. */
  onCursor: (position: CursorPosition) => void;
}

export function cursorPosition(state: EditorState): CursorPosition {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  return { line: line.number, column: head - line.from + 1 };
}

function selectionInfo(state: EditorState): EditorSelectionInfo {
  const main = state.selection.main;
  const line = state.doc.lineAt(main.head);
  return {
    line: line.number - 1,
    column: main.head - line.from,
    selectedText: main.empty ? null : state.sliceDoc(main.from, main.to),
  };
}

// ---- configuration kept in compartments -----------------------------------------------------

export const DEFAULT_TAB_SIZE = 2;
const MIN_TAB_SIZE = 1;
const MAX_TAB_SIZE = 8;

/** The settings that apply to every document, whichever state is showing. */
interface GlobalSettings {
  tabSize: number;
  insertSpaces: boolean;
  softWrap: boolean;
  lineNumbers: boolean;
  spellcheck: boolean;
  currentLine: boolean;
  autoPair: boolean;
  continueLists: boolean;
  typewriter: boolean;
  livePreview: boolean;
  aids: A11yEditorOptions;
  /** The `shortcuts` setting (Phase 5); the editing keys in it replace the defaults. */
  shortcuts: Record<string, string | null>;
}

const keymapSlot = new Compartment();
const flavorSlot = new Compartment();
/** The flavor's own syntax and completion sources, loaded lazily after the parser. */
const flavorExtraSlot = new Compartment();
const tabSlot = new Compartment();
const wrapSlot = new Compartment();
const gutterSlot = new Compartment();
const spellSlot = new Compartment();
const currentLineSlot = new Compartment();
const autoPairSlot = new Compartment();
const listSlot = new Compartment();
const readOnlySlot = new Compartment();
/** The reading ruler and the focus-line spotlight (Phase 4). */
const a11ySlot = new Compartment();
/** Typewriter scrolling (Phase 5), a lazy chunk that is only loaded once the setting is on. */
const typewriterSlot = new Compartment();
const typewriterOff: Extension = [];
let typewriterLoaded: Extension | null = null;
/** Live preview in the editor (hidden syntax), a lazy chunk loaded once the setting is on. */
const livePreviewSlot = new Compartment();
const livePreviewOff: Extension = [];
let livePreviewModule: typeof import('./live-preview') | null = null;

// Extension values are shared so a compartment can be compared by identity (see `withSettings`).
const tabExtensions = new Map<number, Extension>();
function tabExtension(size: number, insertSpaces = true): Extension {
  const key = insertSpaces ? size : -size;
  let extension = tabExtensions.get(key);
  if (!extension) {
    extension = [
      EditorState.tabSize.of(size),
      indentUnit.of(insertSpaces ? ' '.repeat(size) : '\t'),
    ];
    tabExtensions.set(key, extension);
  }
  return extension;
}
const wrapOn: Extension = EditorView.lineWrapping;
const wrapOff: Extension = [];
const gutterOn: Extension = [lineNumbers()];
const currentLineOn: Extension = [highlightActiveLine(), highlightActiveLineGutter()];
const currentLineOff: Extension = [];
/** Return without list continuation (`editor.continueLists` off): a plain newline. */
const plainReturn: Extension = Prec.highest(keymap.of([{ key: 'Enter', run: insertNewline }]));
const gutterOff: Extension = [];
const spellOn: Extension = EditorView.contentAttributes.of({ spellcheck: 'true' });
const spellOff: Extension = EditorView.contentAttributes.of({ spellcheck: 'false' });
const readOnlyOn: Extension = EditorState.readOnly.of(true);
const readOnlyOff: Extension = EditorState.readOnly.of(false);

const DEFAULT_SETTINGS: GlobalSettings = {
  tabSize: DEFAULT_TAB_SIZE,
  insertSpaces: true,
  softWrap: true,
  lineNumbers: true,
  spellcheck: true,
  currentLine: true,
  autoPair: false,
  continueLists: true,
  typewriter: false,
  livePreview: false,
  aids: { ruler: false, spotlight: false },
  shortcuts: {},
};

// A state created by `createState` is not tied to a controller, so the update listener finds the
// controller of the view that is being updated.
const controllers = new WeakMap<EditorView, EditorController>();
const hostListener = EditorView.updateListener.of((update) => {
  controllers.get(update.view)?.viewUpdated(update);
});

const NO_EXTRAS: Extension = [];
const extrasCache = new WeakMap<FlavorEditor, Extension>();
const extrasCacheWithSnippets = new WeakMap<FlavorEditor, Extension>();
/** Snippets with triggers exist (WP5.5): their completion source joins every flavor's. */
let snippetTriggersOn = false;
/** The controllers of this window (one), for the Snippets code that is loaded later. */
const liveControllers = new Set<EditorController>();
let snippetsRequested = false;

/** The extensions a flavor module adds (its syntax and completion), or none while not loaded. */
function flavorExtras(flavor: FlavorId): Extension {
  const module = loadedFlavorEditor(flavor);
  if (!module) return NO_EXTRAS;
  const cache = snippetTriggersOn ? extrasCacheWithSnippets : extrasCache;
  let extras = cache.get(module);
  if (!extras) {
    const sources = [...(module.completions ?? []), ...(snippetTriggersOn ? [snippetSource] : [])];
    extras = [module.syntax, completionSetup(sources), snippetTriggersOn ? snippetTabKeymap : []];
    cache.set(module, extras);
  }
  return extras;
}

/** The extensions of every document state. */
function stateExtensions(flavor: FlavorId): Extension[] {
  return [
    gutterSlot.of(gutterOn),
    currentLineSlot.of(currentLineOn),
    drawSelection(),
    history(),
    wrapSlot.of(wrapOn),
    search({ top: true }),
    listSlot.of(listKeymap),
    autoPairSlot.of(autoPairOff),
    keymapSlot.of(defaultKeymapExtension),
    imageInput,
    smartPaste,
    flavorSlot.of(markdownSupport(flavor)),
    flavorExtraSlot.of(flavorExtras(flavor)),
    completionDataField,
    taskMarkers,
    tabSlot.of(tabExtension(DEFAULT_TAB_SIZE)),
    spellSlot.of(spellOn),
    readOnlySlot.of(readOnlyOff),
    a11ySlot.of(a11yExtension({ ruler: false, spotlight: false })),
    typewriterSlot.of(typewriterOff),
    livePreviewSlot.of(livePreviewOff),
    editorAppearance,
    // The scrollable editor must be reachable by keyboard (axe: scrollable-region-focusable).
    EditorView.contentAttributes.of({ 'aria-label': 'Markdown source', tabindex: '0' }),
    hostListener,
  ];
}

const defaultKeymapExtension: Extension = keymap.of(editorKeymap);
const keymapCache = new Map<string, Extension>();
/** The keymap extension for a set of overrides, the same object for the same overrides (so a state is not reconfigured needlessly). */
function keymapFor(shortcuts: Record<string, string | null>): Extension {
  const key = JSON.stringify(
    Object.entries(shortcuts)
      .filter(([id]) => id.startsWith('editor:'))
      .sort(),
  );
  if (key === '[]') return defaultKeymapExtension;
  let extension = keymapCache.get(key);
  if (!extension) {
    if (keymapCache.size > 16) keymapCache.clear();
    extension = keymap.of(editorKeymapWith(shortcuts));
    keymapCache.set(key, extension);
  }
  return extension;
}

function livePreviewFor(on: boolean): Extension {
  return on && livePreviewModule ? livePreviewModule.livePreviewExtension : livePreviewOff;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export class EditorController {
  readonly view: EditorView;
  private readonly options: EditorOptions;
  private readonly settings: GlobalSettings = { ...DEFAULT_SETTINGS };
  private readonly scrollHandlers = new Set<() => void>();
  private readonly selectionHandlers = new Set<(info: EditorSelectionInfo) => void>();
  private readonly insertHandlers = new Set<(inserts: InsertCommand[]) => void>();
  private cachedDoc: Text | undefined;
  private cachedText = '';
  private benchPosition: number | undefined;
  private listeningToScroll = false;
  private destroyed = false;
  private readonly styleObserver: MutationObserver;

  constructor(options: EditorOptions) {
    this.options = options;
    this.view = new EditorView({
      parent: options.parent,
      state: EditorController.createState(options.doc, options.flavor ?? 'gfm'),
    });
    controllers.set(this.view, this);
    liveControllers.add(this);
    this.ensureFlavorExtras();
    // CodeMirror measures a line's height once and keeps it. The shell zooms by setting CSS
    // variables on the page, which CodeMirror cannot see, so measure again when they change.
    this.styleObserver = new MutationObserver(() => this.remeasure());
    this.styleObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class', 'data-theme'],
    });
  }

  /**
   * Measures the text again. Call it after changing `--wd-editor-font-size` or
   * `--wd-editor-line-height` on an element other than the document element (changes there are
   * noticed automatically), or the line heights CodeMirror uses for scrolling stay stale.
   */
  remeasure(): void {
    this.view.requestMeasure();
  }

  /**
   * A state for one document (one per tab): the text, an empty undo history, a caret at the
   * start, and the same extensions as the controller's own. Give it to `setState` to show it.
   */
  static createState(text: string, flavor: FlavorId = 'gfm'): EditorState {
    return EditorState.create({ doc: text, extensions: stateExtensions(flavor) });
  }

  /**
   * A state as plain JSON for another window (Move Tab to New Window): text, selection and undo
   * history. `stateFromJSON` turns it back into a state for a tab.
   */
  static stateToJSON(state: EditorState): unknown {
    return state.toJSON({ history: historyField });
  }

  /** The state `stateToJSON` made, with the extensions of a tab of this flavor; null if unusable. */
  static stateFromJSON(json: unknown, flavor: FlavorId = 'gfm'): EditorState | null {
    try {
      return EditorState.fromJSON(
        json,
        { extensions: stateExtensions(flavor) },
        { history: historyField },
      );
    } catch {
      return null;
    }
  }

  /** @internal Called for every view update by the listener installed in each state. */
  viewUpdated(update: ViewUpdate): void {
    if (update.docChanged) this.options.onChange();
    // The Snippets code loads when the first character is typed (WP5.5, not at startup).
    if (
      update.docChanged &&
      !snippetsRequested &&
      update.transactions.some((transaction) => transaction.isUserEvent('input.type'))
    ) {
      snippetsRequested = true;
      void import('./snippets').then((module) => module.activateSnippets()).catch(() => {});
    }
    if (update.docChanged || update.selectionSet) {
      this.options.onCursor(cursorPosition(update.state));
      this.notifySelection(update.state);
    }
  }

  // ---- the document -------------------------------------------------------------------------

  /**
   * The full text. The string is built once per document version, so asking for it twice
   * without an edit in between costs nothing.
   */
  getText(): string {
    const doc = this.view.state.doc;
    if (doc !== this.cachedDoc) {
      this.cachedDoc = doc;
      this.cachedText = doc.toString();
    }
    return this.cachedText;
  }

  /** Replaces the document and forgets the undo history (a new document, not an edit). */
  setText(text: string): void {
    this.setState(EditorController.createState(text, this.flavor));
  }

  /** The state of the document on show: text, selection, undo history and flavor. */
  getState(): EditorState {
    return this.view.state;
  }

  /**
   * Shows another document's state (a tab switch). The undo history, selection and flavor come
   * with the state, the global settings are applied to it, and the view starts at the top: the
   * shell restores a saved scroll position with `scrollToLine` right after.
   */
  setState(state: EditorState): void {
    if (state === this.view.state) return;
    this.view.setState(this.withSettings(state));
    this.view.scrollDOM.scrollTop = 0;
    this.benchPosition = undefined;
    this.options.onChange();
    this.options.onCursor(cursorPosition(this.view.state));
    this.notifySelection(this.view.state);
    this.ensureFlavorExtras();
  }

  /** Switches how the document is parsed (and highlighted). The text and undo history stay. */
  setFlavor(flavor: FlavorId): void {
    if (flavor !== this.flavor) {
      this.view.dispatch({
        effects: [
          flavorSlot.reconfigure(markdownSupport(flavor)),
          flavorExtraSlot.reconfigure(flavorExtras(flavor)),
        ],
      });
    }
    this.ensureFlavorExtras();
  }

  /**
   * Loads the module of the flavor on show (once) and puts its syntax and completion sources
   * into the state. The undo history is not touched: this is a configuration change only.
   */
  private ensureFlavorExtras(): void {
    const flavor = this.flavor;
    this.notifyInserts();
    if (
      loadedFlavorEditor(flavor) &&
      flavorExtraSlot.get(this.view.state) === flavorExtras(flavor)
    ) {
      return;
    }
    void loadFlavorEditor(flavor).then(() => {
      if (this.destroyed || this.flavor !== flavor) return;
      const wanted = flavorExtras(flavor);
      if (flavorExtraSlot.get(this.view.state) !== wanted) {
        this.view.dispatch({ effects: flavorExtraSlot.reconfigure(wanted) });
      }
      this.notifyInserts();
    });
  }

  /** The Insert menu commands of the flavor on show (empty until its module has loaded). */
  get inserts(): InsertCommand[] {
    return loadedFlavorEditor(this.flavor)?.inserts ?? [];
  }

  /** Called when the Insert commands change (a flavor switch or a tab switch). */
  onInserts(handler: (inserts: InsertCommand[]) => void): () => void {
    this.insertHandlers.add(handler);
    return () => {
      this.insertHandlers.delete(handler);
    };
  }

  private notifyInserts(): void {
    const inserts = this.inserts;
    for (const handler of [...this.insertHandlers]) handler(inserts);
  }

  /** What to do with images pasted or dropped into the editor (null: nothing, a plain paste). */
  onImages(handler: ImageHandler | null): void {
    setImageHandler(this.view, handler);
  }

  /** The document position at a point of the page (CSS pixels), or null outside the text. */
  posAtPoint(x: number, y: number): number | null {
    const rect = this.view.scrollDOM.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
    return this.view.posAtCoords({ x, y });
  }

  /**
   * Inserts image links at `pos` (as one undo step) and selects the first alt text, so that a
   * description can be typed right away.
   */
  insertImageLinks(pos: number, links: ReadonlyArray<{ src: string; alt: string }>): void {
    if (links.length === 0 || this.view.state.readOnly) return;
    const at = Math.min(pos, this.view.state.doc.length);
    const { text, altFrom, altTo } = imageMarkdown(this.view.state, at, links);
    this.view.dispatch({
      changes: { from: at, insert: text },
      selection: { anchor: at + altFrom, head: at + altTo },
      userEvent: 'input.paste',
      scrollIntoView: true,
    });
    this.view.focus();
  }

  /** Runs an Insert command of the flavor on show and gives the editor focus. */
  runInsert(id: string): boolean {
    if (this.view.state.readOnly) return false;
    const command = this.inserts.find((entry) => entry.id === id);
    if (!command) return false;
    const done = command.run(this.view);
    this.view.focus();
    return done;
  }

  /**
   * Gives completion the data of the document on show: citation keys, cross-reference labels
   * and note names. It is kept in the document's state, so it comes back with the tab.
   */
  setCompletionData(data: CompletionData): void {
    this.view.dispatch({ effects: setCompletionDataEffect(data) });
  }

  get flavor(): FlavorId {
    return this.view.state.facet(flavorFacet);
  }

  /** Stops (or allows) typing in the document on show. Formatting commands obey it too. */
  setReadOnly(readOnly: boolean): void {
    this.view.dispatch({ effects: readOnlySlot.reconfigure(readOnly ? readOnlyOn : readOnlyOff) });
  }

  undo(): boolean {
    return undo(this.view);
  }

  redo(): boolean {
    return redo(this.view);
  }

  focus(): void {
    this.view.focus();
  }

  // ---- formatting ---------------------------------------------------------------------------

  /**
   * Runs a formatting command on the selection as one undo step and gives the editor focus.
   * Returns false when the command had nothing to change or the editor is read-only.
   */
  run(command: FormatCommand): boolean {
    const state = this.view.state;
    if (state.readOnly) return false;
    const spec = formatCommands[command]?.(state);
    if (!spec) return false;
    this.view.dispatch(spec);
    this.view.focus();
    return true;
  }

  /**
   * Checks or unchecks the task box on a line (0-based), as one undo step. Returns false and
   * changes nothing when the line has no task. Does not move the selection or take focus, so the
   * preview can call it for a click.
   */
  toggleTaskAtLine(line: number): boolean {
    const state = this.view.state;
    if (state.readOnly) return false;
    const spec = toggleTask(state, line);
    if (!spec) return false;
    this.view.dispatch(spec);
    return true;
  }

  // ---- settings that apply to every document -------------------------------------------------

  /** Tab size 1 to 8 (default 2): the width of a tab and of one indent step, in spaces. */
  setTabSize(size: number): void {
    this.settings.tabSize = clamp(Math.round(size), MIN_TAB_SIZE, MAX_TAB_SIZE);
    this.reconfigureTabs();
  }

  /** Tab inserts spaces (default) or a tab character. */
  setInsertSpaces(on: boolean): void {
    this.settings.insertSpaces = on;
    this.reconfigureTabs();
  }

  private reconfigureTabs(): void {
    const { tabSize, insertSpaces } = this.settings;
    this.view.dispatch({ effects: tabSlot.reconfigure(tabExtension(tabSize, insertSpaces)) });
  }

  /** Highlights the line with the cursor, and its line number. */
  setCurrentLine(on: boolean): void {
    this.settings.currentLine = on;
    this.view.dispatch({
      effects: currentLineSlot.reconfigure(on ? currentLineOn : currentLineOff),
    });
  }

  /** Closes brackets, quotes, backticks, `**` and `__` as they are typed. */
  setAutoPair(on: boolean): void {
    this.settings.autoPair = on;
    this.view.dispatch({ effects: autoPairSlot.reconfigure(on ? autoPairOn : autoPairOff) });
  }

  /** Return continues lists and quotes (default); off, it inserts a plain newline. */
  setContinueLists(on: boolean): void {
    this.settings.continueLists = on;
    this.view.dispatch({ effects: listSlot.reconfigure(on ? listKeymap : plainReturn) });
  }

  setSoftWrap(on: boolean): void {
    this.settings.softWrap = on;
    this.view.dispatch({ effects: wrapSlot.reconfigure(on ? wrapOn : wrapOff) });
  }

  setLineNumbers(on: boolean): void {
    this.settings.lineNumbers = on;
    this.view.dispatch({ effects: gutterSlot.reconfigure(on ? gutterOn : gutterOff) });
  }

  setSpellcheck(on: boolean): void {
    this.settings.spellcheck = on;
    this.view.dispatch({ effects: spellSlot.reconfigure(on ? spellOn : spellOff) });
  }

  /** Keeps the cursor line in the middle of the editor (Phase 5). The code loads on first use. */
  setTypewriter(on: boolean): void {
    this.settings.typewriter = on;
    if (on && !typewriterLoaded) {
      void import('./typewriter')
        .then((module) => {
          typewriterLoaded = module.typewriterExtension;
          if (this.settings.typewriter) this.applyTypewriter();
        })
        .catch(() => {});
      return;
    }
    this.applyTypewriter();
  }

  /** Live preview in the editor: syntax marks hidden outside the lines being edited. */
  setLivePreview(on: boolean): void {
    this.settings.livePreview = on;
    if (on && !livePreviewModule) {
      void import('./live-preview')
        .then((module) => {
          livePreviewModule = module;
          module.setLivePreviewImages(this.view, this.imageResolver);
          if (this.settings.livePreview && !this.destroyed) this.applyLivePreview();
        })
        .catch(() => {});
      return;
    }
    this.applyLivePreview();
  }

  private imageResolver: ((source: string) => Promise<string>) | null = null;

  /** How live preview finds the local images of the document on show (null: not drawn). */
  setImageResolver(resolve: ((source: string) => Promise<string>) | null): void {
    this.imageResolver = resolve;
    livePreviewModule?.setLivePreviewImages(this.view, resolve);
  }

  private applyLivePreview(): void {
    const wanted = livePreviewFor(this.settings.livePreview);
    if (livePreviewSlot.get(this.view.state) === wanted) return;
    this.view.dispatch({ effects: livePreviewSlot.reconfigure(wanted) });
  }

  private applyTypewriter(): void {
    const wanted = this.settings.typewriter && typewriterLoaded ? typewriterLoaded : typewriterOff;
    this.view.dispatch({ effects: typewriterSlot.reconfigure(wanted) });
  }

  /** The editing keys the user changed (Preferences > Keyboard Shortcuts), for every document. */
  setShortcuts(shortcuts: Record<string, string | null>): void {
    this.settings.shortcuts = shortcuts;
    this.view.dispatch({ effects: keymapSlot.reconfigure(keymapFor(shortcuts)) });
  }

  /** The reading ruler and the focus-line spotlight (Phase 4, accessibility). */
  setReadingAids(options: A11yEditorOptions): void {
    this.settings.aids = options;
    this.view.dispatch({ effects: a11ySlot.reconfigure(a11yExtension(options)) });
  }

  /** The state with the controller's settings applied (unchanged when it already has them). */
  private withSettings(state: EditorState): EditorState {
    const {
      tabSize,
      insertSpaces,
      softWrap,
      lineNumbers: gutter,
      spellcheck,
      currentLine,
      autoPair,
      continueLists,
      typewriter,
      livePreview,
      aids,
      shortcuts,
    } = this.settings;
    const wanted: [Compartment, Extension][] = [
      [tabSlot, tabExtension(tabSize, insertSpaces)],
      [currentLineSlot, currentLine ? currentLineOn : currentLineOff],
      [autoPairSlot, autoPair ? autoPairOn : autoPairOff],
      [listSlot, continueLists ? listKeymap : plainReturn],
      [wrapSlot, softWrap ? wrapOn : wrapOff],
      [gutterSlot, gutter ? gutterOn : gutterOff],
      [spellSlot, spellcheck ? spellOn : spellOff],
      [a11ySlot, a11yExtension(aids)],
      [typewriterSlot, typewriter && typewriterLoaded ? typewriterLoaded : typewriterOff],
      [livePreviewSlot, livePreviewFor(livePreview)],
      [keymapSlot, keymapFor(shortcuts)],
    ];
    const effects: StateEffect<unknown>[] = [];
    for (const [slot, extension] of wanted) {
      if (slot.get(state) !== extension) effects.push(slot.reconfigure(extension));
    }
    return effects.length > 0 ? state.update({ effects }).state : state;
  }

  // ---- navigation ---------------------------------------------------------------------------

  /**
   * The document line at the top edge of the editor, 0-based and fractional: 12.5 is halfway
   * down line 12. A soft-wrapped line counts as one line, and the fraction is the share of its
   * height scrolled past.
   */
  topVisibleLine(): number {
    const { view } = this;
    const doc = view.state.doc;
    const y = Math.max(0, view.scrollDOM.scrollTop - view.documentPadding.top);
    const block = view.lineBlockAtHeight(y);
    const index = doc.lineAt(block.from).number - 1;
    const fraction = block.height > 0 ? clamp((y - block.top) / block.height, 0, 1) : 0;
    return Math.min(index + fraction, doc.lines);
  }

  /**
   * Scrolls to a line (0-based, may be fractional for sync scroll). `top` puts it at the top edge;
   * `nearest` scrolls only as far as needed to show the whole line.
   */
  scrollToLine(line: number, align: 'top' | 'nearest'): void {
    if (!Number.isFinite(line)) return;
    const { view } = this;
    const doc = view.state.doc;
    const index = clamp(Math.floor(line), 0, doc.lines - 1);
    if (align === 'nearest') {
      // The whole line, first row to last, with the text box's offset as the margin so that the
      // edge of the line itself (not its text) meets the edge of the editor.
      const { from, to } = doc.line(index + 1);
      view.dispatch({
        effects: EditorView.scrollIntoView(EditorSelection.range(from, to), {
          y: 'nearest',
          yMargin: this.textBoxOffset(),
        }),
      });
      return;
    }
    const block = view.lineBlockAt(doc.line(index + 1).from);
    const fraction = clamp(line - index, 0, 1);

    // A line that is already drawn has a measured position: scroll there at once. This is the
    // sync scroll path, called as often as the other pane scrolls, so it stays cheap.
    const drawn = view.viewportLineBlocks;
    const first = drawn[0];
    const last = drawn[drawn.length - 1];
    if (first && last && block.top >= first.top && block.bottom <= last.bottom) {
      view.scrollDOM.scrollTop = block.top + fraction * block.height + view.documentPadding.top;
      return;
    }

    // A far line is only an estimate until it has been drawn, and setting `scrollTop` would land
    // where the estimate says, a few lines off once CodeMirror has measured the real heights.
    // This effect lets CodeMirror draw the target first and scroll to it exactly. It puts the text
    // box of the line's first row at the top edge; that box sits a little below the top of the
    // line, and a fractional line starts further down: both go into the margin.
    view.dispatch({
      effects: EditorView.scrollIntoView(block.from, {
        y: 'start',
        yMargin: this.textBoxOffset() - fraction * block.height,
      }),
    });
  }

  /** How far below the top of a line its text box starts (half the leading), measured. */
  private textBoxOffset(): number {
    const first = this.view.viewportLineBlocks[0];
    const box = first ? this.view.coordsAtPos(first.from) : null;
    return first && box ? Math.max(0, box.top - (this.view.documentTop + first.top)) : 0;
  }

  /**
   * Moves the cursor to the start of a line (0-based) and scrolls only as far as needed to show
   * it. The editor does not take the focus (click to source in Split).
   */
  goToLine(line: number): void {
    if (!Number.isFinite(line)) return;
    const doc = this.view.state.doc;
    const index = clamp(Math.floor(line), 0, doc.lines - 1);
    this.view.dispatch({
      selection: EditorSelection.cursor(doc.line(index + 1).from),
      userEvent: 'select',
    });
    this.scrollToLine(index, 'nearest');
  }

  /** Puts a line (0-based) at the top and moves the cursor to its start. */
  revealLine(line: number): void {
    if (!Number.isFinite(line)) return;
    const doc = this.view.state.doc;
    const index = clamp(Math.floor(line), 0, doc.lines - 1);
    this.view.dispatch({
      selection: EditorSelection.cursor(doc.line(index + 1).from),
      userEvent: 'select',
    });
    this.scrollToLine(index, 'top');
  }

  /**
   * Search result: puts a line (0-based) at the top and the cursor at a column (UTF-16 units from
   * the line start, clamped to the line). The editor does not take the focus.
   */
  revealPosition(line: number, column: number): void {
    if (!Number.isFinite(line)) return;
    const doc = this.view.state.doc;
    const index = clamp(Math.floor(line), 0, doc.lines - 1);
    const row = doc.line(index + 1);
    const offset = clamp(Math.floor(Number.isFinite(column) ? column : 0), 0, row.length);
    this.view.dispatch({
      selection: EditorSelection.cursor(row.from + offset),
      userEvent: 'select',
    });
    this.scrollToLine(index, 'top');
  }

  /** Called when the editor scrolls, however it happened (wheel, keys, `scrollToLine`). */
  onScroll(handler: () => void): () => void {
    this.scrollHandlers.add(handler);
    if (!this.listeningToScroll) {
      this.listeningToScroll = true;
      this.view.scrollDOM.addEventListener('scroll', this.emitScroll, { passive: true });
    }
    return () => {
      this.scrollHandlers.delete(handler);
    };
  }

  /** Called when the selection or the text changes, and when a state is swapped in. */
  onSelection(handler: (info: EditorSelectionInfo) => void): () => void {
    this.selectionHandlers.add(handler);
    return () => {
      this.selectionHandlers.delete(handler);
    };
  }

  /** The main selection right now. */
  getSelectionInfo(): EditorSelectionInfo {
    return selectionInfo(this.view.state);
  }

  // ---- find ---------------------------------------------------------------------------------

  /** Opens the find bar (with the replace row for Find and Replace) and focuses it. */
  openSearch(replace: boolean): void {
    openFindPanel(this.view, replace);
  }

  /** Selects the next match of the current search; opens the find bar when there is none yet. */
  findNext(): void {
    findNext(this.view);
  }

  findPrevious(): void {
    findPrevious(this.view);
  }

  // ---- internals ----------------------------------------------------------------------------

  private readonly emitScroll = (): void => {
    for (const handler of [...this.scrollHandlers]) handler();
  };

  private notifySelection(state: EditorState): void {
    if (this.selectionHandlers.size === 0) return;
    const info = selectionInfo(state);
    for (const handler of [...this.selectionHandlers]) handler(info);
  }

  /**
   * Benchmark hook: inserts `text` as if typed, at the end of the middle line of the document.
   * The first call picks the spot; later calls continue after the previous insertion, so the
   * characters add up on one line like real typing.
   */
  typeAtMiddleLine(text: string): void {
    const doc = this.view.state.doc;
    const from = this.benchPosition ?? doc.line(Math.max(1, Math.ceil(doc.lines / 2))).to;
    this.view.dispatch({
      changes: { from, insert: text },
      selection: { anchor: from + text.length },
      userEvent: 'input.type',
    });
    this.benchPosition = from + text.length;
  }

  /** Puts the flavor extras of the current settings (snippet completion on or off) into the state. */
  refreshFlavorExtras(): void {
    if (this.destroyed) return;
    const wanted = flavorExtras(this.flavor);
    if (flavorExtraSlot.get(this.view.state) !== wanted) {
      this.view.dispatch({ effects: flavorExtraSlot.reconfigure(wanted) });
    }
  }

  destroy(): void {
    this.destroyed = true;
    liveControllers.delete(this);
    this.insertHandlers.clear();
    this.view.scrollDOM.removeEventListener('scroll', this.emitScroll);
    this.styleObserver.disconnect();
    this.scrollHandlers.clear();
    this.selectionHandlers.clear();
    controllers.delete(this.view);
    this.view.destroy();
  }
}

/** The editor of this window (null before it exists). */
export function currentEditor(): EditorController | null {
  return [...liveControllers][0] ?? null;
}

/**
 * Registers (or removes) the snippet trigger source in every flavor's completion. The Snippets
 * module calls it when snippets with triggers exist (WP5.5).
 */
export function setSnippetTriggersOn(on: boolean): void {
  if (on === snippetTriggersOn) return;
  snippetTriggersOn = on;
  for (const controller of liveControllers) controller.refreshFlavorExtras();
}
