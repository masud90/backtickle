import { describe, expect, it } from 'vitest';
import { fuzzyMatch, fuzzyRank } from '@/shell/fuzzy';

// Scoring rules (src/shell/fuzzy.ts header): +1 per matched character, +4 at a word start,
// +5 right after the previous match, +2 in the file name, -1 per skipped character in between.
// Every expected value below is worked out by hand from those rules.

describe('fuzzyMatch', () => {
  it('scores consecutive characters at the text start', () => {
    // "ab" in "ab": a = 1 + 2 (file name) + 4 (start) = 7; b = 1 + 2 + 5 (consecutive) = 8.
    expect(fuzzyMatch('ab', 'ab')).toEqual({ score: 15, indices: [0, 1] });
  });

  it('prefers a word start over a plain gap', () => {
    // "ab" in "a_b": a = 7; b = 1 + 2 + 4 (after "_") - 1 (one skipped) = 6; total 13.
    expect(fuzzyMatch('ab', 'a_b')).toEqual({ score: 13, indices: [0, 2] });
    // "ab" in "axb": a = 7; b = 1 + 2 - 1 = 2; total 9.
    expect(fuzzyMatch('ab', 'axb')).toEqual({ score: 9, indices: [0, 2] });
  });

  it('gives the file name a bonus', () => {
    // "note" in "docs/note.md": n = 1 + 2 + 4 = 7, then o, t, e = 8 each; total 31.
    expect(fuzzyMatch('note', 'docs/note.md')).toEqual({ score: 31, indices: [5, 6, 7, 8] });
    // "note" in "notes/other.md": file name starts at 6; n = 1 + 4 = 5, then 1 + 5 = 6 each; total 23.
    expect(fuzzyMatch('note', 'notes/other.md')).toEqual({ score: 23, indices: [0, 1, 2, 3] });
  });

  it('treats a lower to upper case change as a word start', () => {
    // "fb" in "fooBar": f = 7; B = 1 + 2 + 4 - 2 (two skipped) = 5; total 12.
    expect(fuzzyMatch('fb', 'fooBar')).toEqual({ score: 12, indices: [0, 3] });
    // "fb" in "foobar": b = 1 + 2 - 2 = 1; total 8.
    expect(fuzzyMatch('fb', 'foobar')?.score).toBe(8);
  });

  it('ignores case and spaces in the query', () => {
    expect(fuzzyMatch('NO TE', 'docs/note.md')?.indices).toEqual([5, 6, 7, 8]);
  });

  it('matches everything with an empty query and nothing when characters are missing or out of order', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, indices: [] });
    expect(fuzzyMatch('xyz', 'docs/note.md')).toBeNull();
    expect(fuzzyMatch('ba', 'ab')).toBeNull();
  });
});

describe('fuzzyRank', () => {
  it('ranks the file name match first', () => {
    const ranked = fuzzyRank(['notes/other.md', 'docs/note.md', 'zzz.md'], 'note', (item) => item);
    expect(ranked.map((entry) => entry.item)).toEqual(['docs/note.md', 'notes/other.md']);
  });

  it('breaks ties by the shorter text, then the input order', () => {
    // "a" scores 1 + 2 + 4 = 7 at the start of all three; lengths 1, 3, 3.
    const ranked = fuzzyRank(['a.x', 'a', 'a.y'], 'a', (item) => item);
    expect(ranked.map((entry) => entry.item)).toEqual(['a', 'a.x', 'a.y']);
  });

  it('keeps the input order for an empty query', () => {
    const ranked = fuzzyRank(['b', 'a'], '', (item) => item);
    expect(ranked.map((entry) => entry.item)).toEqual(['b', 'a']);
  });
});
