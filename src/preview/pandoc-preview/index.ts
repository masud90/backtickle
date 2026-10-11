/**
 * The exact preview: the document as Pandoc renders it.
 *
 * Lazy module. It owns one element in the preview's scroll pane, next to the normal preview
 * (which is hidden while this is on). Edits are debounced 800 ms; an edit while Pandoc runs
 * cancels that run. Pandoc's HTML is sanitized (MathML allowed), images go through the same
 * asset path as the normal preview, and an error shows in a banner over the last good render.
 * Nothing here evaluates anything from the document.
 */
import type { FlavorId } from '@/flavors';
import type { PandocPreviewRequest, Platform } from '@/lib/platform';
import { showBlockedRemoteImage, showMissingImage } from '../enhance';
import { classifyImageSource } from '../images';
import './pandoc-preview.css';
import { sanitizePandocHtml } from './sanitize';

/** How long after the last edit Pandoc is started. */
export const DEBOUNCE_MS = 800;

/** The flavors that have an exact preview. */
export function exactPreviewFlavor(flavor: FlavorId): boolean {
  return flavor === 'pandoc' || flavor === 'quarto' || flavor === 'gfm' || flavor === 'commonmark';
}

/** The Pandoc input format of a flavor. */
export function pandocFrom(flavor: FlavorId): 'markdown' | 'gfm' | 'commonmark' | null {
  switch (flavor) {
    case 'pandoc':
    case 'quarto':
      return 'markdown';
    case 'gfm':
      return 'gfm';
    case 'commonmark':
      return 'commonmark';
    default:
      return null;
  }
}

/** The leading YAML block of a document names a bibliography (or lists references). */
export function namesBibliography(text: string): boolean {
  const match = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
  return match !== null && /^(?:bibliography|references)[ \t]*:/m.test(match[1] ?? '');
}

const BIBLIOGRAPHY_FILE = /\.(?:bib|bibtex|json|ya?ml)$/i;

export interface PandocPreviewContext {
  flavor: FlavorId;
  path: string | null;
  /** Every file the document's preview has read (bibliographies are among them). */
  linkedPaths: string[];
}

export interface PandocPreviewOptions {
  platform: Platform;
  /** The element that scrolls the preview. */
  scroller: HTMLElement;
  /** The normal preview; hidden while this one is on. */
  article: HTMLElement;
  getText(): string;
  getContext(): PandocPreviewContext;
  resolveImage(): ((source: string) => Promise<string>) | undefined;
  /** A click on a link that is not an in-page anchor (the shell decides what it opens). */
  onLink(event: MouseEvent): void;
  /** Called after each finished render (tests and the trace use it). */
  onRendered?(): void;
  debounceMs?: number;
}

export class PandocPreview {
  readonly root: HTMLElement;
  private readonly options: PandocPreviewOptions;
  private readonly content: HTMLElement;
  private readonly banner: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private sequence = 0;
  private running = false;
  private disposed = false;
  private readonly images = new Map<string, string>();

  constructor(options: PandocPreviewOptions) {
    this.options = options;
    this.root = document.createElement('div');
    this.root.className = 'wd-pandoc-preview';
    this.root.dataset.testid = 'pandoc-preview';
    this.banner = document.createElement('div');
    this.banner.className = 'wd-pandoc-banner';
    this.banner.dataset.testid = 'pandoc-preview-error';
    this.banner.setAttribute('role', 'alert');
    this.banner.hidden = true;
    this.content = document.createElement('article');
    this.content.className = 'wd-preview select-text';
    this.content.dataset.testid = 'pandoc-preview-content';
    this.root.append(this.banner, this.content);
    options.scroller.append(this.root);
    options.article.hidden = true;
    this.root.addEventListener('click', this.onClick);
    this.renderNow();
  }

  /** An edit: Pandoc starts after the debounce; a run in progress is cancelled now. */
  schedule(): void {
    if (this.disposed) return;
    if (this.running) {
      this.sequence += 1;
      this.running = false;
      void Promise.resolve(this.options.platform.cancelPandocPreview()).catch(() => {});
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.renderNow(), this.options.debounceMs ?? DEBOUNCE_MS);
  }

  /** Renders now (another tab, a flavor change, turning it on). */
  renderNow(): void {
    if (this.disposed) return;
    clearTimeout(this.timer);
    const context = this.options.getContext();
    const from = pandocFrom(context.flavor);
    if (from === null) return;
    const text = this.options.getText();
    const bibliography = context.linkedPaths.filter((path) => BIBLIOGRAPHY_FILE.test(path));
    const request: PandocPreviewRequest = {
      docPath: context.path,
      input: text,
      from,
      citeproc: from === 'markdown' && namesBibliography(text) && bibliography.length > 0,
      bibliography,
    };
    const mine = ++this.sequence;
    this.running = true;
    this.options.platform.pandocPreview(request).then(
      (html) => {
        if (this.disposed || mine !== this.sequence) return;
        this.running = false;
        this.show(html);
      },
      (error: unknown) => {
        if (this.disposed || mine !== this.sequence) return;
        this.running = false;
        const message =
          typeof error === 'object' && error !== null && 'message' in error
            ? String((error as { message: unknown }).message)
            : 'Pandoc could not render the document.';
        if (message === 'cancelled') return;
        this.banner.textContent = message;
        this.banner.hidden = false;
        this.options.onRendered?.();
      },
    );
  }

  private show(html: string): void {
    this.banner.hidden = true;
    this.banner.textContent = '';
    const top = this.options.scroller.scrollTop;
    this.content.innerHTML = sanitizePandocHtml(html);
    this.fillImages();
    this.options.scroller.scrollTop = top;
    this.options.onRendered?.();
  }

  private fillImages(): void {
    const resolve = this.options.resolveImage();
    for (const image of this.content.querySelectorAll('img')) {
      if (image.hasAttribute('data-wd-remote')) {
        showBlockedRemoteImage(image);
        continue;
      }
      image.setAttribute('loading', 'lazy');
      image.setAttribute('decoding', 'async');
      image.addEventListener('error', () => showMissingImage(image), { once: true });
      const source = image.getAttribute('data-wd-src');
      if (source === null) continue;
      if (classifyImageSource(source) !== 'local' || !resolve) {
        showMissingImage(image);
        continue;
      }
      const known = this.images.get(source);
      if (known !== undefined) {
        image.src = known;
        continue;
      }
      resolve(source).then(
        (address) => {
          this.images.set(source, address);
          image.src = address;
        },
        () => showMissingImage(image),
      );
    }
  }

  /** The document's folder or flavor changed: image addresses are looked up again. */
  forgetImages(): void {
    this.images.clear();
  }

  private readonly onClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a[href]');
    if (!anchor) return;
    // The window itself never navigates.
    event.preventDefault();
    const href = anchor.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      let id = href.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        // keep the raw text
      }
      const element = this.content.querySelector(`[id="${CSS.escape(id)}"]`);
      if (element) {
        const scroller = this.options.scroller;
        scroller.scrollTop +=
          element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      }
      return;
    }
    this.options.onLink(event);
  };

  /**
   * Sync scroll by heading anchors only: the `index`-th heading of the source is the `index`-th
   * heading of Pandoc's output. -1 is the top of the document.
   */
  followHeading(index: number): void {
    const scroller = this.options.scroller;
    if (index < 0) {
      scroller.scrollTop = 0;
      return;
    }
    const heading = this.content.querySelectorAll('h1, h2, h3, h4, h5, h6')[index];
    if (!heading) return;
    scroller.scrollTop +=
      heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    if (this.running) {
      void Promise.resolve(this.options.platform.cancelPandocPreview()).catch(() => {});
    }
    this.root.removeEventListener('click', this.onClick);
    this.root.remove();
    this.options.article.hidden = false;
  }
}
