import { describe, expect, it, vi } from 'vitest';
import { createMockPlatform } from '@/lib/platform-mock';
import { runSearchBench, SEARCH_BENCH_RUNS } from '@/perf/search-bench';

const match = (line: number) => ({
  line,
  text: 'a lantern',
  ranges: [[2, 9]] as [number, number][],
});

function clock(step: number): () => number {
  let t = 0;
  return () => {
    t += step;
    return t;
  };
}

describe('search benchmark', () => {
  it('runs the search 5 times in a row and reports time and counts of each', async () => {
    const platform = createMockPlatform({
      searchResults: {
        lantern: {
          files: [
            { path: '/folder/a.md', matches: [match(1), match(4)] },
            { path: '/folder/b.md', matches: [match(2)] },
          ],
        },
      },
    });
    const spy = vi.spyOn(platform, 'searchFolder');

    // The clock advances 7 ms per reading: one reading before the call, one after it.
    const report = await runSearchBench(platform, '/folder', 'lantern', { now: clock(7) });

    expect(SEARCH_BENCH_RUNS).toBe(5);
    expect(spy).toHaveBeenCalledTimes(5);
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ folder: '/folder', query: 'lantern' });
    expect(report.error).toBeNull();
    expect(report.query).toBe('lantern');
    expect(report.runs).toHaveLength(5);
    for (const run of report.runs) {
      expect(run).toEqual({ ms: 7, files: 2, matches: 3, truncated: false });
    }
  });

  it('runs each search after the previous result', async () => {
    let active = 0;
    let overlap = false;
    const platform = {
      searchFolder: async () => {
        active++;
        overlap ||= active > 1;
        await Promise.resolve();
        active--;
        return {
          id: 1,
          files: [],
          matchCount: 1000,
          fileCount: 3,
          truncated: true,
          cancelled: false,
          error: null,
        };
      },
    };

    const report = await runSearchBench(platform, '/f', 'x');

    expect(overlap).toBe(false);
    expect(report.runs.every((run) => run.truncated)).toBe(true);
  });

  it('reports an error instead of numbers when no folder is open or the search fails', async () => {
    const none = await runSearchBench({ searchFolder: vi.fn() }, null, 'x');
    expect(none).toEqual({ query: 'x', runs: [], error: 'no folder is open' });

    const failing = await runSearchBench(
      { searchFolder: async () => Promise.reject(new Error('boom /secret/path')) },
      '/f',
      'x',
    );
    expect(failing.runs).toEqual([]);
    expect(failing.error).toBe('the search failed');
  });
});
