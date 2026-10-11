import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../src/preview/preview.css'), 'utf8');

function block(opener: string): Record<string, string> {
  const start = css.indexOf(opener);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const match of body.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)) {
    out[match[1] as string] = match[2] as string;
  }
  return out;
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe.each([
  [':root {\n  /* Alert accent', 'dark'],
  [':root[data-wd-code-cards="light"]', 'light'],
])('code card colors (%#: %s)', (_opener, name) => {
  const tokens =
    name === 'light' ? block(':root[data-wd-code-cards="light"]') : { ...block(':root {'), ...{} };
  const bg = tokens['--wd-code-card-bg'] as string;
  const header = tokens['--wd-code-card-header'] as string;
  const entries = Object.entries(tokens).filter(([key]) => key.startsWith('--wd-tok-'));

  it('has the eight token colors', () => {
    expect(entries).toHaveLength(8);
  });
  it.each(entries)('%s has 4.5:1 on the card', (_key, value) => {
    expect(ratio(value, bg)).toBeGreaterThanOrEqual(4.5);
  });
  it('plain code text has 4.5:1 on the card', () => {
    expect(ratio(tokens['--wd-code-card-text'] as string, bg)).toBeGreaterThanOrEqual(4.5);
  });
  it('header text colors have 4.5:1 on the header', () => {
    if (name === 'light') {
      expect(ratio(tokens['--wd-code-card-muted'] as string, header)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(tokens['--wd-code-card-button-text'] as string, header)).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });
});
