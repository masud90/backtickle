/**
 * Large documents in real WebKit: the generated 1 MiB and 5 MiB documents (scripts/gen-large-doc.mjs)
 * are rendered by the block preview. After one edit in the middle only the changed block's element
 * may be replaced. The timings are printed (and attached to the test report) to be compared with
 * the Phase 0 baseline: Phase 0 needed about 0.75 s per update of a 5 MiB document, 0.4 s of it in
 * DOMPurify; with the window cache an update parses one window of the source (about 128 KiB).
 * Run with WD_UI_PORT=1433.
 */
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

const root = new URL('../..', import.meta.url).pathname;

for (const size of ['1m', '5m'] as const) {
  test(`${size}: first slice, full render, and an update that replaces one block`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    execFileSync(process.execPath, ['scripts/gen-large-doc.mjs', '--size', size], {
      cwd: root,
      stdio: 'pipe',
    });
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.goto('/tests/harness/preview.html');
    await page.waitForFunction(() => window.__harness !== undefined);

    const timings = await page.evaluate(
      (url) => window.__harness.perf(url),
      `/tests/fixtures/generated/large-${size}.md`,
    );
    const rounded = Object.fromEntries(
      Object.entries(timings).map(([key, value]) => [
        key,
        typeof value === 'number' ? Math.round(value * 10) / 10 : value,
      ]),
    );
    console.log(`PERF ${size} ${JSON.stringify(rounded)}`);
    await info.attach(`timings-${size}`, {
      body: JSON.stringify(rounded, null, 2),
      contentType: 'application/json',
    });

    expect(timings.blocks).toBeGreaterThan(size === '5m' ? 5000 : 1000);
    // Identity of every other block element is kept: exactly one block was replaced.
    expect(timings.replacedBlocks).toBe(1);
    expect(timings.keptBlocks).toBe(timings.blocks - 1);
    // The first screens are never later than the complete document. (Only the blocks near the
    // viewport have content, so the rest of a large document is in the page almost at once.)
    expect(timings.firstSliceMs).toBeLessThanOrEqual(timings.fullMs);
    // An update is a small fraction of the first render.
    expect(timings.updateMs).toBeLessThan(timings.fullMs / 2);
  });
}
