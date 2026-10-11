/**
 * The CSS of an exported or printed page: the design tokens, the preview styles and the Quarto
 * styles, light theme only. The sources are the app's own files, read as text at build time; the
 * dark rules (`prefers-color-scheme: dark`, `[data-theme="dark"]`) are cut out, so the page looks
 * the same on a dark system.
 */

import previewCss from '@/preview/preview.css?raw';
import quartoCss from '@/preview/rules/quarto/quarto.css?raw';
import tokensCss from '@/styles/tokens.css?raw';
import exportCss from './export.css?raw';

/** Removes every block that starts with one of `openers` (comments are removed first). */
export function cutBlocks(css: string, openers: readonly string[]): string {
  let text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (;;) {
    let start = -1;
    for (const opener of openers) {
      const at = text.indexOf(opener);
      if (at >= 0 && (start < 0 || at < start)) start = at;
    }
    if (start < 0) return text;
    const open = text.indexOf('{', start);
    if (open < 0) return text.slice(0, start);
    let depth = 1;
    let at = open + 1;
    while (at < text.length && depth > 0) {
      const char = text[at];
      if (char === '{') depth++;
      else if (char === '}') depth--;
      at++;
    }
    text = text.slice(0, start) + text.slice(at);
  }
}

const DARK = ['@media (prefers-color-scheme: dark)', ':root[data-theme="dark"]'];

/** The light theme CSS for a page that stands alone. */
export function lightCss(): string {
  return [tokensCss, previewCss, quartoCss, exportCss]
    .map((css) => cutBlocks(css, DARK))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

/** The same rules scoped to a print root: the tokens are set on it instead of on `:root`. */
export function scopedLightCss(selector: string): string {
  return lightCss().replace(/(^|\n):root\s*\{/g, `$1${selector} {`);
}
