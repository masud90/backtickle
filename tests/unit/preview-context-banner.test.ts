/** The context hook and the error banner of the preview controller. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewController } from '@/preview/controller';
import type { DocContext, Pipeline, RenderResult } from '@/preview/types';

const EMPTY = {
  headings: [],
  stats: { words: 0, characters: 0, charactersNoSpaces: 0 },
  frontmatter: null,
};

/** Renders the text as one block; text with `BAD` gives an error on the line after it. */
function pipeline(seen: Array<DocContext | undefined>): Pipeline {
  return {
    flavor: 'mdx',
    render(text: string, context?: DocContext): RenderResult {
      seen.push(context);
      const bad = text.split('\n').findIndex((line) => line.includes('BAD'));
      const label = context ? `[${context.signature}] ` : '';
      return {
        ...EMPTY,
        blocks: [
          {
            key: label + text,
            html: `<div class="wd-block" data-line="0" data-end-line="0" data-key="k"><p>${label}${text.replace(/BAD/, 'bad')}</p></div>`,
            line: 0,
            endLine: 0,
          },
        ],
        features: { math: false, languages: [] },
        ...(bad >= 0 ? { error: { line: bad + 1, message: 'Unexpected token' } } : {}),
      };
    },
    analyze: () => EMPTY,
  };
}

function context(signature: string): DocContext {
  return {
    metadata: {},
    labels: new Map(),
    citationKeys: [],
    bibliography: null,
    vault: null,
    includes: new Map(),
    signature,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const scroller = document.createElement('div');
  const container = document.createElement('article');
  scroller.append(container);
  document.body.append(scroller);
  let source = 'fine';
  let current: DocContext | undefined;
  const seen: Array<DocContext | undefined> = [];
  const goto = vi.fn();
  const controller = new PreviewController({
    container,
    getSource: () => source,
    getContext: () => current,
    pipeline: pipeline(seen),
    onGoToLine: goto,
  });
  return {
    scroller,
    container,
    controller,
    goto,
    seen,
    setSource: (next: string) => {
      source = next;
    },
    setContext: (next: DocContext | undefined) => {
      current = next;
    },
  };
}

describe('the context of a render', () => {
  it('is asked for at each render and given to the pipeline', () => {
    const { controller, setContext, container, seen } = setup();
    setContext(context('one'));
    controller.renderNow();
    expect(seen.at(-1)?.signature).toBe('one');
    expect(container.textContent).toContain('[one]');
    setContext(context('two'));
    controller.renderNow();
    expect(seen.at(-1)?.signature).toBe('two');
    expect(container.textContent).toContain('[two]');
    controller.dispose();
  });

  it('is undefined for a pack that has none', () => {
    const { controller, seen } = setup();
    controller.renderNow();
    expect(seen).toEqual([undefined]);
    controller.dispose();
  });
});

describe('the error banner', () => {
  it('keeps the last good blocks, says where, and goes when a render succeeds', () => {
    const { controller, setSource, container, scroller, goto } = setup();
    setSource('good text');
    controller.renderNow();
    expect(scroller.querySelector('.mdx-error-banner')).toBeNull();

    setSource('first\nsecond BAD');
    controller.renderNow();
    const banner = scroller.querySelector('.mdx-error-banner');
    expect(banner?.getAttribute('role')).toBe('alert');
    expect(banner?.nextElementSibling).toBe(container);
    expect(banner?.textContent).toContain('MDX error on line 2: Unexpected token');
    // The blocks of the last good render are still there.
    expect(container.textContent).toContain('good text');
    expect(container.textContent).not.toContain('second');

    const button = banner?.querySelector('button');
    expect(button?.textContent).toBe('Go to line');
    button?.click();
    expect(goto).toHaveBeenCalledWith(2);

    setSource('fixed');
    controller.renderNow();
    expect(scroller.querySelector('.mdx-error-banner')).toBeNull();
    expect(container.textContent).toContain('fixed');
    controller.dispose();
  });

  it('shows one banner for repeated errors, with the latest message', () => {
    const { controller, setSource, scroller } = setup();
    setSource('BAD');
    controller.renderNow();
    setSource('x\nBAD');
    controller.renderNow();
    const banners = scroller.querySelectorAll('.mdx-error-banner');
    expect(banners).toHaveLength(1);
    expect(banners[0]?.textContent).toContain('line 2');
    controller.dispose();
    expect(scroller.querySelector('.mdx-error-banner')).toBeNull();
  });
});
