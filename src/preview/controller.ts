/**
 * Keeps the preview DOM in step with the editor text.
 *
 * The block preview: the pipeline (`loadPipeline`) turns the document into a list of blocks, each
 * with a key; the elements of unchanged blocks are kept, the blocks in between are replaced, and
 * what a block needs after sanitizing (icons, Copy buttons, token colors, math, images) is added
 * to the new elements only. A large document appears in slices: the blocks of the first two
 * screens at once, the rest in slices of about 16 ms, so it is on screen long before all of it has
 * been sanitized.
 *
 * - Source changes are debounced and rendered once the typing pauses for 120 ms; and a render
 *   starts at the latest 500 ms after the first change it shows, however steadily the typing goes
 *   on. (A pause that grew with the cost of an update was measured in WP1.3b and gave a longer delay for the
 *   same work.)
 * - The source text is requested only when a render actually happens, so no work is done per
 *   keystroke on large documents.
 * - A large document (from 1,500 blocks) keeps every block in the page, but only the blocks near
 *   the viewport show their content: the others are empty boxes of the height they had when they
 *   were last seen (`wd-far`, see "Large documents" in preview.css). What a block needs after
 *   sanitizing (token colors, Copy buttons, math, images) is added when it first comes near.
 * - A hidden preview is never rendered. The change is remembered and rendered when the preview
 *   becomes visible again. While hidden, the text is only analyzed (words, outline), at most
 *   every 500 ms, and `onAnalyzed` reports it.
 */
import {
  COPIED_LABEL,
  COPY_LABEL,
  type EnhanceContext,
  enhanceBlock,
  needsEnhancement,
} from './enhance';
import { planPatch } from './keyed-patch';
import { applyBlockLines, applyInnerLines, hasInnerLines } from './lines';
import { onPreviewOptionsChanged } from './options';
import type { Analysis, DocContext, Heading, Pipeline, RenderedBlock, RenderResult } from './types';

export { type LinkKind, linkFromEvent, type PreviewLink, taskLineFromEvent } from './events';
export { buildScrollMap, type ScrollMap } from './scroll-map';

export const PREVIEW_DEBOUNCE_MS = 120;
/** The longest a change waits before the render that shows it starts. */
export const PREVIEW_MAX_WAIT_MS = 500;
/** The least time between two analyses of a hidden preview. */
export const ANALYZE_INTERVAL_MS = 500;
/** How long one slice of a large document may run. */
export const SLICE_MS = 16;
/** Fewer new blocks than this are always added at once. */
const PROGRESSIVE_MIN_BLOCKS = 48;
/**
 * From this many blocks on, the preview gets the class `wd-preview-large` and only the blocks near
 * the viewport show their content. A document of 5 MiB has some 370,000 nodes, and every node that
 * is laid out costs about a kilobyte (memory, and time to show the document).
 */
export const LARGE_DOCUMENT_BLOCKS = 1500;
/** How far from the viewport a block still shows its content: this much of the viewport height. */
const NEAR_MARGIN = '150%';
/** Heights of blocks that were never seen: lines of the source times this, at the start. */
const DEFAULT_PX_PER_LINE = 22;
const MIN_FAR_PX = 20;
const MAX_FAR_PX = 2400;
/** Blocks that are not near but keep their content, for a quick way back: this many at most. */
const MAX_HIDDEN_BLOCKS = 400;
/** Blocks are parsed into the page this many at a time. */
const BATCH_BLOCKS = 16;
const SCREEN_LINE_HEIGHT = 20;
const MIN_FIRST_LINES = 60;
const MAX_FIRST_LINES = 400;
const COPIED_MS = 1500;

export interface RenderInfo {
  /** Time spent in parse, sanitize and DOM patch for this render, in milliseconds. */
  renderMs: number;
  /** True for the first render of this controller. */
  first: boolean;
  /**
   * The pipeline's result. For a document that is added in slices this is the same result for the
   * first and for the last report.
   */
  result?: RenderResult;
  /**
   * False while a large document is still being added to the page in slices (the first report,
   * after the first screens), true when everything is in.
   */
  complete?: boolean;
}

export interface PreviewOptions {
  /** The element whose children are managed by the controller (the `<article>`). */
  container: HTMLElement;
  /** Returns the current source text. Called only when a render happens. */
  getSource: () => string;
  /** A fixed pause in milliseconds. Without it the pause adapts (see above). */
  debounceMs?: number;
  /**
   * Called right after the DOM was patched, before the browser paints. For a large document it is
   * called with the first screens, and again when the rest is in.
   */
  onRendered?: (info: RenderInfo) => void;
  /** Timer functions. Replaceable for tests. */
  now?: () => number;
  /** The block pipeline; `setPipeline` changes it (the flavor of the document changed). */
  pipeline: Pipeline;
  /** Called with the analysis of the text while the preview is hidden. */
  onAnalyzed?: (analysis: Analysis) => void;
  /** Turns the path of a local image into an address the web view can load. */
  resolveImage?: (source: string) => Promise<string>;
  /** How long one slice of a large document may run, in milliseconds (default 16). */
  sliceMs?: number;
  /**
   * The whole-document context for the next render (numbers, citations, includes), or undefined.
   * Called when a render happens, after `getSource`. A change of its signature shows in the output
   * of the render that follows; to render again when the inputs of a context arrive, call
   * `renderNow`.
   */
  getContext?: () => DocContext | undefined;
  /** The button of the error banner: the 1-based line of `RenderResult.error`. */
  onGoToLine?: (line: number) => void;
}

/** One block element on the page and what is known about it. */
interface Shown {
  key: string;
  line: number;
  endLine: number;
  element: HTMLElement;
  /** The block has list items, table rows or task boxes with lines to keep up to date. */
  inner: boolean;
  /**
   * Large documents: what the element holds. 'none': nothing, it is an empty box that has not been
   * near yet (or has been far for long); 'hidden': the content is there, `wd-far` hides it;
   * 'shown': the content is laid out. Other documents: always 'shown'.
   */
  content: 'none' | 'hidden' | 'shown';
  /** Large documents: the block, to make the content when it comes near. */
  block: RenderedBlock | undefined;
  /** Large documents: the height in pixels when last seen, or the estimate if never. */
  height: number;
  /** The height was measured at least once. */
  seen: boolean;
  /** The block needs its token colors, Copy buttons, math or images when it comes near. */
  enhance: boolean;
}

/** A large document that is still being added to the page. */
interface Pending {
  result: RenderResult;
  blocks: readonly RenderedBlock[];
  /** The next block to add. */
  next: number;
  /** The end of the blocks to add (the blocks after it are kept ones). */
  end: number;
  /** Where the next element goes in `shown`. */
  at: number;
  /** The element the new elements go before, or null to append. */
  anchor: Element | null;
  /** Large documents: the blocks before this index (of `blocks`) are added near, the rest far. */
  nearUntil: number;
  spent: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  done: () => void;
}

/** One block as find sees it. */
export interface FindSource {
  /** Same key, same text. */
  key: string;
  /** The HTML of a block that is not drawn (large documents); undefined when `element` has it. */
  html: string | undefined;
  /** The wrapper element; its content is there when `html` is undefined. */
  element: HTMLElement;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** The element that scrolls the container: the first ancestor with scrolling overflow. */
function scrollerOf(container: HTMLElement): HTMLElement | null {
  const view = container.ownerDocument.defaultView;
  for (let parent = container.parentElement; parent; parent = parent.parentElement) {
    const overflow = view?.getComputedStyle(parent).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return parent;
  }
  return container.parentElement;
}

export class PreviewController {
  private readonly options: PreviewOptions;
  private readonly fixedDebounceMs: number | undefined;
  private readonly now: () => number;
  private pipeline: Pipeline;
  private banner: HTMLElement | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private analyzeTimer: ReturnType<typeof setTimeout> | undefined;
  private lastAnalyzedAt = Number.NEGATIVE_INFINITY;
  private visible = true;
  private dirty = false;
  private rendered = false;
  private disposed = false;
  /** When the first change that is not rendered yet was made. */
  private firstChangeAt: number | undefined;

  // The blocks on the page
  private shown: Shown[] = [];
  /** `shown[0..sortedLength)` has growing lines; the rest (moved footnotes) is checked one by one. */
  private sortedLength = 0;
  private orderDirty = false;
  private pending: Pending | undefined;
  private pendingPromise: Promise<void> = Promise.resolve();
  private template: HTMLTemplateElement | undefined;
  private cursorLine: number | null = null;
  private cursorElement: Element | null = null;
  private readonly work = new Set<Promise<void>>();
  private readonly enhance: EnhanceContext;
  private readonly changeListeners = new Set<() => void>();
  /** A render option changed (hashtags, math, remote images...): render once, scroll kept. */
  private readonly stopOptions = onPreviewOptionsChanged(() => this.renderKeepingScroll());

  // Large documents: which blocks show their content
  private large = false;
  private observer: IntersectionObserver | undefined;
  private scroller: HTMLElement | null = null;
  private readonly blockOf = new Map<Element, Shown>();
  /** Blocks with the content of a far block ('hidden'), the one that has been far longest first. */
  private readonly hidden = new Set<Shown>();
  /** The headings of the document that is shown (a jump to a heading needs its block). */
  private headings: readonly Heading[] = [];
  /** What the blocks that were seen needed, to estimate the ones that were not. */
  private pxPerLine = DEFAULT_PX_PER_LINE;
  private seenPx = 0;
  private seenLines = 0;

  constructor(options: PreviewOptions) {
    this.options = options;
    this.fixedDebounceMs = options.debounceMs;
    this.now = options.now ?? (() => performance.now());
    this.enhance = { resolveImage: options.resolveImage ?? null, images: new Map() };
    this.pipeline = options.pipeline;
    options.container.classList.add('wd-preview');
    options.container.addEventListener('click', this.onClick);
  }

  // ---- scheduling ---------------------------------------------------------------------------

  /** The source changed: render after the debounce interval, or remember it while hidden. */
  schedule(): void {
    if (this.disposed) return;
    this.dirty = true;
    if (!this.visible) {
      this.scheduleAnalysis();
      return;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.renderNow(), this.pauseMs());
  }

  /** Renders again after a setting changed, with the reader still at the same scroll offset. */
  private renderKeepingScroll(): void {
    const scroller = scrollerOf(this.options.container);
    const top = scroller?.scrollTop ?? 0;
    this.renderNow();
    this.completeNow();
    if (scroller && top > 0) scroller.scrollTop = top;
  }

  /** Renders immediately if the preview is visible. Used for the first render of a document. */
  renderNow(): void {
    if (this.disposed) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.firstChangeAt = undefined;
    this.dirty = true;
    if (!this.visible) {
      this.analyzeNow();
      return;
    }
    this.renderBlocks(this.pipeline);
  }

  /** Called when the preview pane is shown or hidden (view mode, window visibility). */
  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (!visible) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.firstChangeAt = undefined;
      if (this.pending) {
        // The rest of a large document is added when the preview is shown again.
        this.cancelPending();
        this.dirty = true;
      }
    } else {
      clearTimeout(this.analyzeTimer);
      this.analyzeTimer = undefined;
      if (this.dirty) this.renderNow();
    }
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** True while a change is waiting to be rendered. */
  get hasPendingChange(): boolean {
    return this.dirty;
  }

  /** True while a large document is still being added to the page in slices. */
  get isAddingBlocks(): boolean {
    return this.pending !== undefined;
  }

  /**
   * Adds everything that is still waiting to the page now. Use it before something needs the
   * complete document in place: restoring a scroll position, jumping to a heading, a scroll map.
   */
  completeNow(): void {
    while (this.pending) this.runSlice(Number.POSITIVE_INFINITY);
  }

  /**
   * Resolves when the document is completely in the page and everything the blocks needed after
   * sanitizing has arrived (languages, math, image addresses).
   */
  async whenSettled(): Promise<void> {
    for (;;) {
      if (this.pending) {
        await this.pendingPromise;
        continue;
      }
      if (this.work.size === 0) return;
      await Promise.allSettled([...this.work]);
    }
  }

  /**
   * Switches to another pipeline (the flavor of the document changed) and renders again. The
   * blocks that come out the same keep their elements.
   */
  setPipeline(pipeline: Pipeline): void {
    if (this.disposed) return;
    if (this.pipeline === pipeline) return;
    this.cancelPending();
    this.pipeline = pipeline;
    this.renderNow();
  }

  /** Sets how local images are resolved (it depends on the document) and forgets old addresses. */
  setImageResolver(resolve: ((source: string) => Promise<string>) | null): void {
    this.enhance.resolveImage = resolve;
    this.enhance.images.clear();
  }

  /**
   * Marks the block that contains a source line (0-based) as the one under the cursor
   * (`is-cursor-block`); null clears the mark. A line between two blocks marks nothing.
   */
  highlightLine(line: number | null): void {
    this.cursorLine = line;
    this.applyCursor();
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    clearTimeout(this.analyzeTimer);
    this.timer = undefined;
    this.analyzeTimer = undefined;
    this.cancelPending();
    this.observer?.disconnect();
    this.observer = undefined;
    this.blockOf.clear();
    this.hidden.clear();
    this.hideBanner();
    this.changeListeners.clear();
    this.stopOptions();
    this.options.container.removeEventListener('click', this.onClick);
  }

  // ---- the block renderer -----------------------------------------------------------------

  /**
   * How long to wait for more typing before a render starts: the fixed value (the option) or
   * 120 ms, but never so long that the render starts later than 500 ms after the first change it
   * will show (a fast typist never pauses for 120 ms).
   */
  private pauseMs(): number {
    if (this.fixedDebounceMs !== undefined) return this.fixedDebounceMs;
    const now = this.now();
    this.firstChangeAt ??= now;
    const left = Math.max(0, this.firstChangeAt + PREVIEW_MAX_WAIT_MS - now);
    return Math.min(PREVIEW_DEBOUNCE_MS, left);
  }

  /** The last render without a parse error (what an export falls back to). */
  private lastGood: RenderResult | null = null;

  private renderBlocks(pipeline: Pipeline): void {
    this.cancelPending();
    this.firstChangeAt = undefined;
    const started = this.now();
    const result = pipeline.render(this.options.getSource(), this.options.getContext?.());
    this.dirty = false;
    if (result.error) {
      // The last good blocks stay; the banner says what is wrong.
      this.showBanner(result.error);
      return;
    }
    this.hideBanner();
    this.lastGood = result;
    this.applyResult(result, started);
  }

  /** Trusted UI made here, never from document HTML. It sits above the blocks. */
  private showBanner(error: { line: number; message: string }): void {
    const doc = this.options.container.ownerDocument;
    let banner = this.banner;
    if (!banner) {
      banner = doc.createElement('div');
      banner.className = 'mdx-error-banner';
      banner.setAttribute('role', 'alert');
      const container = this.options.container;
      if (container.parentElement) container.parentElement.insertBefore(banner, container);
      else container.prepend(banner);
      this.banner = banner;
    }
    const text = doc.createElement('span');
    text.className = 'mdx-error-text';
    text.textContent = `MDX error on line ${error.line}: ${error.message}`;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'mdx-error-goto';
    button.textContent = 'Go to line';
    button.addEventListener('click', () => this.options.onGoToLine?.(error.line));
    banner.replaceChildren(text, button);
  }

  private hideBanner(): void {
    this.banner?.remove();
    this.banner = undefined;
  }

  private applyResult(result: RenderResult, started: number): void {
    const container = this.options.container;
    const blocks = result.blocks;
    this.headings = result.headings;
    this.setLarge(blocks.length >= LARGE_DOCUMENT_BLOCKS);
    const plan = planPatch(this.shown, blocks);
    const shownSuffixStart = this.shown.length - plan.suffix;
    const blocksSuffixStart = blocks.length - plan.suffix;
    const focusedTask = this.focusedTaskLine();

    // Blocks that stay: only their position in the source may have changed.
    for (let i = 0; i < plan.prefix; i++) this.syncLines(this.shown[i], blocks[i]);
    for (let i = 0; i < plan.suffix; i++) {
      this.syncLines(this.shown[shownSuffixStart + i], blocks[blocksSuffixStart + i]);
    }

    // Blocks that change: the old elements go, the new ones come in before the first kept one.
    const anchor = this.shown[shownSuffixStart]?.element ?? null;
    const removed = this.shown.splice(plan.prefix, shownSuffixStart - plan.prefix);
    // A block that replaces ones that were shown is shown, one in between is shown if its
    // neighbors are: the edit is where the reader is. Anything else starts out empty.
    const near =
      !this.windowed ||
      removed.some((old) => old.content === 'shown') ||
      this.shown[plan.prefix - 1]?.content === 'shown' ||
      this.shown[plan.prefix]?.content === 'shown';
    if (this.shown.length === 0) container.replaceChildren();
    else for (const old of removed) old.element.remove();
    if (this.observer) {
      for (const old of removed) {
        this.observer.unobserve(old.element);
        this.blockOf.delete(old.element);
        this.hidden.delete(old);
      }
    }
    if (this.cursorElement && !this.cursorElement.isConnected) this.cursorElement = null;
    this.orderDirty = true;

    const insertCount = blocksSuffixStart - plan.prefix;
    this.pending = {
      result,
      blocks,
      next: plan.prefix,
      end: blocksSuffixStart,
      at: plan.prefix,
      anchor,
      nearUntil: near ? Number.POSITIVE_INFINITY : -1,
      spent: 0,
      timer: undefined,
      done: () => {},
    };
    this.pendingPromise = new Promise<void>((resolve) => {
      if (this.pending) this.pending.done = resolve;
    });

    const progressive = insertCount >= PROGRESSIVE_MIN_BLOCKS;
    if (progressive) {
      // The first screens are shown, the rest of a large document comes in empty.
      this.pending.nearUntil = Number.POSITIVE_INFINITY;
      this.addUntilScreensAreFull();
      this.pending.nearUntil = this.windowed ? this.pending.next : Number.POSITIVE_INFINITY;
      if (this.windowed) this.learnHeights(plan.prefix, this.pending.next);
    } else {
      this.insertRange(this.pending, blocksSuffixStart);
    }
    this.restoreFocus(focusedTask);

    const finished = this.pending.next >= this.pending.end;
    const syncMs = this.now() - started;
    const first = !this.rendered;
    this.rendered = true;
    this.pending.spent = syncMs;
    if (finished) {
      this.finishPending();
      this.options.onRendered?.({ renderMs: syncMs, first, result, complete: true });
    } else {
      this.options.onRendered?.({ renderMs: syncMs, first, result, complete: false });
      this.scheduleSlice();
    }
  }

  /** Adds blocks until they cover about two screens of the document, measured in source lines. */
  private addUntilScreensAreFull(): void {
    const pending = this.pending;
    if (!pending) return;
    const viewport =
      this.options.container.parentElement?.clientHeight ||
      (typeof window === 'undefined' ? 0 : window.innerHeight) ||
      800;
    const lines = clamp(
      Math.ceil((2 * viewport) / SCREEN_LINE_HEIGHT),
      MIN_FIRST_LINES,
      MAX_FIRST_LINES,
    );
    const firstLine = pending.blocks[pending.next]?.line ?? 0;
    while (pending.next < pending.end) {
      const upTo = Math.min(pending.next + BATCH_BLOCKS, pending.end);
      this.insertRange(pending, upTo);
      const last = pending.blocks[pending.next - 1];
      if (last && last.endLine - firstLine >= lines) break;
    }
  }

  /** Adds the blocks from `pending.next` up to `upTo` (exclusive) to the page, in one go. */
  private insertRange(pending: Pending, upTo: number): void {
    while (pending.next < upTo) {
      const to = Math.min(pending.next + BATCH_BLOCKS, upTo);
      this.insertBatch(pending, to);
    }
  }

  private insertBatch(pending: Pending, to: number): void {
    const { blocks } = pending;
    const from = pending.next;
    const count = to - from;
    // In a large document the blocks from `nearUntil` on are empty boxes: no HTML is made for them.
    const nearCount = this.windowed ? clamp(pending.nearUntil - from, 0, count) : count;
    const doc = this.options.container.ownerDocument;
    const fragment = doc.createDocumentFragment();

    const elements = this.parseBlocks(blocks, from, from + nearCount, fragment);
    const entries: Shown[] = [];
    for (let i = 0; i < Math.min(nearCount, elements.length); i++) {
      const block = blocks[from + i] as RenderedBlock;
      const element = elements[i] as HTMLElement;
      const html = block.html;
      const inner = hasInnerLines(html);
      if (inner) applyInnerLines(element, block.line);
      if (needsEnhancement(html)) {
        for (const job of enhanceBlock(element, this.enhance)) this.track(job);
      }
      entries.push({
        key: block.key,
        line: block.line,
        endLine: block.endLine,
        element,
        inner,
        content: 'shown',
        block: this.windowed ? block : undefined,
        height: 0,
        seen: false,
        enhance: false,
      });
    }
    for (let i = nearCount; i < count; i++) {
      const block = blocks[from + i] as RenderedBlock;
      const height = this.estimatedHeight(block);
      const element = doc.createElement('div');
      element.className = 'wd-block wd-far';
      element.setAttribute('data-line', String(block.line));
      element.setAttribute('data-end-line', String(block.endLine));
      element.setAttribute('data-key', block.key);
      element.style.height = `${height}px`;
      fragment.append(element);
      entries.push({
        key: block.key,
        line: block.line,
        endLine: block.endLine,
        element,
        inner: false,
        content: 'none',
        block,
        height,
        seen: false,
        enhance: false,
      });
    }
    if (this.observer) {
      for (const entry of entries) {
        this.blockOf.set(entry.element, entry);
        this.observer.observe(entry.element);
      }
    }
    this.options.container.insertBefore(fragment, pending.anchor);
    this.shown.splice(pending.at, 0, ...entries);
    pending.at += entries.length;
    pending.next = to;
    this.orderDirty = true;
  }

  /**
   * Makes the wrapper elements of the blocks from `from` up to `to` (exclusive) from their HTML and
   * appends them to `fragment`. Returns them in order.
   */
  private parseBlocks(
    blocks: readonly RenderedBlock[],
    from: number,
    to: number,
    fragment: DocumentFragment,
  ): HTMLElement[] {
    if (to <= from) return [];
    this.template ??= this.options.container.ownerDocument.createElement('template');
    const template = this.template;
    let html = '';
    for (let i = from; i < to; i++) html += (blocks[i] as RenderedBlock).html;
    template.innerHTML = html;
    let elements = Array.from(template.content.children) as HTMLElement[];
    if (elements.length === to - from) {
      fragment.append(template.content);
      return elements;
    }
    // Never expected: every block is exactly one wrapper element. Parse them one by one.
    elements = [];
    for (let i = from; i < to; i++) {
      template.innerHTML = (blocks[i] as RenderedBlock).html;
      const element = template.content.firstElementChild as HTMLElement | null;
      if (element) {
        fragment.append(element);
        elements.push(element);
      }
    }
    return elements;
  }

  /** Keeps `data-line` of a block that stays up to date when only its position changed. */
  private syncLines(shown: Shown | undefined, block: RenderedBlock | undefined): void {
    if (!shown || !block) return;
    if (shown.line === block.line && shown.endLine === block.endLine) return;
    applyBlockLines(shown.element, block.line, block.endLine, shown.inner);
    shown.line = block.line;
    shown.endLine = block.endLine;
  }

  private scheduleSlice(): void {
    const pending = this.pending;
    if (!pending) return;
    pending.timer = setTimeout(() => this.runSlice(this.options.sliceMs ?? SLICE_MS), 0);
  }

  /** Adds blocks for about `budgetMs`, then lets the browser breathe. */
  private runSlice(budgetMs: number): void {
    const pending = this.pending;
    if (!pending || this.disposed) return;
    clearTimeout(pending.timer);
    pending.timer = undefined;
    const started = this.now();
    const focusedTask = this.focusedTaskLine();
    while (pending.next < pending.end && this.now() - started < budgetMs) {
      this.insertBatch(pending, Math.min(pending.next + BATCH_BLOCKS, pending.end));
    }
    this.restoreFocus(focusedTask);
    pending.spent += this.now() - started;
    if (pending.next < pending.end) {
      this.scheduleSlice();
      return;
    }
    const spent = pending.spent;
    const result = pending.result;
    this.finishPending();
    this.options.onRendered?.({ renderMs: spent, first: false, result, complete: true });
  }

  private finishPending(): void {
    const pending = this.pending;
    this.pending = undefined;
    this.applyCursor();
    pending?.done();
    this.notifyChanged();
  }

  private notifyChanged(): void {
    for (const listener of this.changeListeners) listener();
  }

  // ---- find in the preview ------------------------------------------------------------------

  /** Calls `listener` when blocks were added, replaced or drawn; returns a way to stop. */
  onBlocksChanged(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /** Every block of the document in page order (also the ones a large document does not draw). */
  findSources(): FindSource[] {
    this.completeNow();
    return this.shown.map((shown) => ({
      key: shown.key,
      html: shown.content === 'shown' ? undefined : shown.block?.html,
      element: shown.element,
    }));
  }

  /**
   * The whole document as the pipeline renders it now (every block, drawn or not, as sanitized
   * HTML), for export and print. Blocks that were rendered before are served from the pipeline's
   * caches. Null when the document has a parse error.
   */
  renderForExport(): RenderResult | null {
    const result = this.pipeline.render(this.options.getSource(), this.options.getContext?.());
    // A parse error (MDX): export what the preview still shows, the last good render.
    return result.error ? this.lastGood : result;
  }

  /** Draws the content of block `index` (of `findSources`) if it is not drawn. */
  revealBlock(index: number): HTMLElement | undefined {
    const shown = this.shown[index];
    if (!shown) return undefined;
    if (this.windowed && shown.content !== 'shown') {
      this.applyWindow(new Map([[shown, true]]));
    }
    return shown.element;
  }

  private cancelPending(): void {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending = undefined;
    pending.done();
  }

  /** Remembers which task checkbox has the keyboard focus, as its line. */
  private focusedTaskLine(): string | null {
    const container = this.options.container;
    const active = container.ownerDocument.activeElement;
    if (!active || !container.contains(active)) return null;
    return active.matches('.task-checkbox[data-task-line]')
      ? active.getAttribute('data-task-line')
      : null;
  }

  /** A task box that was replaced while it had the focus gives the focus to its successor. */
  private restoreFocus(line: string | null): void {
    if (line === null) return;
    const container = this.options.container;
    if (container.ownerDocument.activeElement !== container.ownerDocument.body) return;
    const next = container.querySelector<HTMLElement>(`.task-checkbox[data-task-line="${line}"]`);
    next?.focus({ preventScroll: true });
  }

  private refreshOrder(): void {
    this.orderDirty = false;
    let length = this.shown.length;
    for (let i = 1; i < this.shown.length; i++) {
      if ((this.shown[i] as Shown).line < (this.shown[i - 1] as Shown).line) {
        length = i;
        break;
      }
    }
    this.sortedLength = length;
  }

  // ---- large documents: only the blocks near the viewport show their content --------------------

  /** True if only the blocks near the viewport show their content. */
  private get windowed(): boolean {
    return this.observer !== undefined;
  }

  /** Switches the large-document display on or off, for the document that is about to be shown. */
  private setLarge(large: boolean): void {
    this.options.container.classList.toggle('wd-preview-large', large);
    if (large === this.large) return;
    this.large = large;
    if (large) {
      // Without a way to tell which blocks are near, every block shows its content.
      if (typeof IntersectionObserver === 'undefined') return;
      this.scroller = scrollerOf(this.options.container);
      this.observer = new IntersectionObserver((entries) => this.onIntersect(entries), {
        root: this.scroller,
        rootMargin: `${NEAR_MARGIN} 0px`,
      });
      for (const shown of this.shown) {
        this.blockOf.set(shown.element, shown);
        this.observer.observe(shown.element);
      }
    } else {
      this.observer?.disconnect();
      this.observer = undefined;
      this.blockOf.clear();
      // Everything shows its content again.
      for (const shown of this.shown) if (shown.content !== 'shown') this.fill(shown);
      this.hidden.clear();
    }
  }

  /** The height of a block that was never seen: its lines at what the blocks seen so far needed. */
  private estimatedHeight(block: RenderedBlock): number {
    const lines = block.endLine - block.line + 2;
    return clamp(Math.round(lines * this.pxPerLine), MIN_FAR_PX, MAX_FAR_PX);
  }

  /** Measures the blocks from `from` up to `to` (they are shown) to estimate the others better. */
  private learnHeights(from: number, to: number): void {
    for (let i = from; i < to; i++) this.measure(this.shown[i]);
  }

  /** Reads the height of a block that is shown, and what it says about the heights of others. */
  private measure(shown: Shown | undefined): void {
    if (shown?.content !== 'shown') return;
    // The height of the box, not rounded: heights that are off by half a pixel add up over
    // thousands of blocks.
    const height = shown.element.getBoundingClientRect().height;
    // A pane that is not on screen has no layout: nothing can be learned.
    if (height <= 0) return;
    shown.height = height;
    if (shown.seen) return;
    shown.seen = true;
    this.seenPx += height;
    this.seenLines += shown.endLine - shown.line + 2;
    this.pxPerLine = clamp(this.seenPx / this.seenLines, 8, 80);
  }

  /** The block keeps its content but shows nothing, at the height it had: it costs no layout. */
  private hide(shown: Shown): void {
    shown.content = 'hidden';
    shown.element.style.height = `${shown.height}px`;
    shown.element.classList.add('wd-far');
    this.hidden.delete(shown);
    this.hidden.add(shown);
    // Only so many blocks keep content they do not show: the ones that went far first lose it.
    while (this.hidden.size > MAX_HIDDEN_BLOCKS) {
      const oldest = this.hidden.values().next().value as Shown;
      this.hidden.delete(oldest);
      // A block that cannot be made again (it was shown before the document became large) stays.
      if (!oldest.block) continue;
      oldest.element.replaceChildren();
      oldest.content = 'none';
      oldest.inner = false;
      oldest.enhance = false;
    }
  }

  /** Makes the content of an empty block (HTML, line numbers). It is not shown yet. */
  private makeContent(shown: Shown): void {
    const html = shown.block?.html;
    if (html === undefined) return;
    this.template ??= this.options.container.ownerDocument.createElement('template');
    this.template.innerHTML = html;
    const made = this.template.content.firstElementChild;
    if (!made) return;
    shown.element.replaceChildren(...Array.from(made.childNodes));
    shown.inner = hasInnerLines(html);
    if (shown.inner) applyInnerLines(shown.element, shown.line);
    shown.enhance = needsEnhancement(html);
  }

  /** The block shows its content, at the height the content needs. */
  private fill(shown: Shown): void {
    if (shown.content === 'none') this.makeContent(shown);
    shown.content = 'shown';
    this.hidden.delete(shown);
    shown.element.classList.remove('wd-far');
    shown.element.style.removeProperty('height');
    if (shown.enhance) {
      shown.enhance = false;
      for (const job of enhanceBlock(shown.element, this.enhance)) this.track(job);
    }
  }

  private onIntersect(entries: IntersectionObserverEntry[]): void {
    if (this.disposed || !this.visible) return;
    const scroller = this.scroller;
    // The pane is not on screen (Editor view): it has no layout, and everything seems far.
    if (scroller && scroller.clientHeight === 0) return;
    // The last word on a block is the last entry for it.
    const changes = new Map<Shown, boolean>();
    for (const entry of entries) {
      const shown = this.blockOf.get(entry.target);
      if (shown) changes.set(shown, entry.isIntersecting);
    }
    this.applyWindow(changes);
  }

  /**
   * Shows the blocks that came near and hides the ones that went far. A block above the viewport
   * that gets taller or shorter than it was moves everything below it, so the scroll position is
   * moved by the same amount: what the reader looks at stays where it is.
   */
  private applyWindow(changes: Map<Shown, boolean>): void {
    const emptied: Shown[] = [];
    const filled: Shown[] = [];
    const active = this.options.container.ownerDocument.activeElement;
    for (const [shown, near] of changes) {
      if (near) {
        if (shown.content !== 'shown') filled.push(shown);
        // A block that holds the keyboard focus stays as it is.
      } else if (shown.content === 'shown' && !(active && shown.element.contains(active))) {
        emptied.push(shown);
      }
    }
    if (emptied.length === 0 && filled.length === 0) return;

    // Read before writing. The heights that the blocks hidden now have are what they keep, and a
    // block that starts above the top of the viewport moves what is below it when its height
    // changes (the viewport is the scroll area, not the area in which blocks are near).
    const top = this.scroller ? this.scroller.getBoundingClientRect().top : 0;
    const above = filled.filter((shown) => shown.element.getBoundingClientRect().top < top);
    const was = new Map(above.map((shown) => [shown, shown.height]));
    for (const shown of emptied) this.measure(shown);
    for (const shown of emptied) this.hide(shown);
    for (const shown of filled) this.fill(shown);

    let delta = 0;
    for (const shown of filled) {
      this.measure(shown);
      delta += was.has(shown) ? shown.height - (was.get(shown) as number) : 0;
    }
    if (delta !== 0 && this.scroller) this.scroller.scrollTop += delta;
    this.notifyChanged();
  }

  /**
   * Makes the block of the heading with this id show its content, so that the heading is in the
   * page and its position can be measured (a jump to a heading in a large document).
   */
  revealHeading(id: string): void {
    if (!this.windowed) return;
    const heading = this.headings.find((candidate) => candidate.id === id);
    const shown = heading ? this.blockAt(heading.line) : undefined;
    if (shown && shown.content !== 'shown') {
      this.applyWindow(new Map([[shown, true]]));
    }
  }

  // ---- the block under the cursor ---------------------------------------------------------

  private applyCursor(): void {
    const line = this.cursorLine;
    const found = line === null ? undefined : this.blockAt(line);
    const element = found?.element ?? null;
    if (element === this.cursorElement) return;
    this.cursorElement?.classList.remove('is-cursor-block');
    element?.classList.add('is-cursor-block');
    this.cursorElement = element;
    // In a large document the block may be an empty box (the caret jumped far from the screen):
    // it gets its content, so that what is marked is what the caret is in.
    if (this.windowed && found && found.content !== 'shown') {
      this.applyWindow(new Map([[found, true]]));
    }
  }

  private blockAt(line: number): Shown | undefined {
    // Binary search among the blocks whose lines grow: the last one that starts at or before `line`.
    if (this.orderDirty) this.refreshOrder();
    const sorted = Math.min(this.sortedLength, this.shown.length);
    let low = 0;
    let high = sorted - 1;
    let found = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if ((this.shown[middle] as Shown).line <= line) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    const block = found >= 0 ? this.shown[found] : undefined;
    if (block && line <= block.endLine) return block;
    // Blocks that sit out of order (footnotes moved to the end).
    for (let i = sorted; i < this.shown.length; i++) {
      const moved = this.shown[i] as Shown;
      if (line >= moved.line && line <= moved.endLine) return moved;
    }
    return undefined;
  }

  // ---- hidden preview ----------------------------------------------------------------------

  private scheduleAnalysis(): void {
    if (!this.options.onAnalyzed || this.analyzeTimer !== undefined) return;
    const wait = Math.max(
      PREVIEW_DEBOUNCE_MS,
      this.lastAnalyzedAt + ANALYZE_INTERVAL_MS - this.now(),
    );
    this.analyzeTimer = setTimeout(() => {
      this.analyzeTimer = undefined;
      if (this.visible || this.disposed) return;
      this.analyzeNow();
    }, wait);
  }

  private analyzeNow(): void {
    if (!this.options.onAnalyzed) return;
    clearTimeout(this.analyzeTimer);
    this.analyzeTimer = undefined;
    this.lastAnalyzedAt = this.now();
    this.options.onAnalyzed(
      this.pipeline.analyze(this.options.getSource(), this.options.getContext?.()),
    );
  }

  // ---- what happens on the page ----------------------------------------------------------

  private readonly onClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('.code-copy');
    if (!button || !this.options.container.contains(button)) return;
    event.preventDefault();
    void copyCode(button);
  };

  private track(job: Promise<void>): void {
    this.work.add(job);
    const forget = () => this.work.delete(job);
    job.then(forget, forget);
  }
}

// ---- the Copy button of a code card -------------------------------------------------------

async function writeClipboard(text: string, document: Document): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Not allowed here, or not available: fall back to the old way.
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.className = 'wd-clipboard-field';
  document.body.append(field);
  field.select();
  try {
    document.execCommand('copy');
  } finally {
    field.remove();
  }
}

const copiedTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

/** Copies the code of the card a Copy button belongs to, and shows "Copied" for 1.5 seconds. */
export async function copyCode(button: Element): Promise<void> {
  const code = button.closest('.code-card')?.querySelector('pre > code');
  if (!code) return;
  await writeClipboard(code.textContent ?? '', button.ownerDocument);
  const label = button.querySelector('.code-copy-label');
  if (!label) return;
  label.textContent = COPIED_LABEL;
  button.classList.add('is-copied');
  clearTimeout(copiedTimers.get(button));
  copiedTimers.set(
    button,
    setTimeout(() => {
      label.textContent = COPY_LABEL;
      button.classList.remove('is-copied');
    }, COPIED_MS),
  );
}
