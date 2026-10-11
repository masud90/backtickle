import { describe, expect, it } from 'vitest';
import { collapsePageRanges } from '../../src/preview/rules/pandoc/page-range';
import { formatQuartoDate } from '../../src/preview/rules/quarto/title-date';

describe('page ranges as Pandoc 3.8.3 prints them (hyphen kept as written)', () => {
  // Expected values: Pandoc 3.8.3 `--citeproc` output (default style) for `page: <input>`.
  const cases: Array<[string, string]> = [
    ['105-110', '105-10'],
    ['101-118', '101-18'],
    ['100-104', '100-104'],
    ['321-328', '321-28'],
    ['498-532', '498-532'],
    ['1087-1089', '1087-89'],
    ['1496-1504', '1496-504'],
    ['11564-11568', '11564-68'],
    ['13792-13803', '13792-803'],
    ['101-108', '101-8'],
    ['1001-1008', '1001-8'],
    ['1001-1011', '1001-11'],
    ['1100-1104', '1100-1104'],
    ['1105-1204', '1105-204'],
    ['1099-1101', '1099-101'],
    ['1234-1334', '1234-334'],
    ['1230-1299', '1230-99'],
    ['99-101', '99-101'],
    ['5-12', '5-12'],
    ['12-9', '12-19'],
    ['100-5', '100-105'],
    ['321-3280', '321-3280'],
    ['105-110, 120-125', '105-10, 120-25'],
  ];
  it.each(cases)('%s gives %s', (input, expected) => {
    expect(collapsePageRanges(input)).toBe(expected);
  });
  it('keeps the separator as written', () => {
    expect(collapsePageRanges('105–110')).toBe('105–10');
  });
});

describe('Quarto title-block dates (Quarto 1.9.38)', () => {
  it('shows an ISO date in the long form', () => {
    expect(formatQuartoDate('2026-10-06')).toBe('October 6, 2026');
    expect(formatQuartoDate('2026-10-06T10:00:00')).toBe('October 6, 2026');
  });
  it('leaves other values as written', () => {
    expect(formatQuartoDate('today')).toBe('today');
    expect(formatQuartoDate('last-modified')).toBe('last-modified');
    expect(formatQuartoDate('October 6, 2026')).toBe('October 6, 2026');
    expect(formatQuartoDate('2026-13-40')).toBe('2026-13-40');
  });
});
