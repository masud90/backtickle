import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREVIEW_DEBOUNCE_MS, PreviewController } from '@/preview/controller';
import type { Pipeline, RenderResult } from '@/preview/types';

/** A pipeline that renders the whole text as one block and records what it was asked to render. */
function fakePipeline(render: (text: string) => void): Pipeline {
  const empty = {
    headings: [],
    stats: { words: 0, characters: 0, charactersNoSpaces: 0 },
    frontmatter: null,
  };
  return {
    flavor: 'gfm',
    render(text: string): RenderResult {
      render(text);
      return {
        ...empty,
        blocks: [
          {
            key: text,
            html: `<div class="wd-block" data-line="0" data-end-line="0" data-key="${text}"><p>${text}</p></div>`,
            line: 0,
            endLine: 0,
          },
        ],
        features: { math: false, languages: [] },
      };
    },
    analyze: () => empty,
  };
}

function setup(options: { visible?: boolean } = {}) {
  const container = document.createElement('article');
  let source = '# one';
  const getSource = vi.fn(() => source);
  const render = vi.fn();
  const rendered: Array<{ renderMs: number; first: boolean }> = [];
  const controller = new PreviewController({
    container,
    getSource,
    pipeline: fakePipeline(render),
    onRendered: (info) => rendered.push(info),
  });
  if (options.visible === false) controller.setVisible(false);
  return {
    container,
    controller,
    getSource,
    render,
    rendered,
    setSource: (next: string) => {
      source = next;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PreviewController: debounce', () => {
  it('uses a 120 ms debounce', () => {
    expect(PREVIEW_DEBOUNCE_MS).toBe(120);
  });

  it('renders once, 120 ms after the last change', () => {
    const { controller, render, setSource, container } = setup();

    controller.schedule();
    vi.advanceTimersByTime(100);
    setSource('# two');
    controller.schedule(); // typing continues: the timer restarts
    vi.advanceTimersByTime(100);
    expect(render).not.toHaveBeenCalled();

    vi.advanceTimersByTime(20);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith('# two');
    expect(container.querySelector('p')?.textContent).toBe('# two');
  });

  it('asks for the source only when it renders, not on every change', () => {
    const { controller, getSource } = setup();

    for (let i = 0; i < 50; i++) controller.schedule();
    expect(getSource).not.toHaveBeenCalled();

    vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
    expect(getSource).toHaveBeenCalledTimes(1);
  });

  it('renderNow renders immediately and cancels the pending timer', () => {
    const { controller, render } = setup();

    controller.schedule();
    controller.renderNow();
    vi.advanceTimersByTime(500);

    expect(render).toHaveBeenCalledTimes(1);
  });

  it('reports the render time and marks only the first render as first', () => {
    const { controller, rendered } = setup();

    controller.renderNow();
    controller.renderNow();

    expect(rendered).toHaveLength(2);
    expect(rendered[0]?.first).toBe(true);
    expect(rendered[1]?.first).toBe(false);
    expect(rendered.every((info) => info.renderMs >= 0)).toBe(true);
  });
});

describe('PreviewController: visibility', () => {
  it('does not render while hidden, and renders the latest text when shown again', () => {
    const { controller, render, setSource, container } = setup({ visible: false });

    controller.renderNow();
    setSource('# changed while hidden');
    controller.schedule();
    vi.advanceTimersByTime(1000);
    expect(render).not.toHaveBeenCalled();
    expect(container.querySelector('p')).toBeNull();
    expect(controller.hasPendingChange).toBe(true);

    controller.setVisible(true);

    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith('# changed while hidden');
    expect(controller.hasPendingChange).toBe(false);
  });

  it('cancels a pending render when the preview is hidden', () => {
    const { controller, render } = setup();

    controller.schedule();
    controller.setVisible(false);
    vi.advanceTimersByTime(1000);

    expect(render).not.toHaveBeenCalled();
  });

  it('does not re-render on show when nothing changed', () => {
    const { controller, render } = setup();
    controller.renderNow();

    controller.setVisible(false);
    controller.setVisible(true);

    expect(render).toHaveBeenCalledTimes(1);
  });

  it('does nothing after dispose', () => {
    const { controller, render } = setup();

    controller.schedule();
    controller.dispose();
    vi.advanceTimersByTime(1000);
    controller.renderNow();
    controller.schedule();

    expect(render).not.toHaveBeenCalled();
  });
});

describe('PreviewController: export after a parse error', () => {
  function erroring() {
    const empty = {
      headings: [],
      stats: { words: 0, characters: 0, charactersNoSpaces: 0 },
      frontmatter: null,
    };
    let broken = false;
    const pipeline: Pipeline = {
      flavor: 'mdx',
      render(text: string): RenderResult {
        const block = { key: text, html: `<p>${text}</p>`, line: 0, endLine: 0 };
        return {
          ...empty,
          blocks: broken ? [] : [block],
          features: { math: false, languages: [] },
          ...(broken ? { error: { line: 1, message: 'Unexpected end' } } : {}),
        };
      },
      analyze: () => empty,
    };
    const controller = new PreviewController({
      container: document.createElement('article'),
      getSource: () => 'good',
      pipeline,
    });
    return { controller, breakIt: () => (broken = true) };
  }

  it('exports the last good render when the source no longer parses', () => {
    const { controller, breakIt } = erroring();
    controller.renderNow();
    breakIt();
    controller.renderNow();
    const result = controller.renderForExport();
    expect(result?.blocks.map((block) => block.html)).toEqual(['<p>good</p>']);
  });

  it('has nothing to export when no render ever worked', () => {
    const { controller, breakIt } = erroring();
    breakIt();
    expect(controller.renderForExport()).toBeNull();
  });
});
