import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyVibrancy } from '@/shell/appearance';
import { DEFAULT_SETTINGS_FOR_TESTS } from './a11y-helpers';

/*
 * Contrast on the translucent sidebar.
 *
 * Worst case used: the sidebar shows a scrim (src/styles/vibrancy.css) over the macOS material.
 * The material was measured (NSVisualEffectView .sidebar, active, behind-window, macOS 27.0.1,
 * 11 October 2026, script scripts/measure-sidebar-material.swift) over a full-screen black and
 * white backdrop: light appearance gives sRGB gray 204 to 229, dark appearance gives 42 to 87.
 * Those measured levels are the backdrops used here, one pair per mode. Text must keep 4.5:1,
 * icons 3:1, over both ends. The alphas leave a margin: each check also passes with the alpha
 * lowered by 0.1. Expected ratios are computed here from the WCAG formula, not read from the app.
 */

const css = (name: string) => readFileSync(resolve(__dirname, `../../src/styles/${name}`), 'utf-8');

type Rgb = [number, number, number];

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
const luminance = ([r, g, b]: Rgb) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a: Rgb, b: Rgb) => {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const hex = (value: string): Rgb => {
  const n = Number.parseInt(value.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
/** The scrim over a backdrop (a gray level). */
const over = (scrim: { rgb: Rgb; alpha: number }, backdrop: number): Rgb =>
  scrim.rgb.map((v) => v * scrim.alpha + backdrop * (1 - scrim.alpha)) as Rgb;

function scrims() {
  const sheet = css('vibrancy.css');
  const find = (pattern: RegExp) => {
    const m = sheet.match(pattern);
    if (!m) throw new Error(`not found: ${pattern}`);
    return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])] as Rgb, alpha: Number(m[4]) };
  };
  return {
    light: find(/^:root \{\s*--wd-sidebar-scrim: rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/m),
    dark: find(
      /:root:not\(\[data-theme="light"\]\) \{\s*--wd-sidebar-scrim: rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/,
    ),
  };
}

function tokens(mode: 'light' | 'dark') {
  const tokensCss = css('tokens.css');
  const block =
    mode === 'light'
      ? (tokensCss.match(/:root\s*\{([\s\S]*?)(?:@media)/)?.[1] ?? '')
      : (tokensCss.match(/:root:not\(\[data-theme="light"\]\)\s*\{([\s\S]*?)\}/)?.[1] ?? '');
  const read = (name: string) => {
    const m = block.match(new RegExp(`--wd-${name}:\\s*(#[0-9a-f]{6})`, 'i'));
    if (!m?.[1]) throw new Error(`missing token ${name} (${mode})`);
    return hex(m[1]);
  };
  return {
    onSurface: read('on-surface'),
    onSurfaceVariant: read('on-surface-variant'),
    primary: read('primary'),
    outline: read('outline'),
  };
}

/** The measured material levels (gray) at the two ends of each appearance. */
const MATERIAL: Record<'light' | 'dark', [number, number]> = {
  light: [204, 229],
  dark: [42, 87],
};

/** Each check as a [name, pass] pair for a scrim alpha over one backdrop. */
function checks(mode: 'light' | 'dark', alpha: number, backdrop: number) {
  const colors = tokens(mode);
  const scrim = { rgb: scrims()[mode].rgb, alpha };
  const bg = over(scrim, backdrop);
  return {
    textOnSurface: contrast(colors.onSurface, bg) >= 4.5,
    textVariant: contrast(colors.onSurfaceVariant, bg) >= 4.5,
    textPrimary: contrast(colors.primary, bg) >= 4.5,
    iconOutline: contrast(colors.outline, bg) >= 3,
    iconVariant: contrast(colors.onSurfaceVariant, bg) >= 3,
  };
}

describe('translucent sidebar contrast', () => {
  const found = scrims();
  for (const mode of ['light', 'dark'] as const) {
    describe(mode, () => {
      const colors = tokens(mode);
      for (const backdrop of MATERIAL[mode]) {
        const bg = over(found[mode], backdrop);
        it(`text keeps 4.5:1 over the measured material at gray ${backdrop}`, () => {
          expect(contrast(colors.onSurface, bg)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(colors.onSurfaceVariant, bg)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(colors.primary, bg)).toBeGreaterThanOrEqual(4.5);
        });
        it(`icons keep 3:1 over the measured material at gray ${backdrop}`, () => {
          expect(contrast(colors.outline, bg)).toBeGreaterThanOrEqual(3);
          expect(contrast(colors.onSurfaceVariant, bg)).toBeGreaterThanOrEqual(3);
        });
      }
      it('keeps the same checks passing with the alpha lowered by 0.1 (margin)', () => {
        const lowered = found[mode].alpha - 0.1;
        for (const backdrop of MATERIAL[mode]) {
          const result = checks(mode, lowered, backdrop);
          expect(Object.values(result).every(Boolean)).toBe(true);
        }
      });
    });
  }

  it('the scrim values are the documented alphas (0.4 light, 0.5 dark)', () => {
    expect(found.light).toEqual({ rgb: [242, 242, 247], alpha: 0.4 });
    expect(found.dark).toEqual({ rgb: [30, 30, 32], alpha: 0.5 });
  });
});

describe('applyVibrancy', () => {
  const root = () => document.createElement('html');
  const onPlatform = (kind: string) => {
    document.body.dataset.platform = kind;
  };

  it('sets data-vibrancy only in the real app with the setting on', () => {
    const settings = DEFAULT_SETTINGS_FOR_TESTS();
    const el = root();
    onPlatform('tauri');
    applyVibrancy(el, { ...settings, vibrancy: true });
    expect(el.dataset.vibrancy).toBe('on');
    applyVibrancy(el, { ...settings, vibrancy: false });
    expect(el.dataset.vibrancy).toBeUndefined();
    onPlatform('mock');
    applyVibrancy(el, { ...settings, vibrancy: true });
    expect(el.dataset.vibrancy).toBeUndefined();
  });
});
