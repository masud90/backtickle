import { describe, expect, it } from 'vitest';
import type { Heading } from '../../src/preview/types';
import {
  currentSectionIndex,
  depthLabel,
  filterByDepth,
  sameHeadings,
  sectionCountLabel,
  shownCurrent,
} from '../../src/shell/outline';
import { clampSidebarWidth } from '../../src/shell/sidebar';

const h = (level: Heading['level'], line: number, text = `H${line}`): Heading => ({
  level,
  line,
  text,
  id: text.toLowerCase(),
});

const OUTLINE = [h(1, 0), h(2, 4), h(3, 9), h(2, 15), h(4, 20)];

describe('currentSectionIndex', () => {
  it('is -1 above the first heading and for an empty outline', () => {
    expect(currentSectionIndex([h(1, 5)], 2)).toBe(-1);
    expect(currentSectionIndex([], 3)).toBe(-1);
  });

  it('is the last heading at or above the line', () => {
    expect(currentSectionIndex(OUTLINE, 0)).toBe(0);
    expect(currentSectionIndex(OUTLINE, 3)).toBe(0);
    expect(currentSectionIndex(OUTLINE, 4)).toBe(1);
    expect(currentSectionIndex(OUTLINE, 14)).toBe(2);
    expect(currentSectionIndex(OUTLINE, 15)).toBe(3);
    expect(currentSectionIndex(OUTLINE, 999)).toBe(4);
  });

  it('counts a fractional line that is a hair above a heading as on it', () => {
    expect(currentSectionIndex(OUTLINE, 3.98)).toBe(1);
    expect(currentSectionIndex(OUTLINE, 3.5)).toBe(0);
    expect(currentSectionIndex(OUTLINE, 4.4)).toBe(1);
  });
});

describe('filterByDepth', () => {
  it('shows everything for All, and down to a level otherwise', () => {
    expect(filterByDepth(OUTLINE, 0)).toHaveLength(5);
    expect(filterByDepth(OUTLINE, 1).map((e) => e.index)).toEqual([0]);
    expect(filterByDepth(OUTLINE, 2).map((e) => e.index)).toEqual([0, 1, 3]);
    expect(filterByDepth(OUTLINE, 3).map((e) => e.index)).toEqual([0, 1, 2, 3]);
  });

  it('keeps the index in the full list', () => {
    const shown = filterByDepth(OUTLINE, 2);
    expect(shown[2]?.heading).toBe(OUTLINE[3]);
    expect(shown[2]?.index).toBe(3);
  });
});

describe('shownCurrent', () => {
  it('points at the current heading, or at the nearest shown one above it', () => {
    const shown = filterByDepth(OUTLINE, 2); // indexes 0, 1, 3
    expect(shownCurrent(shown, 1)).toBe(1);
    expect(shownCurrent(shown, 2)).toBe(1); // H3 is hidden: its parent H2 stands for it
    expect(shownCurrent(shown, 4)).toBe(2);
  });

  it('is null before any shown heading', () => {
    expect(shownCurrent(filterByDepth(OUTLINE, 2), -1)).toBeNull();
    expect(shownCurrent([], 0)).toBeNull();
  });
});

describe('labels', () => {
  it('counts sections, with the filtered share when some are hidden', () => {
    expect(sectionCountLabel(5, 5)).toBe('5 Sections');
    expect(sectionCountLabel(1, 1)).toBe('1 Section');
    expect(sectionCountLabel(0, 0)).toBe('0 Sections');
    expect(sectionCountLabel(3, 7)).toBe('3 of 7 Sections');
  });

  it('names the depths', () => {
    expect(([0, 1, 2, 3] as const).map((d) => depthLabel(d))).toEqual(['All', '1', '2', '3']);
  });
});

describe('sameHeadings', () => {
  it('compares level, line, id and text', () => {
    expect(sameHeadings(OUTLINE, [...OUTLINE])).toBe(true);
    expect(sameHeadings(OUTLINE, OUTLINE.slice(1))).toBe(false);
    expect(sameHeadings([h(1, 0)], [h(1, 1)])).toBe(false);
    expect(sameHeadings([h(1, 0)], [h(2, 0)])).toBe(false);
    expect(sameHeadings([h(1, 0, 'a')], [h(1, 0, 'b')])).toBe(false);
  });
});

describe('clampSidebarWidth', () => {
  it('keeps the width between 180 and 480 pixels', () => {
    expect(clampSidebarWidth(100)).toBe(180);
    expect(clampSidebarWidth(240)).toBe(240);
    expect(clampSidebarWidth(900)).toBe(480);
    expect(clampSidebarWidth(Number.NaN)).toBe(240);
  });
});
