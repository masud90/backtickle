/**
 * The preview settings as they reach the page:
 *
 * - CSS variables on the root, set through the CSSOM (no style attribute): the reading typeface,
 *   the size factor (size divided by the 15 px default) and the column width. A variable at its
 *   default is removed, so the stylesheet's own values apply and nothing changes until a choice
 *   is made. `preview.css`, the export page and the print root read the same variables.
 * - `data-wd-code-cards="light"` on the root for light code cards.
 * - the render options of the pipelines (`options.ts`).
 * - the stylesheet of the chosen typeface, loaded only when it is chosen.
 */
import type { Settings } from '@/lib/platform';
import { loadReadingFont, READING_FONTS, type ReadingFontId } from '@/styles/fonts';
import { setPreviewOptions } from './options';

export const DEFAULT_PREVIEW_FONT_SIZE = 15;
export const DEFAULT_COLUMN_WIDTH = 720;

type PreviewSettings = Settings['preview'];

/** The `font-family` value of a reading font, or null for the default (Inter). */
export function previewFontFamily(font: ReadingFontId): string | null {
  if (font === 'inter') return null;
  return READING_FONTS.find((entry) => entry.id === font)?.fontFamily ?? null;
}

/** Size divided by the default, or null at the default. */
export function previewSizeFactor(size: number): number | null {
  if (!Number.isFinite(size) || size === DEFAULT_PREVIEW_FONT_SIZE) return null;
  return size / DEFAULT_PREVIEW_FONT_SIZE;
}

/** The variables and the attribute for a set of preview settings: null means "not set". */
export function previewAppearance(preview: PreviewSettings): {
  fontFamily: string | null;
  sizeFactor: number | null;
  columnWidth: number | null;
  lightCodeCards: boolean;
} {
  return {
    fontFamily: previewFontFamily(preview.font),
    sizeFactor: previewSizeFactor(preview.fontSize),
    columnWidth: preview.columnWidth === DEFAULT_COLUMN_WIDTH ? null : preview.columnWidth,
    lightCodeCards: preview.codeCards === 'light',
  };
}

function setOrRemove(root: HTMLElement, name: string, value: string | null): void {
  if (value === null) root.style.removeProperty(name);
  else root.style.setProperty(name, value);
}

/** Puts the preview settings on the page and into the render options. */
export function applyPreviewSettings(root: HTMLElement, settings: Settings): void {
  const preview = settings.preview;
  const look = previewAppearance(preview);
  setOrRemove(root, '--wd-preview-font-family', look.fontFamily);
  setOrRemove(
    root,
    '--wd-preview-size-factor',
    look.sizeFactor === null ? null : String(look.sizeFactor),
  );
  setOrRemove(
    root,
    '--wd-preview-column-width',
    look.columnWidth === null ? null : `${look.columnWidth}px`,
  );
  if (look.lightCodeCards) root.dataset.wdCodeCards = 'light';
  else delete root.dataset.wdCodeCards;
  // The stylesheet of the typeface loads only when it is chosen; the text re-lays out when it is in.
  if (preview.font !== 'inter' && preview.font !== 'system') {
    void loadReadingFont(preview.font).catch(() => {});
  }
  setPreviewOptions({
    hashtagPills: preview.hashtagPills,
    obsidianCommentsDimmed: preview.obsidianCommentsDimmed,
    smartPunctuation: preview.smartPunctuation,
    math: preview.math,
    remoteImages: preview.remoteImages,
  });
}

/**
 * The same choices for a page that leaves the app: one `:root` rule for the exported page
 * (empty at the defaults), and whether the page gets the light code card attribute.
 */
export function previewExportStyle(preview: PreviewSettings): {
  css: string;
  lightCodeCards: boolean;
} {
  const look = previewAppearance(preview);
  const rules: string[] = [];
  if (look.fontFamily !== null) rules.push(`--wd-preview-font-family: ${look.fontFamily};`);
  if (look.sizeFactor !== null) rules.push(`--wd-preview-size-factor: ${look.sizeFactor};`);
  if (look.columnWidth !== null) rules.push(`--wd-preview-column-width: ${look.columnWidth}px;`);
  return {
    css: rules.length === 0 ? '' : `:root {\n  ${rules.join('\n  ')}\n}`,
    lightCodeCards: look.lightCodeCards,
  };
}
