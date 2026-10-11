/**
 * Inline SVG icons for the trusted parts the preview adds to a document (alert icons, the Copy
 * button, the missing-image placeholder). They come from the icon set of the app and never from
 * the document. The icon map is imported read-only.
 */
import { ICONS, type IconName } from '@/shell/icons/index';

const cache = new Map<string, string>();

/** The markup of an icon as an inline SVG. */
export function iconSvg(name: string, size: number): string | null {
  if (!Object.hasOwn(ICONS, name)) return null;
  const key = `${name}:${size}`;
  let svg = cache.get(key);
  if (svg === undefined) {
    const inner = ICONS[name as IconName];
    svg =
      `<svg viewBox="0 -960 960 960" width="${size}" height="${size}" fill="currentColor" ` +
      `aria-hidden="true" focusable="false">${inner}</svg>`;
    cache.set(key, svg);
  }
  return svg;
}
