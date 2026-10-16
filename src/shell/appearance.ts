/** Appearance and zoom: the settings that become CSS on the document element. */
import { byOs, isWindows, isWindows11 } from '@/lib/os';
import type { Settings } from '@/lib/platform';

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;
/** The editor line is 22 px for a 13 px font (DESIGN.md "code-block"); `editor.lineHeight` default. */
export const DEFAULT_LINE_HEIGHT = 1.7;

/** The CSS font stacks of `editor.fontFamily` and the name the pane header shows. */
export const EDITOR_FONTS: Record<
  Settings['editor']['fontFamily'],
  { label: string; css: string | null }
> = {
  'jetbrains-mono': { label: 'JetBrains Mono', css: null },
  // On Windows the two system choices are its own monospace fonts, under their own names.
  'sf-mono': {
    label: byOs('SF Mono', 'Cascadia Mono'),
    css: "ui-monospace, 'SF Mono', SFMono-Regular, 'Cascadia Mono', Consolas, monospace",
  },
  menlo: {
    label: byOs('Menlo', 'Consolas'),
    css: "Menlo, 'SF Mono', Consolas, 'Cascadia Mono', monospace",
  },
};

export function clampZoom(zoom: number): number {
  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  return Math.round(clamped * 100) / 100;
}

/** One step in or out, kept on the 10 percent grid. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  return clampZoom(Math.round(zoom * 10 + direction) / 10);
}

export function zoomPercent(zoom: number): number {
  return Math.round(zoom * 100);
}

/**
 * The editor font size and line height in pixels for a base size and a zoom. `lineHeight` is a
 * multiple of the font size (WP4.2: the optional third argument, default `editor.lineHeight`).
 */
export function editorMetrics(
  fontSize: number,
  zoom: number,
  lineHeight: number = DEFAULT_LINE_HEIGHT,
): { font: number; line: number } {
  const font = Math.round(fontSize * zoom * 100) / 100;
  return { font, line: Math.round(font * lineHeight) };
}

/**
 * Sets the CSS variables of the zoom on the document element: the editor font size and line
 * height, and the factor the preview scales its type by. CSSOM, not a style attribute, so the
 * content security policy allows it.
 */
export function applyZoom(root: HTMLElement, settings: Settings): void {
  const { font, line } = editorMetrics(
    settings.editor.fontSize,
    settings.view.zoom,
    settings.editor.lineHeight,
  );
  root.style.setProperty('--wd-editor-font-size', `${font}px`);
  root.style.setProperty('--wd-editor-line-height', `${line}px`);
  // WP4.2: the editor typeface; the bundled JetBrains Mono is the token's own value.
  const css = EDITOR_FONTS[settings.editor.fontFamily]?.css ?? null;
  if (css) root.style.setProperty('--wd-editor-font-family', css);
  else root.style.removeProperty('--wd-editor-font-family');
  root.style.setProperty('--wd-preview-zoom', String(settings.view.zoom));
}

/** `data-theme` follows the setting; "system" leaves the choice to the media query. */
export function applyAppearance(root: HTMLElement, appearance: Settings['appearance']): void {
  if (appearance === 'system') delete root.dataset.theme;
  else root.dataset.theme = appearance;
}

// ---- accessibility settings (Phase 4, WP4.4) ----------------------------------------------------

type A11ySettings = Settings['a11y'];

/** The families of the three dyslexia-friendly typefaces (the same stacks as `styles/fonts.ts`). */
export const DYSLEXIA_FAMILIES: Record<A11ySettings['dyslexiaFont'], string> = {
  opendyslexic: '"OpenDyslexic", sans-serif',
  atkinson: '"Atkinson Hyperlegible", sans-serif',
  lexend: '"Lexend Deca Variable", "Lexend Deca", sans-serif',
};

/** WCAG 2.2 success criterion 1.4.12: the editor's line is at least 1.5 times the font size. */
const DYSLEXIA_MIN_LINE_RATIO = 1.5;

/** The interface scale a setting value stands for: 1.0 to 1.5 in steps of 0.1. */
export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.round(Math.min(1.5, Math.max(1, scale)) * 10) / 10;
}

/** Follow macOS ("system") reads a media query; "on" and "off" decide. */
export function resolveSwitch(choice: 'system' | 'on' | 'off', systemWants: boolean): boolean {
  return choice === 'system' ? systemWants : choice === 'on';
}

const MEDIA = {
  motion: '(prefers-reduced-motion: reduce)',
  contrast: '(prefers-contrast: more)',
} as const;

function mediaMatches(query: string): boolean {
  return typeof matchMedia === 'function' && matchMedia(query).matches;
}

/** The latest accessibility settings of each document element, for the media query listeners. */
const watched = new WeakMap<HTMLElement, A11ySettings>();

function watchMedia(root: HTMLElement): void {
  if (watched.has(root) || typeof matchMedia !== 'function') return;
  watched.set(root, {} as A11ySettings);
  for (const query of Object.values(MEDIA)) {
    matchMedia(query).addEventListener('change', () => {
      const latest = watched.get(root);
      if (latest?.reduceMotion) applySwitches(root, latest);
    });
  }
}

function setFlag(root: HTMLElement, name: string, value: string | null): void {
  if (value === null) root.removeAttribute(name);
  else root.setAttribute(name, value);
}

/** Reduce motion and high-contrast dividers: attributes the stylesheet (a11y.css) matches. */
function applySwitches(root: HTMLElement, a11y: A11ySettings): void {
  const reduce = resolveSwitch(a11y.reduceMotion, mediaMatches(MEDIA.motion));
  const more = resolveSwitch(a11y.highContrast, mediaMatches(MEDIA.contrast));
  setFlag(root, 'data-motion', reduce ? 'reduce' : null);
  setFlag(root, 'data-contrast', more ? 'more' : null);
}

/**
 * Applies every `a11y.*` setting to a document element: data attributes and CSSOM variables
 * (never a style attribute), which `styles/a11y.css` turns into rules. Safe to call on every
 * settings change; with every setting at its default the element is left as it was.
 */
export function applyA11y(root: HTMLElement, settings: Settings): void {
  const a11y = settings.a11y;
  watchMedia(root);
  watched.set(root, a11y);
  applySwitches(root, a11y);

  const scale = clampScale(a11y.scale);
  root.style.setProperty('--wd-scale', String(scale));
  setFlag(root, 'data-scaled', scale === 1 ? null : '');

  setFlag(root, 'data-dyslexia', a11y.dyslexia ? a11y.dyslexiaFont : null);
  if (a11y.dyslexia) {
    root.style.setProperty('--wd-dyslexia-font', DYSLEXIA_FAMILIES[a11y.dyslexiaFont]);
    // The typeface files are lazy chunks of their own.
    void import('@/styles/fonts')
      .then((fonts) => fonts.loadReadingFont(a11y.dyslexiaFont))
      .catch(() => {});
    raiseEditorLineHeight(root);
  } else {
    root.style.removeProperty('--wd-dyslexia-font');
  }

  setFlag(root, 'data-ruler', a11y.ruler ? a11y.rulerTint : null);
  setFlag(root, 'data-ruler-tint', a11y.ruler ? a11y.rulerTint : null);
}

/** In dyslexia mode the editor's line is at least 1.5 times its font size (call after applyZoom). */
function raiseEditorLineHeight(root: HTMLElement): void {
  const font = Number.parseFloat(root.style.getPropertyValue('--wd-editor-font-size'));
  const line = Number.parseFloat(root.style.getPropertyValue('--wd-editor-line-height'));
  if (!Number.isFinite(font) || !Number.isFinite(line)) return;
  const least = Math.round(font * DYSLEXIA_MIN_LINE_RATIO * 100) / 100;
  if (line < least) root.style.setProperty('--wd-editor-line-height', `${least}px`);
}

/**
 * The one entry point for the settings that become attributes and variables on a document
 * element: the theme and every `a11y.*` setting. The main window calls it from
 * `Shell.applySettings` (after `applyZoom`, which sets the editor metrics it may raise); the
 * Preferences window calls it with the settings it receives.
 */
export function applyDocumentAppearance(root: HTMLElement, settings: Settings): void {
  applyAppearance(root, settings.appearance);
  applyA11y(root, settings);
  applyVibrancy(root, settings);
}

/**
 * Translucent sidebar (WP5.7): `data-vibrancy="on"` on the root makes the sidebar and the
 * category list of Preferences translucent (src/styles/vibrancy.css). Only in the real app, where
 * the native window has the sidebar material behind the web view; the mock platform (browser
 * tests, `npm run dev`) has nothing behind the page, so it stays opaque there.
 */
export function applyVibrancy(root: HTMLElement, settings: Settings): void {
  const native = root.ownerDocument.body?.dataset.platform === 'tauri';
  const wanted = native && settings.vibrancy;
  if (!isWindows()) {
    if (wanted) root.dataset.vibrancy = 'on';
    else delete root.dataset.vibrancy;
    return;
  }
  // Windows: the material behind the window is Mica, which only Windows 11 has; on Windows 10
  // the desktop would show through. The sidebar stays opaque until the version is known.
  vibrancyWanted.set(root, wanted);
  delete root.dataset.vibrancy;
  if (!wanted) return;
  void isWindows11().then((mica) => {
    if (mica && vibrancyWanted.get(root) === true) root.dataset.vibrancy = 'on';
  });
}

/** On Windows, the last answer of `applyVibrancy` for each root, read when the version is known. */
const vibrancyWanted = new WeakMap<HTMLElement, boolean>();
