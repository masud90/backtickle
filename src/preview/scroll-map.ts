/**
 * The relation between source lines and positions in the preview, for sync scroll and for
 * jumping to a line. The map has two anchors per block, its first line at its top edge and the
 * line after its last line at its bottom edge, and interpolates linearly between consecutive
 * anchors: inside a block, and across the gap between two blocks. Lines are fractional (12.5 is
 * half way down line 12).
 *
 * Both directions are monotonic. Blocks whose lines do not grow with their position, such as the
 * footnotes that move to the end of the document, are clamped to the largest line before them,
 * so scrolling through the footnotes keeps the editor at the end of the text.
 *
 * Offsets are CSS pixels measured from the top edge of the container, whatever its scroll
 * position. Build the map after layout has settled, and again after the preview changed.
 */

export interface ScrollMap {
  /** The offset of a (fractional) 0-based source line. */
  offsetForLine(line: number): number;
  /** The (fractional) 0-based source line at an offset. */
  lineForOffset(offset: number): number;
  /** The number of blocks in the map. */
  readonly blocks: number;
}

export function buildScrollMap(container: HTMLElement): ScrollMap {
  const lines: number[] = [];
  const offsets: number[] = [];
  const origin = container.getBoundingClientRect().top;
  let blocks = 0;

  const add = (line: number, offset: number) => {
    const lastLine = lines[lines.length - 1];
    const lastOffset = offsets[offsets.length - 1];
    lines.push(lastLine === undefined ? line : Math.max(lastLine, line));
    offsets.push(lastOffset === undefined ? offset : Math.max(lastOffset, offset));
  };

  for (const element of container.children) {
    const line = Number(element.getAttribute('data-line'));
    const end = Number(element.getAttribute('data-end-line'));
    if (!element.hasAttribute('data-line') || !Number.isFinite(line)) continue;
    const rect = element.getBoundingClientRect();
    add(line, rect.top - origin);
    add(Number.isFinite(end) ? Math.max(end, line) + 1 : line + 1, rect.bottom - origin);
    blocks++;
  }

  return {
    blocks,
    offsetForLine(line: number): number {
      const count = lines.length;
      if (count === 0) return 0;
      const first = lines[0] as number;
      const last = lines[count - 1] as number;
      if (line <= first) return offsets[0] as number;
      if (line >= last) return offsets[count - 1] as number;
      // The first anchor whose line is at least `line`.
      let low = 0;
      let high = count - 1;
      while (low < high) {
        const middle = (low + high) >> 1;
        if ((lines[middle] as number) >= line) high = middle;
        else low = middle + 1;
      }
      const upperLine = lines[low] as number;
      const upperOffset = offsets[low] as number;
      if (upperLine === line || low === 0) return upperOffset;
      const lowerLine = lines[low - 1] as number;
      const lowerOffset = offsets[low - 1] as number;
      const fraction = (line - lowerLine) / (upperLine - lowerLine);
      return lowerOffset + fraction * (upperOffset - lowerOffset);
    },

    lineForOffset(offset: number): number {
      const count = lines.length;
      if (count === 0) return 0;
      if (offset <= (offsets[0] as number)) return lines[0] as number;
      if (offset >= (offsets[count - 1] as number)) return lines[count - 1] as number;
      // The last anchor whose offset is at most `offset`.
      let low = 0;
      let high = count - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        if ((offsets[middle] as number) <= offset) low = middle;
        else high = middle - 1;
      }
      const lowerOffset = offsets[low] as number;
      const upperOffset = offsets[low + 1] as number;
      const lowerLine = lines[low] as number;
      const upperLine = lines[low + 1] as number;
      if (upperOffset === lowerOffset) return lowerLine;
      const fraction = (offset - lowerOffset) / (upperOffset - lowerOffset);
      return lowerLine + fraction * (upperLine - lowerLine);
    },
  };
}
