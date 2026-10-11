/** Geometry of the two-pane splitter. All widths are in CSS pixels. */

export const SPLITTER_WIDTH = 6;
/** Neither pane may become narrower than this. */
export const MIN_PANE_WIDTH = 240;
export const DEFAULT_RATIO = 0.5;
/** Share of the width moved by one arrow key press. */
export const KEY_STEP = 0.02;

/** Keeps both panes at least `MIN_PANE_WIDTH` wide. A too narrow container falls back to 50/50. */
export function clampRatio(ratio: number, containerWidth: number): number {
  const usable = containerWidth - SPLITTER_WIDTH;
  if (usable < MIN_PANE_WIDTH * 2) return DEFAULT_RATIO;
  const min = MIN_PANE_WIDTH / usable;
  return Math.min(1 - min, Math.max(min, ratio));
}

/** The editor's share of the width when the splitter's center is at pointer position `x`. */
export function ratioFromPointer(x: number, containerLeft: number, containerWidth: number): number {
  const usable = containerWidth - SPLITTER_WIDTH;
  if (usable <= 0) return DEFAULT_RATIO;
  return clampRatio((x - containerLeft - SPLITTER_WIDTH / 2) / usable, containerWidth);
}

/**
 * CSS `grid-template-columns` for the panes: editor, splitter and preview in Split view, a single
 * column in Editor or Preview view (the other pane is not displayed).
 */
export function gridColumns(ratio: number, view: 'editor' | 'split' | 'preview' = 'split'): string {
  if (view !== 'split') return 'minmax(0, 1fr)';
  return `minmax(0, ${ratio}fr) ${SPLITTER_WIDTH}px minmax(0, ${1 - ratio}fr)`;
}
