// @vitest-environment jsdom
/** PreviewController with a pipeline: keyed patching, slices, cursor block, hidden analysis. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANALYZE_INTERVAL_MS,
  copyCode,
  PREVIEW_DEBOUNCE_MS,
  PreviewController,
  type RenderInfo,
} from '@/preview/controller';
import { planPatch } from '@/preview/keyed-patch';
import { createCommonMarkPipeline } from '@/preview/packs/commonmark';
import { createGfmPipeline } from '@/preview/packs/gfm';
import type { Analysis } from '@/preview/types';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(source: string, options: { visible?: boolean; now?: () => number } = {}) {
  const container = document.createElement('article');
  document.body.append(container);
  let text = source;
  const reports: RenderInfo[] = [];
  const analyses: Analysis[] = [];
  const pipeline = createGfmPipeline();
  const controller = new PreviewController({
    container,
    getSource: () => text,
    pipeline,
    onRendered: (info) => reports.push(info),
    onAnalyzed: (analysis) => analyses.push(analysis),
    now: options.now,
  });
  if (options.visible === false) controller.setVisible(false);
  return {
    container,
    controller,
    pipeline,
    reports,
    analyses,
    set: (next: string) => {
      text = next;
    },
    blocks: () => Array.from(container.children) as HTMLElement[],
  };
}

function paragraphs(count: number): string {
  return Array.from({ length: count }, (_, i) => `paragraph number ${i}`).join('\n\n');
}

describe('planPatch', () => {
  const keys = (...list: string[]) => list.map((key) => ({ key }));

  it('finds the common prefix and suffix', () => {
    expect(planPatch(keys('a', 'b', 'c', 'd'), keys('a', 'x', 'c', 'd'))).toEqual({
      prefix: 1,
      suffix: 2,
    });
    expect(planPatch(keys('a', 'b'), keys('a', 'b'))).toEqual({ prefix: 2, suffix: 0 });
    expect(planPatch(keys(), keys('a'))).toEqual({ prefix: 0, suffix: 0 });
    expect(planPatch(keys('a', 'b', 'c'), keys('x', 'y', 'z'))).toEqual({ prefix: 0, suffix: 0 });
  });

  it('never lets prefix and suffix overlap', () => {
    expect(planPatch(keys('a', 'a', 'a'), keys('a', 'a'))).toEqual({ prefix: 2, suffix: 0 });
    expect(planPatch(keys('a', 'b', 'a'), keys('a', 'a'))).toEqual({ prefix: 1, suffix: 1 });
  });

  it('an inserted block is a middle of one, a deleted block a middle of none', () => {
    expect(planPatch(keys('a', 'c'), keys('a', 'b', 'c'))).toEqual({ prefix: 1, suffix: 1 });
    expect(planPatch(keys('a', 'b', 'c'), keys('a', 'c'))).toEqual({ prefix: 1, suffix: 1 });
  });
});

describe('rendering blocks', () => {
  it('fills the container with wrappers, adds the wd-preview class and reports the result', () => {
    const t = setup('# One\n\ntext\n');
    t.controller.renderNow();
    expect(t.container.classList.contains('wd-preview')).toBe(true);
    expect(t.blocks().map((el) => el.className)).toEqual(['wd-block', 'wd-block']);
    expect(t.reports).toHaveLength(1);
    expect(t.reports[0]).toMatchObject({ first: true, complete: true });
    expect(t.reports[0]?.result?.headings[0]?.text).toBe('One');
    expect(t.reports[0]?.renderMs).toBeGreaterThanOrEqual(0);
  });

  it('replaces only the block that changed', () => {
    const t = setup('# One\n\nfirst\n\nsecond\n\nlast\n');
    t.controller.renderNow();
    const before = t.blocks();
    t.set('# One\n\nfirst\n\nsecond, edited\n\nlast\n');
    t.controller.renderNow();
    const after = t.blocks();
    expect(after.map((el, i) => el === before[i])).toEqual([true, true, false, true]);
    expect(after[2]?.textContent).toContain('second, edited');
    expect(t.reports.map((r) => r.first)).toEqual([true, false]);
  });

  it('inserts and removes blocks in the middle and keeps the others', () => {
    const t = setup('a\n\nb\n\nc\n');
    t.controller.renderNow();
    const [a, b, c] = t.blocks();
    t.set('a\n\nnew\n\nb\n\nc\n');
    t.controller.renderNow();
    expect(t.blocks()[0]).toBe(a);
    expect(t.blocks()[2]).toBe(b);
    expect(t.blocks()[3]).toBe(c);
    t.set('a\n\nc\n');
    t.controller.renderNow();
    expect(t.blocks()).toEqual([a, c]);
  });

  it('updates data-line of kept blocks in place when lines are added above', () => {
    const t = setup('x\n\n- a\n- b\n\n| h |\n| - |\n| r |\n');
    t.controller.renderNow();
    const list = t.blocks()[1] as HTMLElement;
    const item = list.querySelector('li:nth-child(2)') as HTMLElement;
    expect(item.getAttribute('data-line')).toBe('3');
    t.set('new\n\nx\n\n- a\n- b\n\n| h |\n| - |\n| r |\n');
    t.controller.renderNow();
    expect(t.blocks()[2]).toBe(list);
    expect(list.getAttribute('data-line')).toBe('4');
    expect(list.getAttribute('data-end-line')).toBe('5');
    expect(item.getAttribute('data-line')).toBe('5');
    const row = t.container.querySelector('tbody tr') as HTMLElement;
    expect(row.getAttribute('data-line')).toBe('9');
  });

  it('shows another document completely (nothing in common)', () => {
    const t = setup('one\n\ntwo\n');
    t.controller.renderNow();
    t.set('three\n');
    t.controller.renderNow();
    expect(t.container.textContent?.trim()).toBe('three');
  });

  it('an empty document empties the preview', () => {
    const t = setup('text\n');
    t.controller.renderNow();
    t.set('');
    t.controller.renderNow();
    expect(t.container.children).toHaveLength(0);
  });

  it('removes what the first preview left in the container when a pipeline is set', () => {
    const container = document.createElement('article');
    container.innerHTML = '<p>old</p>';
    const controller = new PreviewController({
      container,
      getSource: () => 'new\n',
      pipeline: createGfmPipeline(),
    });
    controller.renderNow();
    expect(container.textContent?.trim()).toBe('new');
  });

  it('switching the pipeline renders again: CommonMark shows a table as text', () => {
    const t = setup('| a |\n| - |\n| 1 |\n\nkept\n');
    t.controller.renderNow();
    expect(t.container.querySelector('table')).not.toBeNull();
    const kept = t.blocks()[1];
    t.controller.setPipeline(createCommonMarkPipeline());
    expect(t.container.querySelector('table')).toBeNull();
    expect(t.container.textContent).toContain('| a |');
    expect(t.blocks()[1]).toBe(kept);
  });
});

describe('large documents appear in slices', () => {
  it('shows the first screens at once and the rest in slices, then reports complete', () => {
    const t = setup(paragraphs(600));
    t.controller.renderNow();
    expect(t.reports).toHaveLength(1);
    expect(t.reports[0]).toMatchObject({ first: true, complete: false });
    const first = t.blocks().length;
    expect(first).toBeGreaterThan(20);
    expect(first).toBeLessThan(600);
    expect(t.controller.isAddingBlocks).toBe(true);

    vi.advanceTimersByTime(5000);
    expect(t.blocks()).toHaveLength(600);
    expect(t.controller.isAddingBlocks).toBe(false);
    expect(t.reports.at(-1)).toMatchObject({ first: false, complete: true });
    expect(t.reports.filter((r) => r.complete)).toHaveLength(1);
    expect(t.blocks().map((el) => el.getAttribute('data-line'))).toEqual(
      Array.from({ length: 600 }, (_, i) => String(i * 2)),
    );
  });

  it('completeNow adds everything that is waiting', () => {
    const t = setup(paragraphs(300));
    t.controller.renderNow();
    expect(t.blocks().length).toBeLessThan(300);
    t.controller.completeNow();
    expect(t.blocks()).toHaveLength(300);
    expect(t.reports.at(-1)?.complete).toBe(true);
  });

  it('an edit while slices are pending cancels them and continues with the new text', () => {
    const t = setup(paragraphs(300));
    t.controller.renderNow();
    t.set(`${paragraphs(300)}\n\nthe end\n`);
    t.controller.renderNow();
    vi.advanceTimersByTime(5000);
    expect(t.blocks()).toHaveLength(301);
    expect(t.blocks().at(-1)?.textContent).toContain('the end');
    expect(t.reports.filter((r) => r.complete)).toHaveLength(1);
  });

  it('whenSettled resolves after the last slice', async () => {
    vi.useRealTimers();
    const t = setup(paragraphs(300));
    t.controller.renderNow();
    await t.controller.whenSettled();
    expect(t.blocks()).toHaveLength(300);
  });

  it('hiding the preview stops the slices; showing it adds the rest', () => {
    const t = setup(paragraphs(300));
    t.controller.renderNow();
    t.controller.setVisible(false);
    vi.advanceTimersByTime(5000);
    expect(t.blocks().length).toBeLessThan(300);
    t.controller.setVisible(true);
    vi.advanceTimersByTime(5000);
    expect(t.blocks()).toHaveLength(300);
  });
});

describe('the block under the cursor', () => {
  it('marks the block that contains the line, none between blocks, and follows re-renders', () => {
    const t = setup('# T\n\npara\nmore\n\nlast\n');
    t.controller.renderNow();
    const marked = () =>
      Array.from(t.container.querySelectorAll('.is-cursor-block')).map((el) =>
        el.getAttribute('data-line'),
      );
    t.controller.highlightLine(3);
    expect(marked()).toEqual(['2']);
    t.controller.highlightLine(4);
    expect(marked()).toEqual([]);
    t.controller.highlightLine(5);
    expect(marked()).toEqual(['5']);
    t.set('# T\n\npara\nmore\n\nlast, edited\n');
    t.controller.renderNow();
    expect(marked()).toEqual(['5']);
    t.controller.highlightLine(null);
    expect(marked()).toEqual([]);
  });

  it('finds the footnote block by the lines of the definitions', () => {
    const t = setup('a[^1]\n\n[^1]: note\n\nlast\n');
    t.controller.renderNow();
    t.controller.highlightLine(2);
    const marked = t.container.querySelector('.is-cursor-block');
    expect(marked?.querySelector('section.footnotes')).not.toBeNull();
    t.controller.highlightLine(4);
    expect(t.container.querySelector('.is-cursor-block')?.textContent?.trim()).toBe('last');
  });
});

describe('hidden preview', () => {
  it('does not render, and analyzes instead, not more often than every 500 ms', () => {
    let clock = 0;
    const t = setup('# One\n\nwords here\n', { visible: false, now: () => clock });
    t.controller.renderNow();
    expect(t.container.children).toHaveLength(0);
    expect(t.analyses).toHaveLength(1);
    expect(t.analyses[0]?.stats.words).toBe(3);

    t.set('# One\n\nmore words here now\n');
    t.controller.schedule();
    t.controller.schedule();
    clock = 200;
    vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
    expect(t.analyses).toHaveLength(1); // 500 ms have not passed since the last analysis
    clock = ANALYZE_INTERVAL_MS + 10;
    vi.advanceTimersByTime(ANALYZE_INTERVAL_MS);
    expect(t.analyses).toHaveLength(2);
    expect(t.analyses[1]?.stats.words).toBe(5);
  });

  it('shows the latest text when visible again, without analyzing', () => {
    const t = setup('a\n', { visible: false });
    t.set('b\n');
    t.controller.schedule();
    t.controller.setVisible(true);
    expect(t.container.textContent?.trim()).toBe('b');
  });
});

describe('the pause before a render', () => {
  /** A controller whose renders cost what `cost.ms` says, on a clock that the test moves. */
  function timed() {
    const state = { clock: 0, cost: 10 };
    const container = document.createElement('article');
    let text = 'a\n';
    const pipeline = createGfmPipeline();
    const render = pipeline.render.bind(pipeline);
    pipeline.render = (source) => {
      state.clock += state.cost; // pretend the render takes this long
      return render(source);
    };
    const controller = new PreviewController({
      container,
      getSource: () => text,
      pipeline,
      now: () => state.clock,
    });
    const spy = vi.spyOn(pipeline, 'render');
    const edit = () => {
      text = `${text}x`;
      controller.schedule();
    };
    /** Time passes: the clock and the timers move together. */
    const wait = (ms: number) => {
      state.clock += ms;
      vi.advanceTimersByTime(ms);
    };
    /** The number of milliseconds after a change until the render starts. */
    const pause = () => {
      const before = spy.mock.calls.length;
      edit();
      for (let ms = 0; ms <= 1000; ms++) {
        if (spy.mock.calls.length > before) return ms;
        wait(1);
      }
      return Number.POSITIVE_INFINITY;
    };
    return { state, controller, pause, edit, wait, spy };
  }

  it('is 120 ms whatever the renders cost', () => {
    const t = timed();
    t.controller.renderNow();
    for (const cost of [10, 400, 5000, 5]) {
      t.state.cost = cost;
      expect(t.pause()).toBe(PREVIEW_DEBOUNCE_MS);
    }
  });

  it('starts a render 500 ms after the first change at the latest, however steady the typing', () => {
    const t = timed();
    t.controller.renderNow();
    t.state.cost = 10;
    const before = t.spy.mock.calls.length;
    // A keystroke every 100 ms: the 120 ms pause never ends, until the 500 ms are over.
    t.edit(); // at 0
    for (let i = 1; i <= 4; i++) {
      t.wait(100);
      expect(t.spy.mock.calls.length).toBe(before);
      t.edit(); // at 100, 200, 300, 400
    }
    t.wait(99); // 499 ms after the first change
    expect(t.spy.mock.calls.length).toBe(before);
    t.wait(1);
    expect(t.spy.mock.calls.length).toBe(before + 1);
    // The next change starts a new count.
    t.edit();
    t.wait(100);
    t.edit();
    expect(t.spy.mock.calls.length).toBe(before + 1);
  });

  it('stays at the fixed value when one is given', () => {
    const container = document.createElement('article');
    const pipeline = createGfmPipeline();
    const spy = vi.spyOn(pipeline, 'render');
    const controller = new PreviewController({
      container,
      getSource: () => 'a',
      pipeline,
      debounceMs: 30,
    });
    controller.schedule();
    vi.advanceTimersByTime(30);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('focus', () => {
  it('a task box that is replaced while it has the focus passes the focus to its successor', () => {
    const t = setup('- [ ] one\n- [ ] two\n');
    t.controller.renderNow();
    const box = t.container.querySelectorAll<HTMLElement>('.task-checkbox')[1] as HTMLElement;
    box.focus();
    expect(document.activeElement).toBe(box);
    t.set('- [ ] one\n- [x] two\n');
    t.controller.renderNow();
    const next = t.container.querySelectorAll<HTMLElement>('.task-checkbox')[1];
    expect(next).not.toBe(box);
    expect(document.activeElement).toBe(next);
  });
});

describe('the Copy button', () => {
  it('copies the text of the card and shows Copied, then Copy again after 1.5 s', async () => {
    const writes: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text: string) => writes.push(text) },
      configurable: true,
    });
    const t = setup('```js\nconst a = 1;\n```\n');
    t.controller.renderNow();
    const button = t.container.querySelector('.code-copy') as HTMLElement;
    expect(button.textContent).toBe('Copy');
    await copyCode(button);
    expect(writes).toEqual(['const a = 1;\n']);
    expect(button.textContent).toBe('Copied');
    vi.advanceTimersByTime(1499);
    expect(button.textContent).toBe('Copied');
    vi.advanceTimersByTime(2);
    expect(button.textContent).toBe('Copy');
  });

  it('clicking the button in the container copies (handled by the controller)', async () => {
    const writes: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text: string) => writes.push(text) },
      configurable: true,
    });
    const t = setup('```\nplain\n```\n');
    t.controller.renderNow();
    (t.container.querySelector('.code-copy .code-copy-label') as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toEqual(['plain\n']);
  });
});
