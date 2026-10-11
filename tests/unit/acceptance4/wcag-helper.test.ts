import { describe, expect, it } from 'vitest';
import { contrastOf, contrastRatio, parseColor } from '../../ui/acceptance4/wcag';

describe('D21 to D36 contrast helper (WCAG 2.2 formula)', () => {
  it('black on white is 21:1 (WCAG 2.2 definition of the range)', () => {
    expect(contrastRatio(parseColor('#000000'), parseColor('#ffffff'))).toBeCloseTo(21, 5);
  });

  it('#777777 on white is 4.48:1 (the published value used by WebAIM)', () => {
    expect(contrastRatio(parseColor('#777777'), parseColor('#ffffff'))).toBeCloseTo(4.48, 2);
  });

  it('parses computed color strings and composites alpha over the background', () => {
    expect(contrastOf('rgb(0, 0, 0)', 'rgb(255, 255, 255)')).toBeCloseTo(21, 5);
    expect(contrastOf('rgba(0, 0, 0, 1)', 'rgba(255, 255, 255, 1)')).toBeCloseTo(21, 5);
    // Half-transparent white over black is mid grey (127.5): contrast of black on it is 5.28:1.
    expect(contrastOf('rgb(0, 0, 0)', 'rgba(255, 255, 255, 0.5)', '#000000')).toBeCloseTo(5.28, 2);
  });

  it('parses oklab() as WebKit reports translucent colors', () => {
    const white = parseColor('oklab(1 0 0 / 0.9)');
    expect(white.r).toBeCloseTo(255, 0);
    expect(white.a).toBeCloseTo(0.9, 5);
    const black = parseColor('oklab(0 0 0)');
    expect(black.g).toBeCloseTo(0, 0);
  });
});
