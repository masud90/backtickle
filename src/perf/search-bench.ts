/**
 * Search benchmark for the measurement harness (scenario S12):
 * `BACKTICKLE_PERF=1 BACKTICKLE_BENCH=search [BACKTICKLE_BENCH_QUERY=lantern]`.
 *
 * After startup it runs the Search tab's search for the query in the open folder 5 times, each one
 * after the previous result, and records for each the milliseconds from the `searchFolder` call to
 * its result, plus the file and match counts and whether the match cap was hit.
 */
import type { Platform, SearchBenchReport, SearchBenchRun, SearchResult } from '@/lib/platform';

export const SEARCH_BENCH_RUNS = 5;
export const SEARCH_BENCH_DEFAULT_QUERY = 'lantern';

export async function runSearchBench(
  platform: Pick<Platform, 'searchFolder'>,
  folder: string | null,
  query: string,
  options: { runs?: number; now?: () => number } = {},
): Promise<SearchBenchReport> {
  const runs: SearchBenchRun[] = [];
  if (!folder) return { query, runs, error: 'no folder is open' };
  const now = options.now ?? (() => performance.now());
  const wanted = options.runs ?? SEARCH_BENCH_RUNS;
  for (let i = 0; i < wanted; i++) {
    const start = now();
    let result: SearchResult;
    try {
      result = await platform.searchFolder({
        id: 1_000_000 + i,
        folder,
        query,
        caseSensitive: false,
        wholeWord: false,
        regex: false,
      });
    } catch {
      return { query, runs, error: 'the search failed' };
    }
    const ms = now() - start;
    if (result.error || result.cancelled) {
      return { query, runs, error: 'the search was cancelled or failed' };
    }
    runs.push({
      ms,
      files: result.fileCount,
      matches: result.matchCount,
      truncated: result.truncated,
    });
  }
  return { query, runs, error: null };
}
