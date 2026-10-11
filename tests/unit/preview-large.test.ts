// @vitest-environment jsdom
/**
 * Large documents (1,500 blocks and more): every block is in the page, but only the blocks near
 * the viewport show their content. The others are empty boxes (`wd-far`) with a height, and come
 * to life when the IntersectionObserver says they are near. jsdom has no layout and no observer:
 * both are made up here (a fake observer that the tests drive, and heights that they decide).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LARGE_DOCUMENT_BLOCKS, PreviewController, type RenderInfo } from '@/preview/controller';
import { createGfmPipeline } from '@/preview/packs/gfm';

class FakeObserver {
  static all: FakeObserver[] = [];
  readonly observed = new Set<Element>();
  disconnected = false;
  readonly callback: (entries: IntersectionObserverEntry[]) => void;
  readonly options: IntersectionObserverInit;
  constructor(
    callback: (entries: IntersectionObserverEntry[]) => void,
    options: IntersectionObserverInit,
  ) {
    this.callback = callback;
    this.options = options;
    FakeObserver.all.push(this);
  }
  observe(element: Element): void {
    this.observed.add(element);
  }
  unobserve(element: Element): void {
    this.observed.delete(element);
  }
  disconnect(): void {
    this.observed.clear();
    this.disconnected = true;
  }
  /** What the browser tells: these elements are near (or not). `above`: they start above the top. */
  report(items: Array<{ element: Element; near: boolean; above?: boolean }>): void {
    for (const { element, above } of items) {
      if (above) aboveTheTop.add(element);
      else aboveTheTop.delete(element);
    }
    this.callback(
      items.map(
        ({ element, near }) =>
          ({ target: element, isIntersecting: near }) as unknown as IntersectionObserverEntry,
      ),
    );
  }
}

/** The elements whose box starts above the top of the scroll area, for the fake layout. */
const aboveTheTop = new WeakSet<Element>();

/** The height that every block shows when its content is laid out, unless the test says. */
let heightOf: (element: HTMLElement) => number = () => 40;
const realRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');

beforeEach(() => {
  vi.useFakeTimers();
  FakeObserver.all = [];
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeObserver;
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: HTMLElement) {
      const height = this.classList.contains('wd-far')
        ? Number.parseFloat(this.style.height) || 0
        : heightOf(this);
      const top = aboveTheTop.has(this) ? -500 : 100;
      return { height, top, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: 0 };
    },
  });
  heightOf = () => 40;
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
  if (realRect) {
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', realRect);
  }
});

function paragraphs(count: number, extra: Record<number, string> = {}): string {
  return Array.from({ length: count }, (_, i) => extra[i] ?? `paragraph number ${i}`).join('\n\n');
}

function setup(source: string) {
  const scroller = document.createElement('div');
  scroller.style.overflowY = 'auto';
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 700 });
  const container = document.createElement('article');
  scroller.append(container);
  document.body.append(scroller);
  let text = source;
  const reports: RenderInfo[] = [];
  const controller = new PreviewController({
    container,
    getSource: () => text,
    pipeline: createGfmPipeline(),
    onRendered: (info) => reports.push(info),
  });
  controller.renderNow();
  controller.completeNow();
  const blocks = () => Array.from(container.children) as HTMLElement[];
  return {
    scroller,
    container,
    controller,
    reports,
    blocks,
    observer: () => FakeObserver.all.at(-1) as FakeObserver,
    set: (next: string) => {
      text = next;
    },
    far: () => blocks().filter((block) => block.classList.contains('wd-far')),
  };
}

const COUNT = LARGE_DOCUMENT_BLOCKS + 100;

describe('a large document', () => {
  it('has a wrapper for every block, the first screens with their content and the rest empty with a height', () => {
    const t = setup(paragraphs(COUNT));
    expect(t.container.classList.contains('wd-preview-large')).toBe(true);
    const blocks = t.blocks();
    expect(blocks).toHaveLength(COUNT);
    // Every wrapper has its attributes, also the empty ones.
    expect(blocks.map((b) => b.getAttribute('data-line')).slice(0, 3)).toEqual(['0', '2', '4']);
    const last = blocks.at(-1) as HTMLElement;
    expect(last.getAttribute('data-line')).toBe(String((COUNT - 1) * 2));
    expect(last.getAttribute('data-end-line')).toBe(String((COUNT - 1) * 2));
    expect(last.getAttribute('data-key')).toMatch(/\w+/);
    const near = blocks.filter((b) => !b.classList.contains('wd-far'));
    expect(near.length).toBeGreaterThan(20);
    expect(near.length).toBeLessThan(400);
    expect(blocks.slice(0, near.length).every((b) => !b.classList.contains('wd-far'))).toBe(true);
    for (const block of t.far()) {
      expect(block.style.height).toMatch(/^\d+px$/);
      expect(block.childElementCount).toBe(0);
    }
    for (const block of near) expect(block.childElementCount).toBeGreaterThan(0);
    // Every block is observed, and the margin is a share of the viewport.
    expect(t.observer().observed.size).toBe(COUNT);
    expect(t.observer().options.rootMargin).toBe('150% 0px');
    expect(t.observer().options.root).toBe(t.scroller);
  });

  it('estimates the height of a far block from the blocks that were seen', () => {
    heightOf = () => 60; // a paragraph of one line takes 60 px here
    const t = setup(paragraphs(COUNT));
    // One block spans two lines (itself and the blank line after it): 30 px a line.
    const heights = t.far().map((b) => parseFloat(b.style.height));
    expect(new Set(heights).size).toBe(1);
    expect(heights[0]).toBe(60);
  });

  it('makes the content of a block that comes near, and hides it again at the height it had', () => {
    const t = setup(paragraphs(COUNT));
    const target = t.blocks()[1000] as HTMLElement;
    expect(target.classList.contains('wd-far')).toBe(true);
    expect(target.childElementCount).toBe(0);
    heightOf = () => 90;
    t.observer().report([{ element: target, near: true }]);
    expect(target.classList.contains('wd-far')).toBe(false);
    expect(target.style.height).toBe('');
    expect(target.textContent?.trim()).toBe('paragraph number 1000');
    // It is hidden again at the height it had, and keeps its content for a quick way back.
    const content = target.firstElementChild;
    t.observer().report([{ element: target, near: false }]);
    expect(target.classList.contains('wd-far')).toBe(true);
    expect(target.style.height).toBe('90px');
    expect(target.firstElementChild).toBe(content);
    t.observer().report([{ element: target, near: true }]);
    expect(target.classList.contains('wd-far')).toBe(false);
    expect(target.firstElementChild).toBe(content);
  });

  it('lets the content of the blocks that went far first go, when there are many', () => {
    const t = setup(paragraphs(COUNT));
    const visited = t.blocks().slice(500, 1000) as HTMLElement[];
    t.observer().report(visited.map((element) => ({ element, near: true })));
    t.observer().report(visited.map((element) => ({ element, near: false })));
    // 500 went far, 400 may keep their content: the first 100 are empty again.
    expect(visited.slice(0, 100).every((b) => b.childElementCount === 0)).toBe(true);
    expect(visited.slice(100).every((b) => b.childElementCount > 0)).toBe(true);
    // Their height is kept, and they come back when they are near again.
    expect(visited[0]?.style.height).toBe('40px');
    t.observer().report([{ element: visited[0] as HTMLElement, near: true }]);
    expect(visited[0]?.textContent?.trim()).toBe('paragraph number 500');
  });

  it('keeps the scroll position when a block above the viewport changes its height', () => {
    const t = setup(paragraphs(COUNT));
    t.scroller.scrollTop = 5000;
    const above = t.blocks()[800] as HTMLElement;
    const below = t.blocks()[900] as HTMLElement;
    const estimate = parseFloat(above.style.height);
    heightOf = () => estimate + 25;
    t.observer().report([
      { element: above, near: true, above: true },
      { element: below, near: true },
    ]);
    // The block above got 25 px taller, so everything below it moved down by 25 px.
    expect(t.scroller.scrollTop).toBe(5025);
  });

  it('does not touch the scroll position for blocks below the viewport', () => {
    const t = setup(paragraphs(COUNT));
    t.scroller.scrollTop = 5000;
    heightOf = () => 500;
    t.observer().report([{ element: t.blocks()[900] as HTMLElement, near: true }]);
    expect(t.scroller.scrollTop).toBe(5000);
  });

  it('leaves a block with the keyboard focus as it is', () => {
    const source = paragraphs(COUNT, { 1200: '- [ ] a task' });
    const t = setup(source);
    const block = t.blocks()[1200] as HTMLElement;
    t.observer().report([{ element: block, near: true }]);
    const box = block.querySelector<HTMLElement>('.task-checkbox');
    box?.focus();
    expect(document.activeElement).toBe(box);
    t.observer().report([{ element: block, near: false }]);
    expect(block.classList.contains('wd-far')).toBe(false);
  });

  it('ignores the observer while the preview is hidden or has no layout', () => {
    const t = setup(paragraphs(COUNT));
    const target = t.blocks()[1000] as HTMLElement;
    t.controller.setVisible(false);
    t.observer().report([{ element: target, near: true }]);
    expect(target.classList.contains('wd-far')).toBe(true);
    t.controller.setVisible(true);
    Object.defineProperty(t.scroller, 'clientHeight', { configurable: true, value: 0 });
    t.observer().report([{ element: target, near: true }]);
    expect(target.classList.contains('wd-far')).toBe(true);
  });

  it('adds what a block needs after sanitizing when it first comes near, not before', () => {
    const code = '```js\nconst a = 1;\n```';
    const t = setup(paragraphs(COUNT, { 1300: code }));
    const block = t.blocks()[1300] as HTMLElement;
    expect(block.classList.contains('wd-far')).toBe(true);
    expect(block.querySelector('.code-copy')).toBeNull();
    t.observer().report([{ element: block, near: true }]);
    expect(block.querySelector('.code-copy')).not.toBeNull();
  });

  it('makes the block of a heading when the heading is revealed (a jump to the heading)', () => {
    const t = setup(paragraphs(COUNT, { 1400: '## A far heading' }));
    expect(t.container.querySelector('#a-far-heading')).toBeNull();
    t.controller.revealHeading('a-far-heading');
    const heading = t.container.querySelector('#a-far-heading') as HTMLElement;
    expect(heading).not.toBeNull();
    expect(heading.closest('.wd-block')?.classList.contains('wd-far')).toBe(false);
    // An id that is not a heading of the document does nothing.
    t.controller.revealHeading('nothing');
  });

  it('an edit where the reader is stays shown, an edit far away stays empty, and neighbors stay', () => {
    const t = setup(paragraphs(COUNT));
    const first = t.blocks()[2] as HTMLElement;
    const farOne = t.blocks()[1100] as HTMLElement;
    expect(first.classList.contains('wd-far')).toBe(false);
    expect(farOne.classList.contains('wd-far')).toBe(true);

    t.set(paragraphs(COUNT, { 2: 'changed near', 1100: 'changed far' }));
    t.controller.renderNow();
    t.controller.completeNow();
    const changedNear = t.blocks()[2] as HTMLElement;
    const changedFar = t.blocks()[1100] as HTMLElement;
    expect(changedNear.textContent?.trim()).toBe('changed near');
    expect(changedNear).not.toBe(first);
    expect(changedNear.classList.contains('wd-far')).toBe(false);
    // The far one is a new empty box with the lines of the block.
    expect(changedFar).not.toBe(farOne);
    expect(changedFar.classList.contains('wd-far')).toBe(true);
    expect(changedFar.childElementCount).toBe(0);
    expect(changedFar.getAttribute('data-line')).toBe('2200');
    expect(changedFar.getAttribute('data-key')).not.toBe(farOne.getAttribute('data-key'));
    // The removed elements are no longer observed, the new ones are.
    expect(t.observer().observed.has(first)).toBe(false);
    expect(t.observer().observed.has(changedNear)).toBe(true);
    expect(t.observer().observed.size).toBe(COUNT);
  });

  it('a block that is inserted between two blocks that are shown is shown', () => {
    const t = setup(paragraphs(COUNT));
    t.set(
      `${paragraphs(COUNT).replace('paragraph number 4\n', 'paragraph number 4\n\nnew block\n')}`,
    );
    t.controller.renderNow();
    t.controller.completeNow();
    const added = t.blocks().find((b) => b.textContent?.trim() === 'new block') as HTMLElement;
    expect(added.classList.contains('wd-far')).toBe(false);
  });

  it('becomes a small document again: everything is shown, nothing is observed', () => {
    const t = setup(paragraphs(COUNT));
    const observer = t.observer();
    expect(t.far().length).toBeGreaterThan(1000);
    t.set(paragraphs(100));
    t.controller.renderNow();
    t.controller.completeNow();
    expect(t.container.classList.contains('wd-preview-large')).toBe(false);
    expect(t.blocks()).toHaveLength(100);
    expect(t.far()).toHaveLength(0);
    expect(t.blocks().every((b) => b.childElementCount > 0)).toBe(true);
    expect(observer.disconnected).toBe(true);
  });

  it('a block that is empty when the document becomes small gets its content', () => {
    const t = setup(paragraphs(COUNT));
    // The same first 100 blocks: the empty ones among them are made.
    t.set(paragraphs(100));
    t.controller.renderNow();
    t.controller.completeNow();
    expect(t.blocks().every((b) => b.textContent?.includes('paragraph number'))).toBe(true);
  });

  it('a small document that grows past the limit starts to hide its far blocks', () => {
    const t = setup(paragraphs(100));
    expect(FakeObserver.all).toHaveLength(0);
    t.set(paragraphs(COUNT));
    t.controller.renderNow();
    t.controller.completeNow();
    expect(t.container.classList.contains('wd-preview-large')).toBe(true);
    expect(t.far().length).toBeGreaterThan(1000);
    expect(t.observer().observed.size).toBe(COUNT);
    // The blocks that were shown stay shown until the observer says they are far.
    expect(t.blocks()[0]?.classList.contains('wd-far')).toBe(false);
  });

  it('a document below the limit never hides anything', () => {
    const t = setup(paragraphs(LARGE_DOCUMENT_BLOCKS - 1));
    expect(t.container.classList.contains('wd-preview-large')).toBe(false);
    expect(t.far()).toHaveLength(0);
    expect(FakeObserver.all).toHaveLength(0);
  });

  it('without an IntersectionObserver every block shows its content', () => {
    delete (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
    const t = setup(paragraphs(COUNT));
    expect(t.container.classList.contains('wd-preview-large')).toBe(true);
    expect(t.far()).toHaveLength(0);
  });

  it('dispose stops observing', () => {
    const t = setup(paragraphs(COUNT));
    const observer = t.observer();
    t.controller.dispose();
    expect(observer.disconnected).toBe(true);
  });

  it('whenSettled does not wait for what only far blocks need', async () => {
    vi.useRealTimers();
    const t = setup(paragraphs(COUNT, { 1500: '```js\nlet a;\n```' }));
    await t.controller.whenSettled();
    expect(t.far().length).toBeGreaterThan(1000);
  });
});
