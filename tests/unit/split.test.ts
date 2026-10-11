import { describe, expect, it } from 'vitest';
import {
  clampRatio,
  DEFAULT_RATIO,
  gridColumns,
  MIN_PANE_WIDTH,
  ratioFromPointer,
  SPLITTER_WIDTH,
} from '@/shell/split';

describe('splitter geometry', () => {
  it('has a 6px splitter and a 50/50 default', () => {
    expect(SPLITTER_WIDTH).toBe(6);
    expect(DEFAULT_RATIO).toBe(0.5);
    expect(gridColumns(0.5)).toBe('minmax(0, 0.5fr) 6px minmax(0, 0.5fr)');
  });

  it('puts the splitter center under the pointer', () => {
    // Container from x=100, 1006px wide: 1000px for the panes.
    expect(ratioFromPointer(100 + 3 + 500, 100, 1006)).toBeCloseTo(0.5, 5);
    expect(ratioFromPointer(100 + 3 + 300, 100, 1006)).toBeCloseTo(0.3, 5);
  });

  it('never lets a pane become narrower than the minimum', () => {
    const width = 1006; // 1000px usable
    const min = MIN_PANE_WIDTH / 1000;

    expect(ratioFromPointer(0, 0, width)).toBeCloseTo(min, 5);
    expect(ratioFromPointer(5000, 0, width)).toBeCloseTo(1 - min, 5);
    expect(clampRatio(0.01, width)).toBeCloseTo(min, 5);
    expect(clampRatio(0.99, width)).toBeCloseTo(1 - min, 5);
    expect(clampRatio(0.4, width)).toBe(0.4);
  });

  it('falls back to 50/50 when the container is too narrow for two minimum panes', () => {
    expect(clampRatio(0.1, 400)).toBe(0.5);
    expect(ratioFromPointer(10, 0, 400)).toBe(0.5);
    expect(ratioFromPointer(10, 0, 0)).toBe(0.5);
  });
});

describe('gridColumns', () => {
  it('has editor, splitter and preview columns in Split view', () => {
    expect(gridColumns(0.5)).toBe('minmax(0, 0.5fr) 6px minmax(0, 0.5fr)');
    expect(gridColumns(0.25, 'split')).toBe('minmax(0, 0.25fr) 6px minmax(0, 0.75fr)');
  });

  it('has one column in Editor and in Preview view', () => {
    expect(gridColumns(0.5, 'editor')).toBe('minmax(0, 1fr)');
    expect(gridColumns(0.3, 'preview')).toBe('minmax(0, 1fr)');
  });
});
