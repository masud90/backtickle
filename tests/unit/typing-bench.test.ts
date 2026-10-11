import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BENCH_INSERTIONS,
  BENCH_INTERVAL_MS,
  type BenchTarget,
  runTypingBench,
} from '@/perf/typing-bench';

/** A target whose preview "renders" a fixed time after the last typed character. */
function makeTarget(options: { debounceMs: number }) {
  const listeners = new Set<(renderMs: number) => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const typed: number[] = [];
  const target: BenchTarget = {
    typeCharacter: () => {
      typed.push(performance.now());
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (const listener of listeners) listener(2.5);
      }, options.debounceMs);
    },
    documentBytes: () => 4242,
    onPreviewRendered: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { target, typed, listeners };
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'performance',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runTypingBench', () => {
  it('types 60 characters, one every 150 ms', async () => {
    expect(BENCH_INSERTIONS).toBe(60);
    expect(BENCH_INTERVAL_MS).toBe(150);
    const { target, typed } = makeTarget({ debounceMs: 120 });

    const done = runTypingBench(target);
    await vi.advanceTimersByTimeAsync(60 * 150 + 1000);
    await done;

    expect(typed).toHaveLength(60);
    const gaps = typed.slice(1).map((time, i) => time - (typed[i] as number));
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(149);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(151);
  });

  it('reports one render_ms and one e2e_ms per insertion, plus the document size', async () => {
    const { target } = makeTarget({ debounceMs: 120 });

    const done = runTypingBench(target);
    await vi.advanceTimersByTimeAsync(60 * 150 + 1000);
    const report = await done;

    expect(report.docBytes).toBe(4242);
    expect(report.renderMs).toHaveLength(60);
    expect(report.e2eMs).toHaveLength(60);
    expect(report.renderMs.every((ms) => ms === 2.5)).toBe(true);
    // The end-to-end time includes the 120 ms debounce, so it is always larger.
    expect(report.e2eMs.every((ms) => ms >= 120)).toBe(true);
  });

  it('gives insertions that share one preview update the same render_ms and a longer wait', async () => {
    // A debounce longer than the typing interval merges neighbouring insertions into one update.
    const { target } = makeTarget({ debounceMs: 400 });

    const done = runTypingBench(target, { insertions: 6, intervalMs: 150 });
    await vi.advanceTimersByTimeAsync(6 * 150 + 2000);
    const report = await done;

    expect(report.renderMs).toHaveLength(6);
    expect(report.e2eMs).toHaveLength(6);
    // The first insertion waited the longest for the shared update.
    expect(report.e2eMs[0] as number).toBeGreaterThan(report.e2eMs[5] as number);
  });

  it('stops listening to the preview when it is done', async () => {
    const { target, listeners } = makeTarget({ debounceMs: 120 });

    const done = runTypingBench(target, { insertions: 3 });
    await vi.advanceTimersByTimeAsync(3 * 150 + 1000);
    await done;

    expect(listeners.size).toBe(0);
  });
});
