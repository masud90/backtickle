import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, it } from 'vitest';

// WCAG 2.x relative luminance calculation
function getLuminance(hex: string): number {
  const rgb = parseInt(hex.substring(1), 16);
  const r = (rgb >> 16) & 255;
  const g = (rgb >> 8) & 255;
  const b = rgb & 255;

  const normalize = (c: number) => {
    const sRGB = c / 255;
    return sRGB <= 0.03928 ? sRGB / 12.92 : ((sRGB + 0.055) / 1.055) ** 2.4;
  };

  const rs = normalize(r);
  const gs = normalize(g);
  const bs = normalize(b);

  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

// WCAG 2.x contrast ratio
function getContrastRatio(hex1: string, hex2: string): number {
  const lum1 = getLuminance(hex1);
  const lum2 = getLuminance(hex2);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Color Contrast (WCAG 2.x)', () => {
  let colorMap: { light: Record<string, string>; dark: Record<string, string> };

  beforeAll(() => {
    const tokensCss = readFileSync(resolve(__dirname, '../../src/styles/tokens.css'), 'utf-8');

    colorMap = { light: {}, dark: {} };

    // Extract light colors from :root
    const rootMatch = tokensCss.match(/:root\s*\{([\s\S]*?)(?:@media)/);
    if (rootMatch?.[1]) {
      const matches = rootMatch[1].matchAll(/--wd-([a-z-]+):\s*(#[0-9a-f]{6})/gi);
      for (const match of matches) {
        if (match[1] && match[2]) {
          colorMap.light[match[1]] = match[2];
        }
      }
    }

    // Extract dark colors from dark media query
    const darkMatch = tokensCss.match(/:root:not\(\[data-theme="light"\]\)\s*\{([\s\S]*?)\}/);
    if (darkMatch?.[1]) {
      const matches = darkMatch[1].matchAll(/--wd-([a-z-]+):\s*(#[0-9a-f]{6})/gi);
      for (const match of matches) {
        if (match[1] && match[2]) {
          colorMap.dark[match[1]] = match[2];
        }
      }
    }
  });

  it('should have at least 4.5:1 contrast for text colors on surfaces (light mode)', () => {
    const textColors = [
      'on-surface',
      'on-surface-variant',
      'primary',
      'secondary',
      'tertiary',
      'error',
    ];
    const surfaces = [
      'surface',
      'surface-container-lowest',
      'surface-container-low',
      'surface-container',
      'surface-container-high',
    ];

    const failures: string[] = [];

    for (const textColor of textColors) {
      for (const surface of surfaces) {
        const textHex = colorMap?.light?.[textColor];
        const surfaceHex = colorMap?.light?.[surface];

        if (!textHex || !surfaceHex) {
          throw new Error(`Missing color: textColor=${textColor}, surface=${surface}`);
        }

        const ratio = getContrastRatio(textHex, surfaceHex);
        if (ratio < 4.5) {
          failures.push(`${textColor} on ${surface}: ${ratio.toFixed(2)}:1 (light)`);
        }
      }
    }

    if (failures.length > 0) {
      throw new Error(failures.join('\n'));
    }
  });

  it('should have at least 4.5:1 contrast for text colors on surfaces (dark mode)', () => {
    const textColors = [
      'on-surface',
      'on-surface-variant',
      'primary',
      'secondary',
      'tertiary',
      'error',
    ];
    const surfaces = [
      'surface',
      'surface-container-lowest',
      'surface-container-low',
      'surface-container',
      'surface-container-high',
    ];

    const failures: string[] = [];

    for (const textColor of textColors) {
      for (const surface of surfaces) {
        const textHex = colorMap?.dark?.[textColor];
        const surfaceHex = colorMap?.dark?.[surface];

        if (!textHex || !surfaceHex) {
          throw new Error(`Missing dark color: textColor=${textColor}, surface=${surface}`);
        }

        const ratio = getContrastRatio(textHex, surfaceHex);
        if (ratio < 4.5) {
          failures.push(`${textColor} on ${surface}: ${ratio.toFixed(2)}:1 (dark)`);
        }
      }
    }

    if (failures.length > 0) {
      throw new Error(failures.join('\n'));
    }
  });

  it('should have at least 4.5:1 contrast for on-<color> on <color>', () => {
    const colorPairs: Array<[string, string]> = [
      ['primary', 'on-primary'],
      ['secondary', 'on-secondary'],
      ['tertiary', 'on-tertiary'],
      ['error', 'on-error'],
      ['primary-container', 'on-primary-container'],
      ['secondary-container', 'on-secondary-container'],
      ['tertiary-container', 'on-tertiary-container'],
    ];

    const failures: string[] = [];

    for (const [colorName, onColorName] of colorPairs) {
      // Light mode
      const lightColor = colorMap?.light?.[colorName];
      const lightOnColor = colorMap?.light?.[onColorName];

      if (lightColor && lightOnColor) {
        const lightRatio = getContrastRatio(lightOnColor, lightColor);
        if (lightRatio < 4.5) {
          failures.push(`${onColorName} on ${colorName}: ${lightRatio.toFixed(2)}:1 (light)`);
        }
      }

      // Dark mode
      const darkColor = colorMap?.dark?.[colorName];
      const darkOnColor = colorMap?.dark?.[onColorName];

      if (darkColor && darkOnColor) {
        const darkRatio = getContrastRatio(darkOnColor, darkColor);
        if (darkRatio < 4.5) {
          failures.push(`${onColorName} on ${colorName}: ${darkRatio.toFixed(2)}:1 (dark)`);
        }
      }
    }

    if (failures.length > 0) {
      throw new Error(failures.join('\n'));
    }
  });

  it('should have at least 3:1 contrast for outline (borders/icons) on surfaces', () => {
    const surfaces = [
      'surface',
      'surface-container-lowest',
      'surface-container-low',
      'surface-container',
      'surface-container-high',
    ];

    const failures: string[] = [];

    for (const surface of surfaces) {
      // Light mode
      const lightOutline = colorMap?.light?.outline;
      const lightSurface = colorMap?.light?.[surface];

      if (lightOutline && lightSurface) {
        const lightRatio = getContrastRatio(lightOutline, lightSurface);
        if (lightRatio < 3) {
          failures.push(`outline on ${surface}: ${lightRatio.toFixed(2)}:1 (light)`);
        }
      }

      // Dark mode
      const darkOutline = colorMap?.dark?.outline;
      const darkSurface = colorMap?.dark?.[surface];

      if (darkOutline && darkSurface) {
        const darkRatio = getContrastRatio(darkOutline, darkSurface);
        if (darkRatio < 3) {
          failures.push(`outline on ${surface}: ${darkRatio.toFixed(2)}:1 (dark)`);
        }
      }
    }

    if (failures.length > 0) {
      throw new Error(failures.join('\n'));
    }
  });
});
