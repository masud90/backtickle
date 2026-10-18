/**
 * Typing benchmark for the measurement harness: `BACKTICKLE_PERF=1 BACKTICKLE_BENCH=typing`.
 *
 * After startup it types 60 characters into the middle of the document, one every 150 ms, and
 * measures for each one:
 * - render_ms: parse + sanitize + DOM patch of the preview update that picked it up;
 * - e2e_ms: from the editor transaction until that update was drawn (includes the debounce).
 *
 * Insertions that land in the same preview update share its render_ms, so both arrays always
 * have one entry per insertion, in insertion order.
 */
import type { BenchReport } from '@/lib/platform';
import { afterNextPaint } from './marks';

export const BENCH_INSERTIONS = 60;
export const BENCH_INTERVAL_MS = 150;
/** After the last insertion, wait this long for the final preview update before giving up. */
const DRAIN_TIMEOUT_MS = 30_000;

export interface BenchTarget {
  /** Types one character at the middle line of the document. */
  typeCharacter(): void;
  /** Size of the document in bytes (UTF-8). */
  documentBytes(): number;
  /** Subscribes to preview updates (called right after the DOM was patched). */
  onPreviewRendered(listener: (renderMs: number) => void): () => void;
}

export interface BenchOptions {
  insertions?: number;
  intervalMs?: number;
}

function sleepUntil(deadline: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline - performance.now())));
}

export async function runTypingBench(
  target: BenchTarget,
  options: BenchOptions = {},
): Promise<BenchReport> {
  const insertions = options.insertions ?? BENCH_INSERTIONS;
  const intervalMs = options.intervalMs ?? BENCH_INTERVAL_MS;
  const docBytes = target.documentBytes();

  const typedAt: number[] = []; // insertions not yet picked up by a preview update
  const renderMs: number[] = [];
  const e2eMs: number[] = [];
  let finish: () => void = () => {};
  const drained = new Promise<void>((resolve) => {
    finish = resolve;
  });

  const unsubscribe = target.onPreviewRendered((ms) => {
    // JavaScript is single-threaded: every insertion so far is part of this update.
    const batch = typedAt.splice(0);
    if (batch.length === 0) return;
    void afterNextPaint().then((paintedAt) => {
      for (const t of batch) {
        renderMs.push(ms);
        e2eMs.push(paintedAt - t);
      }
      if (e2eMs.length >= insertions) finish();
    });
  });

  // A fixed cadence, as a steady typist would produce, even if a render delays a timer.
  const start = performance.now();
  for (let i = 1; i <= insertions; i++) {
    await sleepUntil(start + i * intervalMs);
    typedAt.push(performance.now());
    target.typeCharacter();
  }

  const giveUp = setTimeout(finish, DRAIN_TIMEOUT_MS);
  await drained;
  clearTimeout(giveUp);
  unsubscribe();

  return { renderMs, e2eMs, docBytes };
}
