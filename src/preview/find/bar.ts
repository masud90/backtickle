/**
 * The find bar of the preview pane: a field, the count, next and
 * previous, match case and close. Matches come from the model (the text of every block, also the
 * blocks of a large document that are not drawn) and are shown with `CSS.highlights`, which never
 * touches the DOM of the preview. A match in a block that is not drawn is drawn before it is shown.
 */
import './find.css';
import {
  type BlockText,
  type FindMatch,
  findAll,
  MAX_MATCHES,
  rangeFor,
  stepIndex,
  textOf,
  textOfHtml,
} from './model';
import type { PreviewFindHost } from './types';

/** At most this many matches are highlighted at once (the count is still complete). */
const MAX_HIGHLIGHTED = 5000;
const SCROLL_FRAMES = 4;

/** Where a match is: the block and the offset in its text. */
interface Position {
  block: number;
  start: number;
}

function highlightsAvailable(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
}

export class PreviewFindBar {
  private readonly host: PreviewFindHost;
  readonly hostScroller: HTMLElement;
  private readonly root: HTMLDivElement;
  private readonly field: HTMLInputElement;
  private readonly count: HTMLSpanElement;
  private readonly caseButton: HTMLButtonElement;
  private readonly doc: Document;
  private stopListening: (() => void) | undefined;
  private matchCase = false;
  private lastQuery = '';
  private matches: FindMatch[] = [];
  private current = -1;
  private live = new Map<number, BlockText>();
  private texts = new Map<string, string>();
  private muted = false;
  private frame = 0;
  private open = true;

  constructor(host: PreviewFindHost) {
    this.host = host;
    this.hostScroller = host.scroller;
    this.doc = host.scroller.ownerDocument;
    this.root = this.doc.createElement('div');
    this.root.className = 'wd-pfind';
    this.root.setAttribute('role', 'search');
    this.root.setAttribute('aria-label', 'Find in preview');
    this.root.dataset.testid = 'preview-find';

    this.field = this.doc.createElement('input');
    this.field.type = 'text';
    this.field.setAttribute('aria-label', 'Find in preview');
    this.field.setAttribute('autocomplete', 'off');
    this.field.setAttribute('autocapitalize', 'off');
    this.field.spellcheck = false;
    this.field.placeholder = 'Find';
    this.field.dataset.testid = 'preview-find-input';

    this.count = this.doc.createElement('span');
    this.count.className = 'wd-pfind-count';
    this.count.setAttribute('aria-live', 'polite');
    this.count.dataset.testid = 'preview-find-count';

    const previous = this.button('Previous match', '↑', 'preview-find-prev');
    const next = this.button('Next match', '↓', 'preview-find-next');
    this.caseButton = this.button('Match case', 'Aa', 'preview-find-case');
    this.caseButton.setAttribute('aria-pressed', 'false');
    const close = this.button('Close find', '×', 'preview-find-close');

    this.root.append(this.field, this.count, previous, next, this.caseButton, close);
    const before = host.scroller;
    before.parentElement?.insertBefore(this.root, before);

    this.field.addEventListener('input', () => this.search());
    this.field.addEventListener('keydown', (event) => this.onKey(event));
    previous.addEventListener('click', () => this.step(-1));
    next.addEventListener('click', () => this.step(1));
    close.addEventListener('click', () => this.close());
    this.caseButton.addEventListener('click', () => {
      this.matchCase = !this.matchCase;
      this.caseButton.setAttribute('aria-pressed', String(this.matchCase));
      this.search();
    });
    this.stopListening = host.onBlocksChanged(() => this.blocksChanged());
  }

  private button(label: string, text: string, testId: string): HTMLButtonElement {
    const button = this.doc.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.textContent = text;
    button.dataset.testid = testId;
    return button;
  }

  get isOpen(): boolean {
    return this.open;
  }

  get attached(): boolean {
    return this.open && this.root.isConnected;
  }

  /** Puts the focus in the field, with its text selected; `text` replaces the query. */
  focus(text?: string): void {
    if (text !== undefined && text !== '' && text !== this.field.value) {
      this.field.value = text;
      this.search();
    }
    this.field.focus();
    this.field.select();
  }

  // ---- keys --------------------------------------------------------------------------------

  private onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.step(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    }
  }

  // ---- the search --------------------------------------------------------------------------

  /** The query changed: look again, staying near the match that was current. */
  private search(): void {
    const query = this.field.value;
    // A longer query that starts with the old one stays on the match it was on.
    const keepPlace =
      this.lastQuery !== '' && query.toLowerCase().startsWith(this.lastQuery.toLowerCase());
    this.lastQuery = query;
    this.collect(keepPlace || query === '' ? this.position() : null);
    if (this.current >= 0) this.goTo(this.current);
    else this.paint();
  }

  /** The preview changed (a render, a block drawn): the matches follow it. */
  private blocksChanged(): void {
    if (this.muted || !this.open || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.open) return;
      this.collect(this.position());
      this.paint();
    });
  }

  private position(): Position | null {
    const match = this.matches[this.current];
    return match ? { block: match.block, start: match.start } : null;
  }

  /** Reads the text of every block and finds the matches; `current` goes to the nearest. */
  private collect(near: Position | null): void {
    const query = this.field.value;
    const sources = this.host.sources();
    const texts: string[] = [];
    const live = new Map<number, BlockText>();
    const cache = new Map<string, string>();
    if (query !== '') {
      for (let i = 0; i < sources.length; i++) {
        const source = sources[i];
        if (!source) continue;
        if (source.html === undefined) {
          const block = textOf(source.element);
          live.set(i, block);
          texts.push(block.text);
          continue;
        }
        let text = this.texts.get(source.key) ?? cache.get(source.key);
        if (text === undefined) text = textOfHtml(source.html, this.doc);
        cache.set(source.key, text);
        texts.push(text);
      }
    }
    this.texts = cache;
    this.live = live;
    this.matches = findAll(texts, query, this.matchCase);
    this.current = -1;
    if (this.matches.length === 0 || near === null) {
      this.current = this.matches.length > 0 ? 0 : -1;
      return;
    }
    const at = this.matches.findIndex(
      (match) =>
        match.block > near.block || (match.block === near.block && match.start >= near.start),
    );
    this.current = at < 0 ? 0 : at;
  }

  // ---- moving ------------------------------------------------------------------------------

  /** Next (1) or previous (-1) match, wrapping; reveals the block and scrolls to it. */
  step(direction: 1 | -1): void {
    if (!this.open) return;
    if (this.matches.length === 0) this.search();
    const index = stepIndex(this.current, this.matches.length, direction);
    if (index >= 0) this.goTo(index);
  }

  private goTo(index: number): void {
    const match = this.matches[index];
    if (!match) return;
    this.current = index;
    const where = this.position();
    this.muted = true;
    try {
      this.host.reveal(match.block);
      // The block is drawn now: read the texts of the page again, then follow the same match.
      this.collect(where);
    } finally {
      this.muted = false;
    }
    this.paint();
    this.scrollToCurrent(SCROLL_FRAMES);
  }

  private currentRange(): Range | null {
    const match = this.matches[this.current];
    const block = match ? this.live.get(match.block) : undefined;
    return match && block ? rangeFor(this.doc, block, match.start, match.end) : null;
  }

  /** Brings the current match into the middle third of the pane; far blocks settle over frames. */
  private scrollToCurrent(frames: number): void {
    if (!this.open) return;
    const range = this.currentRange();
    if (range) {
      const scroller = this.host.scroller;
      const box = scroller.getBoundingClientRect();
      const rect = range.getBoundingClientRect();
      const margin = Math.min(60, box.height / 4);
      if (rect.top < box.top + margin || rect.bottom > box.bottom - margin) {
        scroller.scrollTop += rect.top - (box.top + box.height * 0.35);
      }
    }
    if (frames > 0) requestAnimationFrame(() => this.scrollToCurrent(frames - 1));
  }

  // ---- showing -----------------------------------------------------------------------------

  /** The count label and the highlights of the blocks that are drawn. */
  private paint(): void {
    const total = this.matches.length;
    if (this.field.value === '') this.count.textContent = '';
    else if (total === 0) this.count.textContent = 'No matches';
    else {
      const shown =
        total >= MAX_MATCHES ? `${MAX_MATCHES.toLocaleString('en-US')}+` : String(total);
      this.count.textContent = `${this.current + 1} of ${shown}`;
    }
    if (!highlightsAvailable()) return;
    const all: Range[] = [];
    let current: Range | null = null;
    for (let i = 0; i < this.matches.length && all.length < MAX_HIGHLIGHTED; i++) {
      const match = this.matches[i] as FindMatch;
      const block = this.live.get(match.block);
      if (!block) continue;
      const range = rangeFor(this.doc, block, match.start, match.end);
      if (!range) continue;
      if (i === this.current) current = range;
      else all.push(range);
    }
    if (current === null && this.current >= 0) current = this.currentRange();
    const highlights = CSS.highlights;
    highlights.set('wd-find', new Highlight(...all));
    if (current) {
      const mark = new Highlight(current);
      mark.priority = 1;
      highlights.set('wd-find-current', mark);
    } else {
      highlights.delete('wd-find-current');
    }
  }

  // ---- closing -----------------------------------------------------------------------------

  close(): void {
    if (!this.open) return;
    this.open = false;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.stopListening?.();
    this.stopListening = undefined;
    if (highlightsAvailable()) {
      CSS.highlights.delete('wd-find');
      CSS.highlights.delete('wd-find-current');
    }
    const hadFocus = this.root.contains(this.doc.activeElement);
    this.root.remove();
    this.matches = [];
    this.live.clear();
    this.texts.clear();
    if (hadFocus) this.host.restoreFocus();
  }
}
