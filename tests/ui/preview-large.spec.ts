/**
 * A large document in real WebKit (the generated 1 MiB document, 3,664 blocks): every block has a
 * wrapper in the page, but only the blocks near the viewport have content. The others are empty
 * boxes (`wd-far`) with a height, so the page has the height of the document without the cost of
 * laying out and holding some 100,000 nodes. This is what keeps a 5 MiB document within the memory
 * budget. Run with WD_UI_PORT=1433.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { editor, seedMock } from './helpers';

const root = new URL('../..', import.meta.url).pathname;
const DOCUMENT = '/tests/fixtures/generated/large-1m.md';

test.beforeAll(() => {
  execFileSync(process.execPath, ['scripts/gen-large-doc.mjs', '--size', '1m'], {
    cwd: root,
    stdio: 'pipe',
  });
});

async function open(page: Page) {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto('/tests/harness/preview.html');
  await page.waitForFunction(() => window.__harness !== undefined);
  await page.evaluate((url) => window.__harness.mount({ url }), DOCUMENT);
  await page.evaluate(() => window.__harness.settled());
  await frames(page);
}

/** Lets the observer report and the page paint. */
async function frames(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 80))),
      ),
  );
}

const scrollTo = (page: Page, top: number) =>
  page.evaluate((value) => {
    (document.getElementById('scroll') as HTMLElement).scrollTop = value;
  }, top);

/** The wrappers that are in view (their box meets the scroll area), with what they hold. */
function inView(page: Page) {
  return page.evaluate(() => {
    const scroll = document.getElementById('scroll') as HTMLElement;
    const box = scroll.getBoundingClientRect();
    return window.__harness
      .wrappers()
      .filter((wrapper) => {
        const rect = wrapper.getBoundingClientRect();
        return rect.bottom > box.top && rect.top < box.bottom;
      })
      .map((wrapper) => ({
        line: Number(wrapper.getAttribute('data-line')),
        far: wrapper.classList.contains('wd-far'),
        children: wrapper.childElementCount,
        text: (wrapper.textContent ?? '').trim().length,
      }));
  });
}

test('most blocks are empty boxes with a height, and the page has the height of a document', async ({
  page,
}) => {
  await open(page);
  const state = await page.evaluate(() => {
    const wrappers = window.__harness.wrappers();
    const far = wrappers.filter((wrapper) => wrapper.classList.contains('wd-far'));
    const scroll = document.getElementById('scroll') as HTMLElement;
    return {
      blocks: wrappers.length,
      far: far.length,
      farWithContent: far.filter((wrapper) => wrapper.childElementCount > 0).length,
      farWithoutHeight: far.filter((wrapper) => !/^\d+px$/.test(wrapper.style.height)).length,
      elements: document.getElementById('preview')?.getElementsByTagName('*').length ?? 0,
      scrollHeight: scroll.scrollHeight,
      viewport: scroll.clientHeight,
      large: document.getElementById('preview')?.classList.contains('wd-preview-large'),
    };
  });
  expect(state.large).toBe(true);
  expect(state.blocks).toBeGreaterThan(3000);
  expect(state.far).toBeGreaterThan(state.blocks * 0.9);
  // The blocks of the first screens that went far keep their content for a while: a few.
  expect(state.farWithContent).toBeLessThan(400);
  expect(state.farWithoutHeight).toBe(0);
  // Some 30,000 elements for the whole document, a few hundred for the part that is in the page.
  expect(state.elements).toBeLessThan(4000);
  expect(state.scrollHeight).toBeGreaterThan(state.viewport * 50);

  // What is in view has its content.
  const view = await inView(page);
  expect(view.length).toBeGreaterThan(5);
  expect(view.every((block) => !block.far && block.children > 0)).toBe(true);
});

test('scrolling to a far place shows its content, and keeps the page from going blank', async ({
  page,
}) => {
  await open(page);
  const height = await page.evaluate(
    () => (document.getElementById('scroll') as HTMLElement).scrollHeight,
  );
  for (const share of [0.5, 0.2, 0.9, 0.05]) {
    await scrollTo(page, height * share);
    await frames(page);
    const view = await inView(page);
    expect(view.length, `at ${share}`).toBeGreaterThan(3);
    expect(
      view.every((block) => !block.far && block.text > 0),
      `at ${share}`,
    ).toBe(true);
  }
});

test('what the reader looks at stays where it is while the blocks above it get their content', async ({
  page,
}) => {
  await open(page);
  const height = await page.evaluate(
    () => (document.getElementById('scroll') as HTMLElement).scrollHeight,
  );
  await scrollTo(page, height * 0.6);
  await frames(page);

  // A block in the middle of the view is the landmark. Scroll up in steps of 300 px: it must move
  // down by 300 px each time, however the heights of the blocks above it turn out.
  const landmark = () =>
    page.evaluate(() => {
      const scroll = document.getElementById('scroll') as HTMLElement;
      const box = scroll.getBoundingClientRect();
      const middle = box.top + box.height / 2;
      const wrapper = window.__harness.wrappers().find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.top <= middle && rect.bottom > middle;
      });
      return wrapper
        ? { line: wrapper.getAttribute('data-line'), top: wrapper.getBoundingClientRect().top }
        : null;
    });
  const first = await landmark();
  expect(first).not.toBeNull();
  const line = first?.line;
  let expected = (first?.top ?? 0) as number;
  for (let step = 0; step < 12; step++) {
    await page.evaluate(() => {
      (document.getElementById('scroll') as HTMLElement).scrollTop -= 300;
    });
    expected += 300;
    await frames(page);
    const now = await page.evaluate((target) => {
      const wrapper = window.__harness
        .wrappers()
        .find((w) => w.getAttribute('data-line') === target);
      return wrapper ? wrapper.getBoundingClientRect().top : null;
    }, line ?? '');
    expect(now, `step ${step}`).not.toBeNull();
    expect(Math.abs((now as number) - expected), `step ${step}`).toBeLessThan(6);
  }
});

test('a heading far away can be revealed and found', async ({ page }) => {
  await open(page);
  const found = await page.evaluate(() => {
    const headings = window.__harness.result?.headings ?? [];
    const heading = headings[Math.floor(headings.length * 0.8)];
    if (!heading) return null;
    const before = document.getElementById(heading.id);
    window.__harness.controller.revealHeading(heading.id);
    const after = document.getElementById(heading.id);
    const block = after?.closest('.wd-block');
    return {
      before: before !== null,
      after: after !== null,
      shown: block ? !block.classList.contains('wd-far') : false,
      hasHeightOfContent: (after?.getBoundingClientRect().height ?? 0) > 0,
    };
  });
  expect(found).toEqual({ before: false, after: true, shown: true, hasHeightOfContent: true });
});

test('the page stays small after scrolling through a lot of the document', async ({ page }) => {
  await open(page);
  const height = await page.evaluate(
    () => (document.getElementById('scroll') as HTMLElement).scrollHeight,
  );
  for (let share = 0; share <= 1; share += 0.05) {
    await scrollTo(page, height * share);
    await frames(page);
  }
  const elements = await page.evaluate(
    () => document.getElementById('preview')?.getElementsByTagName('*').length ?? 0,
  );
  // The blocks that were visited keep their content for a while, but only a few hundred of them.
  expect(elements).toBeLessThan(25_000);
});

test('an edit in the middle replaces one block and the document stays windowed', async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const harness = window.__harness;
    const before = harness.wrappers();
    const lines = harness.text.split('\n');
    let index = Math.floor(lines.length / 2);
    while (index < lines.length && !/^[A-Z]/.test(lines[index] ?? '')) index++;
    lines[index] = `${lines[index]} edited`;
    harness.setText(lines.join('\n'));
    await harness.settled();
    const after = harness.wrappers();
    return {
      replaced: before.filter((wrapper) => !after.includes(wrapper)).length,
      far: after.filter((wrapper) => wrapper.classList.contains('wd-far')).length,
      blocks: after.length,
    };
  });
  expect(result.replaced).toBe(1);
  expect(result.far).toBeGreaterThan(result.blocks * 0.9);
});

// ---- the navigation of the main window on a large document (WP2.0) ----------------------------
// Far blocks are empty boxes with an estimated height, so the outline, anchor links, the cursor
// block and sync scroll have to bring the target to life before they measure it. Expected values
// come from the generated text itself (line numbers), not from the app.

const SHELL_HOME = '/Users/mock';
const SHELL_FILE = `${SHELL_HOME}/large.md`;
const FRONTMATTER = '---\ntitle: Large\ntags: [a, b]\n---\n\n';

type Doc = { text: string; lines: string[]; headings: { line: number; text: string }[] };

/** The generated 1 MiB document with optional text before it; headings found outside fences. */
function largeDocument(prefix = ''): Doc {
  const text = prefix + readFileSync(`${root}tests/fixtures/generated/large-1m.md`, 'utf8');
  const lines = text.split('\n');
  const headings: Doc['headings'] = [];
  let fenced = false;
  let front = lines[0] === '---';
  lines.forEach((source, index) => {
    if (front) {
      if (index > 0 && source === '---') front = false;
      return;
    }
    if (source.startsWith('```')) fenced = !fenced;
    const match = /^(#{1,6}) (.+)$/.exec(source);
    if (!fenced && match) headings.push({ line: index, text: (match[2] as string).trim() });
  });
  return { text, lines, headings };
}

async function openShell(
  page: Page,
  text: string,
  view: 'editor' | 'split' | 'preview' = 'split',
): Promise<void> {
  await seedMock(page, { files: { [SHELL_FILE]: text }, launch: { openPath: SHELL_FILE, view } });
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');
  await expect(page.getByTestId('document-name')).toHaveText('large.md');
  await expect(page.getByTestId('outline-item').first()).toBeVisible();
}

const settle = (page: Page, frames = 20) =>
  page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) await new Promise((r) => requestAnimationFrame(r));
  }, frames);

/** Offset of a block's first heading (or the block) below the preview top; null if not found. */
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

async function expectHeadingAtTop(page: Page, line: number, message: string) {
  await expect
    .poll(
      async () => {
        const found = await headingOffset(page, line);
        return found && found.offset !== null && found.filled ? Math.abs(found.offset) : 999;
      },
      { message, timeout: 10_000 },
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

/** Scrolls the editor, as a person would, until the line is at its top edge. */
async function scrollEditorTo(page: Page, line: number, total: number) {
  await page.evaluate(
    async ({ n, count }) => {
      const scroller = document.querySelector<HTMLElement>('.cm-scroller');
      if (!scroller) throw new Error('no editor');
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const numbers = () =>
        [...document.querySelectorAll('.cm-lineNumbers .cm-gutterElement')]
          .map((element) => ({ element, n: Number(element.textContent) }))
          // The first gutter element is a hidden spacer as wide as the largest number.
          .filter((entry) => entry.n > 0 && entry.element.getBoundingClientRect().height > 0);
      for (let i = 0; i < 60; i++) {
        const shown = numbers();
        const gutter = shown.find((entry) => entry.n === n + 1);
        if (gutter) {
          const delta =
            gutter.element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
          if (Math.abs(delta) < 2) return;
          scroller.scrollTop += delta;
        } else if (shown.length > 1) {
          // The line is not drawn: move by the number of lines still to go, at the pixels per
          // line of what is drawn.
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

test.describe('navigation on a large document', () => {
  test.describe.configure({ timeout: 180_000 });

  test('3a the outline click brings a far heading to the top of the preview, with its content', async ({
    page,
  }) => {
    const doc = largeDocument();
    expect(doc.headings.length).toBeGreaterThan(200);
    await openShell(page, doc.text);
    await expect(page.getByTestId('outline-item')).toHaveCount(doc.headings.length);
    for (const share of [0.85, 0.4, 0.97]) {
      const index = Math.floor(doc.headings.length * share);
      const heading = doc.headings[index] as Doc['headings'][number];
      await page.getByTestId('outline-item').nth(index).click();
      await expectHeadingAtTop(page, heading.line, `outline item ${index}`);
      await expect(page.getByTestId('status-position')).toHaveText(`Ln ${heading.line + 1}, Col 1`);
      await settle(page);
      // It stays there once the blocks around it have been drawn.
      await expectHeadingAtTop(page, heading.line, `outline item ${index} after settling`);
    }
  });

  test('3b an anchor link to a far heading brings it to the top, with its content', async ({
    page,
  }) => {
    const base = largeDocument();
    const lines = base.lines.slice();
    // A unique heading three quarters of the way down, at the start of a block.
    let at = Math.floor(lines.length * 0.75);
    while (lines[at] !== '' || lines[at - 1] === undefined) at++;
    lines.splice(at, 0, '', '## Far anchor target', '', 'The paragraph after the target.');
    const text = `[jump to the far target](#far-anchor-target)\n\n${lines.join('\n')}`;
    const target = text.split('\n').indexOf('## Far anchor target');
    expect(target).toBeGreaterThan(1000);
    await openShell(page, text, 'preview');
    await expect(
      page.getByTestId('preview').getByRole('link', { name: 'jump to the far' }),
    ).toBeVisible();
    await page.getByTestId('preview').getByRole('link', { name: 'jump to the far' }).click();
    await expectHeadingAtTop(page, target, 'anchor link');
    await settle(page);
    await expectHeadingAtTop(page, target, 'anchor link after settling');
  });

  test('3c the cursor block is marked after the caret jumps to a far line, and has content', async ({
    page,
  }) => {
    const doc = largeDocument();
    await openShell(page, doc.text);
    // Sync scroll off: the preview stays at the top, so the marked block is a far one.
    await page.getByTestId('sync-scroll').click();
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowUp');
    const position = await page.getByTestId('status-position').innerText();
    const line = Number(/Ln (\d+)/.exec(position)?.[1]) - 1;
    expect(line).toBeGreaterThan(doc.lines.length - 100);
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
        { timeout: 10_000 },
      )
      .toBe('ok');
  });

  test('3d sync scroll keeps a far heading at the top of the other pane, both ways', async ({
    page,
  }) => {
    const doc = largeDocument();
    // Level two headings only: they are not at the very top or end of the document.
    const level2 = doc.headings.filter(({ line }) => /^## /.test(doc.lines[line] as string));
    await openShell(page, doc.text);
    for (const share of [0.9, 0.6]) {
      const heading = level2[Math.floor(level2.length * share)] as Doc['headings'][number];
      await settle(page);
      await scrollEditorTo(page, heading.line, doc.lines.length);
      await expectHeadingAtTop(page, heading.line, `editor to preview at ${share}`);
    }
    for (const share of [0.3, 0.75]) {
      const heading = level2[Math.floor(level2.length * share)] as Doc['headings'][number];
      await settle(page);
      await page.evaluate(async (n) => {
        const scroller = document.querySelector<HTMLElement>(
          '[data-testid="preview-scroll"]',
        ) as HTMLElement;
        const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
        for (let i = 0; i < 40; i++) {
          const block = document.querySelector(`.wd-block[data-line="${n}"]`);
          if (!block) throw new Error(`no block at line ${n}`);
          const delta = block.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
          if (Math.abs(delta) < 2) return;
          scroller.scrollTop += delta;
          await frame();
        }
      }, heading.line);
      await expect
        .poll(async () => Math.abs((await editorOffset(page, heading.line)) ?? 999), {
          message: `preview to editor at ${share}`,
          timeout: 10_000,
        })
        .toBeLessThanOrEqual(24);
    }
  });

  test('3e the frontmatter block never shows the cursor highlight, far or near', async ({
    page,
  }) => {
    const doc = largeDocument(FRONTMATTER);
    await openShell(page, doc.text);
    await expect(page.locator('.wd-preview .wd-block:has(> header.wd-frontmatter)')).toHaveCount(1);
    await page.getByTestId('sync-scroll').click();
    await editor(page).click();
    // Caret in the frontmatter, preview at the top: the block is near.
    await page.keyboard.press('ControlOrMeta+Home');
    const look = () =>
      page.evaluate(() => {
        const block = document.querySelector('.wd-preview .wd-block[data-line="0"]');
        if (!block) return null;
        const style = window.getComputedStyle(block);
        return {
          marked: block.classList.contains('is-cursor-block'),
          bg: style.backgroundColor,
          shadow: style.boxShadow,
        };
      });
    await expect.poll(look).toEqual({ marked: true, bg: 'rgba(0, 0, 0, 0)', shadow: 'none' });
    // Scroll the preview far away, then move the caret into the frontmatter again: the block is
    // an empty box now (or has been emptied), and still shows nothing.
    await page.evaluate(() => {
      const scroller = document.querySelector('[data-testid="preview-scroll"]') as HTMLElement;
      scroller.scrollTop = scroller.scrollHeight * 0.6;
    });
    await settle(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await settle(page);
    const far = await look();
    expect(far?.bg).toBe('rgba(0, 0, 0, 0)');
    expect(far?.shadow).toBe('none');
  });
});
