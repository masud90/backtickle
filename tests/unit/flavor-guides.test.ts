import { describe, expect, it } from 'vitest';
import { FLAVORS } from '@/flavors';
import { guideFlavor, guideName, loadGuide } from '@/flavors/guides';

describe('the guide of a flavor', () => {
  it('is named "<Short> Guide", and GFM keeps "Markdown Guide"', () => {
    expect(guideName('gfm')).toBe('Markdown Guide');
    expect(guideName('quarto')).toBe('Quarto / RMD Guide');
    expect(guideName('pandoc')).toBe('Pandoc / MMD Guide');
    expect(guideName('commonmark')).toBe('CommonMark Guide');
  });

  it('falls back to GFM without a flavor', () => {
    expect(guideFlavor(undefined)).toBe('gfm');
    expect(guideFlavor(null)).toBe('gfm');
    expect(guideFlavor('mdx')).toBe('mdx');
  });

  it('loads the text of each flavor, and it is that flavor guide', async () => {
    for (const { id } of FLAVORS) {
      const text = await loadGuide(id);
      expect(text.length).toBeGreaterThan(100);
    }
    expect(await loadGuide('quarto')).not.toBe(await loadGuide('gfm'));
  });
});
