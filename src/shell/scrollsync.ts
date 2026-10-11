/**
 * Sync scroll between the editor and the preview, and the preview's scroll position as a source
 * line (the outline follows it in Preview view).
 *
 * The editor scrolls through `topVisibleLine` and `scrollToLine`, the preview through the scroll
 * map (`buildScrollMap`): the map relates source lines to offsets in the article. The pane the
 * person scrolls leads and the other follows (`FollowGuard` tells echoes from real scrolls).
 *
 * Cost rules: the scroll listeners are passive and do nothing but note the event and ask for an
 * animation frame; one frame runs one follow. The map is built only when it is needed and
 * invalidated by what changes the preview's layout (a render, a resize of the article, an image
 * that loaded, the zoom), never by scrolling. Nothing here runs per block per scroll event.
 */
import type { EditorController } from '@/editor/controller';
import { buildScrollMap, type ScrollMap } from '@/preview/controller';
import { FollowGuard, type Side } from './follow';

/** After a follow, layout changes this soon after (large documents estimate far blocks) re-follow. */
const RECHECK_MS = 400;
/** Differences below this many pixels are not worth a scroll. */
const EPSILON_PX = 1;
/** Differences below this many lines are not worth a scroll. */
const EPSILON_LINES = 0.02;
/**
 * After a follow, the position is checked again frame by frame until it has held for
 * `VERIFY_STABLE` frames in a row (at most `VERIFY_MAX_FRAMES`): a pane that was scrolled far lays
 * out what it now shows, which can move the target (estimated heights become real ones).
 */
const VERIFY_STABLE = 3;
const VERIFY_MAX_FRAMES = 40;

export interface ScrollSyncOptions {
  editor: EditorController;
  /** The element that scrolls the preview. */
  scroller: HTMLElement;
  /** The element that holds the rendered blocks. */
  article: HTMLElement;
  /** Both panes are shown and sync scroll is on. */
  following(): boolean;
  /** Only the preview is shown: its scroll position is what the outline tracks. */
  previewOnly(): boolean;
  /** Puts everything that is still waiting into the preview (before a map is built). */
  completeNow(): void;
  /** The line at the top of the preview, in Preview view. */
  onPreviewLine(line: number): void;
  now?: () => number;
}

export class ScrollSync {
  private readonly options: ScrollSyncOptions;
  private readonly guard = new FollowGuard();
  private readonly now: () => number;
  private readonly editorScroll: HTMLElement;
  private map: ScrollMap | null = null;
  /** Where the article starts inside the scrolled content, measured with the map. */
  private articleTop = 0;
  private frame = 0;
  private pending: Side | null = null;
  private outlineFrame = 0;
  private recheckFrame = 0;
  private verifyFrame = 0;
  private verifyFrames = 0;
  private verifyStable = 0;
  private verifySide: Side = 'editor';
  private lastFollow: { side: Side; at: number } | null = null;
  private readonly resizeObserver: ResizeObserver;
  private readonly stopEditorScroll: () => void;

  constructor(options: ScrollSyncOptions) {
    this.options = options;
    this.now = options.now ?? (() => performance.now());
    this.editorScroll = options.editor.view.scrollDOM;
    this.stopEditorScroll = options.editor.onScroll(this.onEditorScroll);
    options.scroller.addEventListener('scroll', this.onPreviewScroll, { passive: true });
    // Images that load (or fail and show a placeholder) change the height of their block.
    options.article.addEventListener('load', this.invalidate, true);
    options.article.addEventListener('error', this.invalidate, true);
    this.resizeObserver = new ResizeObserver(this.onResize);
    this.resizeObserver.observe(options.article);
  }

  // ---- what the workspace tells us -----------------------------------------------------------

  /** The preview's layout changed (a render, another zoom, another view): measure again. */
  invalidate = (): void => {
    this.map = null;
  };

  /** Ignores scroll events for a while: a jump to a heading scrolls both panes on its own. */
  mute(ms: number): void {
    this.guard.mute(this.now(), ms);
  }

  /** Brings the preview to where the editor is (sync scroll was just turned on). */
  alignPreview(): void {
    this.schedule('editor');
  }

  /** Reports the line at the top of the preview now (Preview view was entered, a tab shown). */
  reportPreviewLine(): void {
    const line = this.previewTopLine();
    if (line !== null) this.options.onPreviewLine(line);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.outlineFrame);
    cancelAnimationFrame(this.recheckFrame);
    cancelAnimationFrame(this.verifyFrame);
    this.stopEditorScroll();
    this.options.scroller.removeEventListener('scroll', this.onPreviewScroll);
    this.options.article.removeEventListener('load', this.invalidate, true);
    this.options.article.removeEventListener('error', this.invalidate, true);
    this.resizeObserver.disconnect();
    this.map = null;
  }

  // ---- events -------------------------------------------------------------------------------

  private readonly onEditorScroll = (): void => {
    if (!this.options.following()) return;
    if (!this.guard.shouldFollow('editor', this.now())) return;
    this.schedule('editor');
  };

  private readonly onPreviewScroll = (): void => {
    if (this.options.previewOnly()) {
      if (!this.outlineFrame) {
        this.outlineFrame = requestAnimationFrame(() => {
          this.outlineFrame = 0;
          this.reportPreviewLine();
        });
      }
      return;
    }
    if (!this.options.following()) return;
    if (!this.guard.shouldFollow('preview', this.now())) return;
    this.schedule('preview');
  };

  private readonly onResize = (): void => {
    this.map = null;
    const last = this.lastFollow;
    if (!last || this.recheckFrame || this.now() - last.at >= RECHECK_MS) return;
    // The layout moved right after a follow (blocks far from the screen are estimates until
    // they are drawn): follow again from the exact positions, once per frame, for a short while.
    this.recheckFrame = requestAnimationFrame(() => {
      this.recheckFrame = 0;
      if (this.options.following()) this.run(last.side, false);
    });
  };

  // ---- following ----------------------------------------------------------------------------

  private schedule(side: Side): void {
    this.pending = side;
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const side = this.pending;
      this.pending = null;
      if (side && this.options.following()) this.run(side, true);
    });
  }

  private run(side: Side, remember: boolean): void {
    if (remember) this.lastFollow = { side, at: this.now() };
    if (side === 'editor') this.followEditor();
    else this.followPreview();
    if (remember) this.verifySoon(side);
  }

  /** Looks at the follower again for a few frames, and corrects it if it landed off target. */
  private verifySoon(side: Side): void {
    this.verifySide = side;
    this.verifyFrames = 0;
    this.verifyStable = 0;
    if (this.verifyFrame) return;
    const step = () => {
      this.verifyFrame = 0;
      if (!this.options.following()) return;
      const onTarget = this.verifySide === 'editor' ? this.followEditor() : this.followPreview();
      this.verifyStable = onTarget ? this.verifyStable + 1 : 0;
      if (this.verifyStable >= VERIFY_STABLE || ++this.verifyFrames >= VERIFY_MAX_FRAMES) return;
      this.verifyFrame = requestAnimationFrame(step);
    };
    this.verifyFrame = requestAnimationFrame(step);
  }

  /** The preview scrolls to the line at the top of the editor. True when it was there already. */
  private followEditor(): boolean {
    const { scroller, editor } = this.options;
    const maxPreview = scroller.scrollHeight - scroller.clientHeight;
    if (maxPreview <= EPSILON_PX) return true;
    let target: number;
    if (this.atBottom(this.editorScroll)) {
      target = maxPreview;
    } else {
      const map = this.ensureMap();
      if (!map || map.blocks === 0) return true;
      const line = editor.topVisibleLine();
      // Above the first block the preview stays at its very top (its padding included).
      target = line <= map.lineForOffset(-1) ? 0 : this.articleTop + map.offsetForLine(line);
    }
    target = Math.min(Math.max(0, target), maxPreview);
    if (Math.abs(scroller.scrollTop - target) < EPSILON_PX) return true;
    this.guard.lead('editor', this.now());
    scroller.scrollTop = target;
    return false;
  }

  /** The editor scrolls to the line at the top of the preview. True when it was there already. */
  private followPreview(): boolean {
    const { scroller, editor } = this.options;
    const sd = this.editorScroll;
    if (this.atBottom(scroller)) {
      const max = sd.scrollHeight - sd.clientHeight;
      if (max > EPSILON_PX && sd.scrollTop < max - EPSILON_PX) {
        this.guard.lead('preview', this.now());
        sd.scrollTop = max;
        return false;
      }
      return true;
    }
    const line = this.previewTopLine();
    if (line === null) return true;
    if (Math.abs(editor.topVisibleLine() - line) < EPSILON_LINES) return true;
    this.guard.lead('preview', this.now());
    editor.scrollToLine(line, 'top');
    return false;
  }

  /** The source line at the top edge of the preview, or null when it cannot be measured. */
  private previewTopLine(): number | null {
    const map = this.ensureMap();
    if (!map || map.blocks === 0) return null;
    const offset = Math.max(0, this.options.scroller.scrollTop - this.articleTop);
    return map.lineForOffset(offset);
  }

  private atBottom(element: HTMLElement): boolean {
    const max = element.scrollHeight - element.clientHeight;
    return max > EPSILON_PX && element.scrollTop >= max - EPSILON_PX;
  }

  /** The scroll map, built when it is missing; null while the preview is not laid out. */
  private ensureMap(): ScrollMap | null {
    if (this.map) return this.map;
    const { scroller, article } = this.options;
    if (scroller.clientHeight === 0) return null;
    this.options.completeNow();
    this.map = buildScrollMap(article);
    this.articleTop =
      article.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    return this.map;
  }
}
