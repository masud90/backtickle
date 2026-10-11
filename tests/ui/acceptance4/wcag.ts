/** WCAG 2.2 contrast helpers for the Phase 4 acceptance tests (independent of the app's own code). */

export type Rgba = { r: number; g: number; b: number; a: number };

/** Parses a computed `rgb()`, `rgba()` or `color(srgb ...)` string. */
export function parseColor(text: string): Rgba {
  const rgb = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(
    text.trim(),
  );
  if (rgb) {
    const alpha =
      rgb[4] === undefined
        ? 1
        : rgb[4].endsWith('%')
          ? Number.parseFloat(rgb[4]) / 100
          : Number(rgb[4]);
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: alpha };
  }
  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/.exec(
    text.trim(),
  );
  if (srgb) {
    return {
      r: Number(srgb[1]) * 255,
      g: Number(srgb[2]) * 255,
      b: Number(srgb[3]) * 255,
      a: srgb[4] === undefined ? 1 : Number(srgb[4]),
    };
  }
  const lab = /^oklab\(\s*([\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(
    text.trim(),
  );
  if (lab) {
    const [L, A, B] = [Number(lab[1]), Number(lab[2]), Number(lab[3])];
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const sx = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    const lin = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * sx,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * sx,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * sx,
    ];
    const enc = (v: number) => {
      const c = Math.min(1, Math.max(0, v));
      return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
    };
    const alpha =
      lab[4] === undefined
        ? 1
        : lab[4].endsWith('%')
          ? Number.parseFloat(lab[4]) / 100
          : Number(lab[4]);
    return {
      r: enc(lin[0] as number),
      g: enc(lin[1] as number),
      b: enc(lin[2] as number),
      a: alpha,
    };
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(text.trim());
  if (hex) {
    const n = Number.parseInt(hex[1] as string, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  throw new Error(`Cannot parse the color "${text}"`);
}

/** Composites a foreground with alpha over an opaque background. */
export function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

/** WCAG 2.2 relative luminance of an opaque sRGB color. */
export function luminance(c: Rgba): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** WCAG contrast ratio, from 1 to 21. */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Contrast of a computed text color on a computed background color (both CSS strings). */
export function contrastOf(foreground: string, background: string, behind = '#ffffff'): number {
  const back = over(parseColor(background), parseColor(behind));
  return contrastRatio(over(parseColor(foreground), back), back);
}
