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

function shapes(svg: SVGSVGElement): string[] {
  return [...svg.querySelectorAll('g > *')].map((el) => el.tagName);
}

describe('AppMark', () => {
  it('draws the backtick keycap on its dark tile, like the app icon', () => {
    const svg = render('tile', 80);
    expect(svg.getAttribute('viewBox')).toBe('100 100 824 824');
    expect(shapes(svg)).toEqual(['rect', 'rect', 'rect', 'path', 'line']);
    expect(svg.querySelector('rect[fill="#2B2D42"]')).not.toBeNull();
    expect(svg.querySelector('line[stroke="#E5383B"]')).not.toBeNull();
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws only the keycap outline and backtick in currentColor', () => {
    const svg = render('glyph');
    expect(svg.getAttribute('viewBox')).toBe('182 202 660 660');
    expect(shapes(svg)).toEqual(['rect', 'line']);
    expect(svg.querySelector('[fill="#2B2D42"]')).toBeNull();
    expect(svg.querySelector('g')?.getAttribute('stroke')).toBe('currentColor');
    expect(svg.classList.contains('wd-icon-16')).toBe(true);
  });

  it.each(['tile', 'glyph'] as const)('has no style attribute (%s)', (variant) => {
    const svg = render(variant);
    expect(svg.hasAttribute('style')).toBe(false);
    expect(svg.querySelector('[style]')).toBeNull();
  });
});
