/**
 * Phase 2 acceptance B34: the generated 5 MiB GFM document keeps
 * the Phase 1 behaviors for far headings: outline click, anchor links, the cursor block and sync
 * scroll. Far blocks are empty boxes until they are brought to life; expected values come from the
 * generated text itself (line numbers), not from the app. Run with WD_UI_PORT=1451.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Page, test } from '@playwright/test';
import { DOCS, expect, FIXTURES, launch, setSelection } from './support-b2';

const FILE = `${DOCS}/large5.md`;

type Doc = { text: string; lines: string[]; headings: { line: number; text: string }[] };

function largeDocument(): Doc {
  const text = readFileSync(join(FIXTURES, 'generated', 'large-5m.md'), 'utf8');
  const lines = text.split('\n');
  const headings: Doc['headings'] = [];
  let fenced = false;
  lines.forEach((source, index) => {
    if (source.startsWith('```')) fenced = !fenced;
    const match = /^(#{1,6}) (.+)$/.exec(source);
    if (!fenced && match) headings.push({ line: index, text: (match[2] as string).trim() });
  });
  return { text, lines, headings };
}

async function openLarge(page: Page, text: string, view: 'split' | 'preview' = 'split') {
  await page.setViewportSize({ width: 1280, height: 820 });
  await launch(page, { seed: { files: { [FILE]: text } }, open: FILE, view });
  await expect(page.getByTestId('document-name')).toHaveText('large5.md');
  await expect(page.getByTestId('outline-item').first()).toBeVisible({ timeout: 60_000 });
}

const settle = (page: Page, frames = 20) =>
  page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) await new Promise((r) => requestAnimationFrame(r));
  }, frames);

const headingOffset = (page: Page, line: number) =>
  page.evaluate((n) => {
    const scroller = document.querySelector('[data-testid="preview-scroll"]');
    const block = document.querySelector(`.wd-block[data-line="${n}"]`);
    if (!scroller || !block) return null;
    const heading = block.querySelector('h1, h2, h3, h4, h5, h6');
    if (!heading) return { offset: null, filled: false };
    return {
      offset: heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
      filled: !block.classList.contains('wd-far'),
    };
  }, line);

/**
 * One correction step for the pane the person scrolls (the leader). Far blocks and far lines are
 * estimates until they are drawn, so the leader's heading can drift after it first reached the top
 * (the follower then follows the drifted leader, which is correct). Returns true when the leader
 * holds the heading at its top within 2 px, else nudges it and returns false.
 */
const holdLeader = (page: Page, pane: 'editor' | 'preview', line: number) =>
  page.evaluate(
    ({ which, n }) => {
      let delta: number | null = null;
      if (which === 'editor') {
        const scroller = document.querySelector<HTMLElement>('.cm-scroller');
        const gutter = [...document.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].find(
          (element) => element.textContent === String(n + 1),
        );
        if (scroller && gutter) {
          delta = gutter.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
          if (Math.abs(delta) >= 2) scroller.scrollTop += delta;
        }
      } else {
        const scroller = document.querySelector<HTMLElement>('[data-testid="preview-scroll"]');
        const block = document.querySelector(`.wd-block[data-line="${n}"]`);
        if (scroller && block) {
          delta = block.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
          if (Math.abs(delta) >= 2) scroller.scrollTop += delta;
        }
      }
      return delta !== null && Math.abs(delta) < 2;
    },
    { which: pane, n: line },
  );

async function expectHeadingAtTop(page: Page, line: number, message: string, hold = false) {
  await expect
    .poll(
      async () => {
        if (hold && !(await holdLeader(page, 'editor', line))) return 999;
        const found = await headingOffset(page, line);
        return found && found.offset !== null && found.filled ? Math.abs(found.offset) : 999;
      },
      { message, timeout: 20_000 },
    )
    .toBeLessThanOrEqual(24);
}

const editorOffset = (page: Page, line: number) =>
  page.evaluate((n) => {
    const scroller = document.querySelector('.cm-scroller');
    const gutter = [...document.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].find(
      (element) => element.textContent === String(n + 1),
    );
    if (!scroller || !gutter) return null;
    return gutter.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  }, line);

async function scrollEditorTo(page: Page, line: number, total: number) {
  await page.evaluate(
    async ({ n, count }) => {
      const scroller = document.querySelector<HTMLElement>('.cm-scroller');
      if (!scroller) throw new Error('no editor');
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const numbers = () =>
        [...document.querySelectorAll('.cm-lineNumbers .cm-gutterElement')]
          .map((element) => ({ element, n: Number(element.textContent) }))
          .filter((entry) => entry.n > 0 && entry.element.getBoundingClientRect().height > 0);
      for (let i = 0; i < 80; i++) {
        const shown = numbers();
        const gutter = shown.find((entry) => entry.n === n + 1);
        if (gutter) {
          const delta =
            gutter.element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
          if (Math.abs(delta) < 2) return;
          scroller.scrollTop += delta;
        } else if (shown.length > 1) {
          const first = shown[0];
          const last = shown[shown.length - 1];
          if (!first || !last) continue;
          const perLine = scroller.clientHeight / Math.max(1, last.n - first.n);
          scroller.scrollTop += (n + 1 - first.n) * perLine;
        } else {
          scroller.scrollTop = (n / count) * scroller.scrollHeight;
        }
        await frame();
        await frame();
      }
      throw new Error(`could not scroll the editor to line ${n}`);
    },
    { n: line, count: total },
  );
}

test.describe('B34 a 5 MiB GFM document', () => {
  test.describe.configure({ timeout: 240_000 });

  test('B34 the document is the 5 MiB generated one and shows the large-document mode', async ({
    page,
  }) => {
    const doc = largeDocument();
    expect(Buffer.byteLength(doc.text)).toBeGreaterThanOrEqual(5 * 1024 * 1024 - 1024);
    expect(doc.headings.length).toBeGreaterThan(1000);
    await openLarge(page, doc.text);
    await expect(page.getByTestId('outline-item')).toHaveCount(doc.headings.length, {
      timeout: 60_000,
    });
    await expect(
      page.locator('.wd-preview.wd-preview-large, #preview.wd-preview-large'),
    ).toHaveCount(1);
  });

  test('B34 an outline click brings a far heading to the top of the preview, with its content', async ({
    page,
  }) => {
    const doc = largeDocument();
    await openLarge(page, doc.text);
    await expect(page.getByTestId('outline-item')).toHaveCount(doc.headings.length, {
      timeout: 60_000,
    });
    for (const share of [0.85, 0.4, 0.97]) {
      const index = Math.floor(doc.headings.length * share);
      const heading = doc.headings[index] as Doc['headings'][number];
      await page.getByTestId('outline-item').nth(index).click();
      await expectHeadingAtTop(page, heading.line, `outline item ${index}`);
      await expect(page.getByTestId('status-position')).toHaveText(`Ln ${heading.line + 1}, Col 1`);
      await settle(page);
      await expectHeadingAtTop(page, heading.line, `outline item ${index} after settling`);
    }
  });

  test('B34 an anchor link to a far heading brings it to the top, with its content', async ({
    page,
  }) => {
    const base = largeDocument();
    const lines = base.lines.slice();
    let at = Math.floor(lines.length * 0.75);
    while (lines[at] !== '' || lines[at - 1] === undefined) at++;
    lines.splice(at, 0, '', '## Far anchor target', '', 'The paragraph after the target.');
    const text = `[jump to the far target](#far-anchor-target)\n\n${lines.join('\n')}`;
    const target = text.split('\n').indexOf('## Far anchor target');
    expect(target).toBeGreaterThan(10_000);
    await openLarge(page, text, 'preview');
    const link = page.getByTestId('preview').getByRole('link', { name: 'jump to the far' });
    await expect(link).toBeVisible();
    await link.click();
    await expectHeadingAtTop(page, target, 'anchor link');
    await settle(page);
    await expectHeadingAtTop(page, target, 'anchor link after settling');
  });

  test('B34 the cursor block is marked after the caret jumps to a far line, and has content', async ({
    page,
  }) => {
    const doc = largeDocument();
    await openLarge(page, doc.text);
    await page.getByTestId('sync-scroll').click();
    // The caret jumps to a far heading (a line that sits inside a block, not on a blank line).
    const target = doc.headings[Math.floor(doc.headings.length * 0.93)] as Doc['headings'][number];
    const offset = doc.lines.slice(0, target.line).reduce((sum, l) => sum + l.length + 1, 0);
    await setSelection(page, offset);
    await expect(page.getByTestId('status-position')).toHaveText(`Ln ${target.line + 1}, Col 1`);
    const line = target.line;
    expect(line).toBeGreaterThan(doc.lines.length * 0.8);
    await expect
      .poll(
        async () =>
          page.evaluate((n) => {
            const marked = [...document.querySelectorAll('.wd-preview .is-cursor-block')];
            if (marked.length !== 1) return `marked ${marked.length}`;
            const block = marked[0] as HTMLElement;
            const from = Number(block.dataset.line);
            const to = Number(block.dataset.endLine);
            if (!(from <= n && n <= to)) return `wrong block ${from} to ${to} for line ${n}`;
            if (block.classList.contains('wd-far') || block.childElementCount === 0) return 'empty';
            return 'ok';
          }, line),
        { timeout: 20_000 },
      )
      .toBe('ok');
  });

  test('B34 sync scroll keeps a far heading at the top of the other pane, both ways', async ({
    page,
  }) => {
    const doc = largeDocument();
    const level2 = doc.headings.filter(({ line }) => /^## /.test(doc.lines[line] as string));
    await openLarge(page, doc.text);
    for (const share of [0.9, 0.6]) {
      const heading = level2[Math.floor(level2.length * share)] as Doc['headings'][number];
      await settle(page);
      await scrollEditorTo(page, heading.line, doc.lines.length);
      await expectHeadingAtTop(page, heading.line, `editor to preview at ${share}`, true);
    }
    for (const share of [0.3, 0.75]) {
      const heading = level2[Math.floor(level2.length * share)] as Doc['headings'][number];
      await settle(page);
      await page.evaluate(async (n) => {
        const scroller = document.querySelector<HTMLElement>(
          '[data-testid="preview-scroll"]',
        ) as HTMLElement;
        const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
        for (let i = 0; i < 60; i++) {
          const block = document.querySelector(`.wd-block[data-line="${n}"]`);
          if (!block) throw new Error(`no block at line ${n}`);
          const delta = block.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
          if (Math.abs(delta) < 2) return;
          scroller.scrollTop += delta;
          await frame();
        }
      }, heading.line);
      await expect
        .poll(
          async () => {
            if (!(await holdLeader(page, 'preview', heading.line))) return 999;
            return Math.abs((await editorOffset(page, heading.line)) ?? 999);
          },
          {
            message: `preview to editor at ${share}`,
            timeout: 20_000,
          },
        )
        .toBeLessThanOrEqual(24);
    }
  });
});
