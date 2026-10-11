import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import AppMark from '@/shell/icons/AppMark.svelte';

let current: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (current) unmount(current);
  current = null;
  document.body.innerHTML = '';
});

function render(variant: 'tile' | 'glyph', size = 16) {
  current = mount(AppMark, { target: document.body, props: { variant, size } });
  return document.body.querySelector('svg') as SVGSVGElement;
}

function geometry(svg: SVGSVGElement): string[] {
  return [...svg.querySelectorAll('g > *')].map((el) =>
    el.tagName === 'polygon'
      ? `polygon ${el.getAttribute('points')}`
      : `rect ${el.getAttribute('x')},${el.getAttribute('y')} ${el.getAttribute('width')}x${el.getAttribute('height')}`,
  );
}

const SHAPES = [
  'rect 212,232 600x72',
  'rect 336,304 72x266',
  'polygon 232,560 512,560 372,800',
  'rect 616,304 72x266',
  'polygon 512,560 792,560 652,800',
];

describe('AppMark', () => {
  it('draws the five B3 shapes on the blue tile', () => {
    const svg = render('tile', 80);
    expect(svg.getAttribute('viewBox')).toBe('100 100 824 824');
    expect(geometry(svg)).toEqual(SHAPES);
    expect(svg.querySelector('rect[fill="#0058bc"]')).not.toBeNull();
    expect(svg.querySelector('g')?.getAttribute('fill')).toBe('#ffffff');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws only the glyph in currentColor', () => {
    const svg = render('glyph');
    expect(svg.getAttribute('viewBox')).toBe('212 232 600 568');
    expect(geometry(svg)).toEqual(SHAPES);
    expect(svg.querySelector('rect[fill="#0058bc"]')).toBeNull();
    expect(svg.querySelector('g')?.getAttribute('fill')).toBe('currentColor');
    expect(svg.classList.contains('wd-icon-16')).toBe(true);
  });

  it.each(['tile', 'glyph'] as const)('has no style attribute (%s)', (variant) => {
    const svg = render(variant);
    expect(svg.hasAttribute('style')).toBe(false);
    expect(svg.querySelector('[style]')).toBeNull();
  });
});
