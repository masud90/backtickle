/**
 * Contrast of the colors of the preview (WCAG 2.x 1.4.3: 4.5:1 for text, 1.4.11: 3:1 for the
 * parts of controls). The token colors are read from preview.css and tokens.css, so a change to
 * either is checked.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const preview = readFileSync(resolve(__dirname, '../../src/preview/preview.css'), 'utf8');
const tokens = readFileSync(resolve(__dirname, '../../src/styles/tokens.css'), 'utf8');

type Rgb = [number, number, number];

function parse(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a: Rgb, b: Rgb): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

function blend(foreground: Rgb, background: Rgb, alpha: number): Rgb {
  return foreground.map((value, i) =>
    Math.round(value * alpha + (background[i] as number) * (1 - alpha)),
  ) as Rgb;
}

/** The `--wd-name: #hex` declarations of one block of tokens.css. */
function declarations(block: string): Record<string, Rgb> {
  const found: Record<string, Rgb> = {};
  for (const match of block.matchAll(/--wd-([a-z-]+):\s*(#[0-9a-f]{6})/gi)) {
    found[match[1] as string] = parse(match[2] as string);
  }
  return found;
}

const light = declarations(tokens.slice(0, tokens.indexOf('@media')));
const dark = declarations(
  tokens.slice(tokens.indexOf('@media'), tokens.indexOf(':root[data-theme="dark"]')),
);
// preview.css defines the warning accent for both themes
const warning = {
  light: parse((/:root\s*\{[^}]*--wd-warning:\s*(#[0-9a-f]{6})/i.exec(preview) ?? [])[1] as string),
  dark: parse(
    (/\[data-theme="light"\]\)\s*\{\s*--wd-warning:\s*(#[0-9a-f]{6})/i.exec(preview) ??
      [])[1] as string,
  ),
};

function cssVariable(name: string): Rgb {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(preview);
  return parse(match?.[1] as string);
}

describe('code card colors (the same dark card in both themes)', () => {
  const card = cssVariable('wd-code-card-bg');
  const header = cssVariable('wd-code-card-header');

  it('has the colors of the mock', () => {
    expect(card).toEqual(parse('#1e1e24'));
    expect(header).toEqual(parse('#18181d'));
    expect(cssVariable('wd-code-card-text')).toEqual(parse('#d8dee9'));
  });

  it('every token color has 4.5:1 or more on the card', () => {
    const colors = new Map<string, Rgb>();
    for (const rule of preview.matchAll(
      /((?:\.wd-preview \.code-card \.tok-[A-Za-z0-9]+,?\s*)+)\{([^}]*)\}/g,
    )) {
      const value = /(?:^|\s)color:\s*(#[0-9a-f]{6}|var\(--wd-tok-[a-z0-9]+\))/i.exec(
        rule[2] as string,
      )?.[1];
      if (!value) continue;
      // The token colors are variables since Phase 4 (WP4.3); the dark card has the defaults.
      const color = value.startsWith('var(')
        ? (new RegExp(`${value.slice(4, -1)}:\\s*(#[0-9a-f]{6})`, 'i').exec(preview)?.[1] as string)
        : value;
      for (const selector of (rule[1] as string).split(','))
        colors.set(selector.trim(), parse(color));
    }
    expect(colors.size).toBeGreaterThanOrEqual(20);
    const failures = [...colors]
      .filter(([, color]) => ratio(color, card) < 4.5)
      .map(([name, color]) => `${name} ${ratio(color, card).toFixed(2)}`);
    expect(failures).toEqual([]);
  });

  it('the text, the language label and the Copy button read well on the header bar', () => {
    expect(ratio(cssVariable('wd-code-card-text'), card)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(blend([255, 255, 255], header, 0.8), header)).toBeGreaterThanOrEqual(4.5);
    const button = blend([255, 255, 255], header, 0.05);
    expect(ratio(blend([255, 255, 255], button, 0.75), button)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(cssVariable('wd-code-card-focus'), header)).toBeGreaterThanOrEqual(3);
  });
});

describe.each([
  ['light', light, warning.light],
  ['dark', dark, warning.dark],
] as const)('alerts and small components, %s theme', (_name, theme, warningColor) => {
  // The preview sits on the lowest surface container or on the canvas, depending on the shell.
  const surfaces: Rgb[] = [theme['surface-container-lowest'] as Rgb, theme.surface as Rgb];
  const accents: Record<string, Rgb> = {
    note: theme.primary as Rgb,
    tip: theme.tertiary as Rgb,
    important: theme.secondary as Rgb,
    warning: warningColor,
    caution: theme.error as Rgb,
  };

  it.each(Object.keys(accents))(
    '%s: title and body text have 4.5:1 on the tinted background',
    (type) => {
      for (const surface of surfaces) {
        const accent = accents[type] as Rgb;
        const tint = blend(accent, surface, 0.08);
        expect(ratio(accent, tint), `${type} title`).toBeGreaterThanOrEqual(4.5);
        expect(
          ratio(theme['on-surface-variant'] as Rgb, tint),
          `${type} body`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(ratio(accent, surface), `${type} border and icon`).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it('task boxes: the outline has 3:1, the check mark has 4.5:1 on the fill', () => {
    for (const surface of surfaces) {
      expect(ratio(theme.outline as Rgb, surface)).toBeGreaterThanOrEqual(3);
    }
    expect(ratio(theme['on-tertiary'] as Rgb, theme.tertiary as Rgb)).toBeGreaterThanOrEqual(4.5);
  });

  it('completed tasks use the muted text color, which has 4.5:1', () => {
    for (const surface of surfaces) {
      expect(ratio(theme['on-surface-variant'] as Rgb, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('frontmatter pills and the version text are readable', () => {
    for (const surface of surfaces) {
      expect(
        ratio(theme.primary as Rgb, blend(theme.primary as Rgb, surface, 0.1)),
      ).toBeGreaterThanOrEqual(4.5);
      expect(ratio(theme['on-surface-variant'] as Rgb, surface)).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      ratio(theme['on-secondary-fixed-variant'] as Rgb, theme['secondary-fixed'] as Rgb),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('the footnote text and the missing-image text use on-surface-variant, never outline', () => {
    expect(preview).not.toMatch(/color:\s*var\(--wd-outline\)/);
  });
});

describe('the stylesheet', () => {
  it('has no inline style hooks, no em dashes and no en dashes', () => {
    expect(preview).not.toMatch(/[\u2013\u2014]/);
    expect(preview).not.toMatch(/style=/);
  });
});
