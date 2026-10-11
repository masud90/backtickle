import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** WCAG 2.x contrast, computed independently of the app. */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

const root = resolve(__dirname, '../..');
const a11y = readFileSync(resolve(root, 'src/styles/a11y.css'), 'utf8');
const tokens = readFileSync(resolve(root, 'src/styles/tokens.css'), 'utf8');

function variables(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of source.matchAll(/--wd-([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi))
    out[m[1] as string] = m[2] as string;
  return out;
}

const tints = ['yellow', 'blue', 'green', 'pink'] as const;
// Light: the first block of a11y.css; dark: the media-query block (the same values as data-theme=dark).
const lightBlock = a11y.slice(0, a11y.indexOf('@media'));
const darkBlock = a11y.slice(a11y.indexOf('@media'), a11y.indexOf(':root[data-theme="dark"]'));
const light = { ...variables(tokens.slice(0, tokens.indexOf('@media'))), ...variables(lightBlock) };
const dark = {
  ...variables(tokens.slice(tokens.indexOf(':root:not([data-theme="light"])'))),
  ...variables(darkBlock),
};

describe('reading ruler tints', () => {
  for (const [name, colors] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    for (const tint of tints) {
      it(`${name} ${tint}: text keeps 4.5:1`, () => {
        const band = colors[`ruler-${tint}`];
        expect(band).toBeDefined();
        for (const text of ['on-surface', 'on-surface-variant', 'primary'] as const) {
          const fg = colors[text];
          // Text colors that a dark scheme does not redefine fall back to their light values only
          // when absent; the tokens file defines all three for both schemes.
          expect(fg, text).toBeDefined();
          expect(
            ratio(fg as string, band as string),
            `${name} ${tint} ${text}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }
});

describe('high-contrast dividers', () => {
  it('outline is at least 3:1 against the surfaces it divides (WCAG 1.4.11)', () => {
    for (const [colors, surfaces] of [
      [light, ['surface', 'surface-container-low', 'surface-container-lowest']],
      [dark, ['canvas', 'surface-container-low', 'background']],
    ] as const) {
      for (const surface of surfaces) {
        const bg = colors[surface];
        if (!bg) continue;
        expect(ratio(colors.outline as string, bg), surface).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
