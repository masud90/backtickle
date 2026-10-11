/** The pure parts of the outline sidebar: which section is current, the depth filter, the count. */
import type { Heading } from '@/preview/types';

/** 0 shows every level; 1, 2 and 3 show headings down to that level. */
export type OutlineDepth = 0 | 1 | 2 | 3;

export const OUTLINE_DEPTHS: readonly OutlineDepth[] = [0, 1, 2, 3];

/** A fractional line (a preview scrolled to the very top of a heading) still counts as on it. */
const LINE_TOLERANCE = 0.05;

/**
 * The index of the section that contains a line (0-based, may be fractional): the last heading at
 * or above it. Returns -1 before the first heading.
 */
export function currentSectionIndex(headings: readonly Heading[], line: number): number {
  let low = 0;
  let high = headings.length - 1;
  let found = -1;
  const limit = line + LINE_TOLERANCE;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((headings[middle] as Heading).line <= limit) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/** A shown heading and where it stands in the whole list. */
export interface OutlineEntry {
  heading: Heading;
  /** Index in the unfiltered list. */
  index: number;
}

/** The headings the depth filter lets through, each with its index in the full list. */
export function filterByDepth(headings: readonly Heading[], depth: OutlineDepth): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index] as Heading;
    if (depth === 0 || heading.level <= depth) entries.push({ heading, index });
  }
  return entries;
}

/**
 * The position in `entries` that shows the current section when the filter hides some headings:
 * the current heading itself, or the nearest shown heading above it. Null when none is shown yet.
 */
export function shownCurrent(entries: readonly OutlineEntry[], current: number): number | null {
  let found: number | null = null;
  for (let i = 0; i < entries.length; i++) {
    if ((entries[i] as OutlineEntry).index <= current) found = i;
    else break;
  }
  return found;
}

/** "5 Sections", "1 Section", or "3 of 7 Sections" while the filter hides some. */
export function sectionCountLabel(shown: number, total: number): string {
  const noun = total === 1 ? 'Section' : 'Sections';
  return shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`;
}

export function depthLabel(depth: OutlineDepth): string {
  return depth === 0 ? 'All' : String(depth);
}

/** True when two heading lists are the same, so an unchanged outline keeps its identity. */
export function sameHeadings(a: readonly Heading[], b: readonly Heading[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as Heading;
    const y = b[i] as Heading;
    if (x.line !== y.line || x.level !== y.level || x.id !== y.id || x.text !== y.text) {
      return false;
    }
  }
  return true;
}
