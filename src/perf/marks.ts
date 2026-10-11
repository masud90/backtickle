/**
 * Timing helpers for the measurement harness (see `WRITEDOWN_PERF` in src-tauri/src/perf.rs).
 *
 * "Painted" means two animation frames later: the first frame runs the update, the second one
 * starts after the first was drawn.
 */

/** If no frame arrives (window hidden or occluded), carry on anyway after this long. */
const FRAME_TIMEOUT_MS = 1000;

/**
 * Resolves with `performance.now()` at the start of the second animation frame from now, which
 * is when changes made right now have been drawn.
 */
export function afterNextPaint(): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      resolve(performance.now());
    };
    // A hidden page gets no animation frames. Do not wait for them forever.
    const fallback = setTimeout(finish, FRAME_TIMEOUT_MS);
    requestAnimationFrame(() => requestAnimationFrame(finish));
  });
}

/** Resolves when fonts have loaded and one more frame was drawn: the window is at rest. */
export async function whenSettled(): Promise<void> {
  try {
    await document.fonts.ready;
  } catch {
    // No font loading API: nothing to wait for.
  }
  await afterNextPaint();
}
