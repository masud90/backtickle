/**
 * The reading ruler of the preview (Phase 4): one positioned element behind the text that snaps
 * to the line under the pointer. A lazy module: the workspace imports it when the ruler is turned
 * on and disposes it when it is turned off. Nothing is added per block; the work is one
 * animation frame per pointer move.
 */

/** The line height of an element in pixels (a unitless or "normal" value falls back to 1.4 em). */
export function lineHeightOf(element: Element): number {
  const style = getComputedStyle(element);
  const height = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(height) && height > 0) return height;
  const size = Number.parseFloat(style.fontSize);
  return (Number.isFinite(size) ? size : 16) * 1.4;
}

export class PreviewRuler {
  private readonly band: HTMLDivElement;
  private frame = 0;
  private x = 0;
  private y = 0;

  private readonly scroller: HTMLElement;

  constructor(scroller: HTMLElement) {
    this.scroller = scroller;
    this.band = document.createElement('div');
    this.band.className = 'wd-preview-ruler';
    this.band.dataset.testid = 'preview-ruler';
    this.band.setAttribute('aria-hidden', 'true');
    this.band.hidden = true;
    // The band sits at z-index -1 inside the scroller, so the scroller needs its own stacking
    // context, and it positions the band. CSSOM, not a style attribute (the CSP).
    scroller.style.position = 'relative';
    scroller.style.isolation = 'isolate';
    scroller.append(this.band);
    scroller.addEventListener('pointermove', this.onMove);
    scroller.addEventListener('pointerleave', this.onLeave);
  }

  private readonly onMove = (event: PointerEvent): void => {
    this.x = event.clientX;
    this.y = event.clientY;
    if (this.frame === 0) this.frame = requestAnimationFrame(this.place);
  };

  private readonly onLeave = (): void => {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.band.hidden = true;
  };

  /** Moves the band to the line box under the last pointer position, or hides it. */
  private readonly place = (): void => {
    this.frame = 0;
    const line = this.lineAt(this.x, this.y);
    if (!line) {
      this.band.hidden = true;
      return;
    }
    const base = this.scroller.getBoundingClientRect();
    this.band.style.top = `${line.top - base.top + this.scroller.scrollTop}px`;
    this.band.style.height = `${line.height}px`;
    this.band.style.width = `${this.scroller.scrollWidth}px`;
    this.band.hidden = false;
  };

  /** The vertical extent of the line of text under a point, or null when there is no text. */
  private lineAt(x: number, y: number): { top: number; height: number } | null {
    const range = document.caretRangeFromPoint?.(x, y);
    const node = range?.startContainer;
    if (!range || !node || node.nodeType !== Node.TEXT_NODE) return null;
    const text = node.textContent ?? '';
    const offset = Math.min(range.startOffset, Math.max(0, text.length - 1));
    if (text.length === 0) return null;
    const probe = document.createRange();
    probe.setStart(node, offset);
    probe.setEnd(node, offset + 1);
    const rect = probe.getClientRects()[0] ?? probe.getBoundingClientRect();
    const element = node.parentElement;
    if (!element || !this.scroller.contains(element) || rect.height === 0) return null;
    // The pointer must be on the line, not in the gap below the last line of a block.
    if (y < rect.top - 2 || y > rect.bottom + 2) {
      const height = lineHeightOf(element);
      const middle = (rect.top + rect.bottom) / 2;
      if (y < middle - height / 2 || y > middle + height / 2) return null;
    }
    const height = lineHeightOf(element);
    const middle = (rect.top + rect.bottom) / 2;
    return { top: middle - height / 2, height };
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.scroller.removeEventListener('pointermove', this.onMove);
    this.scroller.removeEventListener('pointerleave', this.onLeave);
    this.band.remove();
    this.scroller.style.removeProperty('position');
    this.scroller.style.removeProperty('isolation');
  }
}
