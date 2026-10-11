/**
 * Editor look: JetBrains Mono 13px on a 22px line (DESIGN.md "code-block"), the gutter, active
 * line and find bar of the dual-pane mock, and Markdown colors from the design tokens.
 *
 * Only `var(--wd-*)` tokens are used, so the editor follows light and dark with the page. Small
 * text uses `on-surface-variant`, never `outline` (4.5:1 contrast, see the token tests).
 *
 * Font size and line height come from two CSS custom properties, `--wd-editor-font-size` and
 * `--wd-editor-line-height` (defaults 13px and 22px, from the tokens). The shell sets them on the
 * page for zoom and `editor.fontSize`, so changing them needs no editor reconfiguration.
 */
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { REPLACE_MODE_CLASS } from './find';
import { syntaxTags } from './markdown';

const PRIMARY_10 = 'color-mix(in srgb, var(--wd-primary) 10%, transparent)';
const OUTLINE_VARIANT_20 = 'color-mix(in srgb, var(--wd-outline-variant) 20%, transparent)';
const ON_SURFACE_12 = 'color-mix(in srgb, var(--wd-on-surface) 12%, transparent)';
const ON_SURFACE_18 = 'color-mix(in srgb, var(--wd-on-surface) 18%, transparent)';

export const FONT_SIZE_VARIABLE = '--wd-editor-font-size';
export const LINE_HEIGHT_VARIABLE = '--wd-editor-line-height';

const FONT_SIZE = `var(${FONT_SIZE_VARIABLE}, var(--wd-text-code-block-size, 13px))`;
const LINE_HEIGHT = `var(${LINE_HEIGHT_VARIABLE}, var(--wd-text-code-block-line-height, 22px))`;

/** The find bar controls: 26px high with a 6px radius, as in the design's inline search. */
const CONTROL_HEIGHT = '26px';
const CONTROL_RADIUS = '6px';

const FIND_BAR = '.cm-panel.cm-search';
const FIND_BAR_PLAIN = `${FIND_BAR}:not(.${REPLACE_MODE_CLASS})`;

export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--wd-on-surface)',
    backgroundColor: 'var(--wd-canvas)',
    fontSize: FONT_SIZE,
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--wd-editor-font-family, var(--wd-font-mono))',
    lineHeight: LINE_HEIGHT,
    letterSpacing: 'var(--wd-text-code-block-tracking)',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: '16px 0',
    caretColor: 'var(--wd-primary)',
    // Safari does not edit text inside a user-select:none ancestor unless this is explicit.
    userSelect: 'text',
    WebkitUserSelect: 'text',
  },
  '.cm-line': { padding: '0 20px' },

  // Caret and selection
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--wd-primary)',
    borderLeftWidth: '2px',
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--wd-selection)' },

  // Active line: primary at 10% with a 2px primary edge on the left, as in the mock
  '.cm-activeLine': {
    backgroundColor: PRIMARY_10,
    boxShadow: 'inset 2px 0 0 var(--wd-primary)',
  },

  // Gutter: numbers in on-surface-variant (contrast), the current number bold primary
  '.cm-gutters': {
    backgroundColor: 'color-mix(in srgb, var(--wd-surface-container-low) 30%, transparent)',
    color: 'var(--wd-on-surface-variant)',
    border: 'none',
    borderRight: `1px solid ${OUTLINE_VARIANT_20}`,
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '48px',
    padding: '0 12px 0 8px',
    // 11px at the default 13px editor font, scaling with it
    fontSize: `calc(${FONT_SIZE} * 11 / 13)`,
    letterSpacing: 'var(--wd-text-label-sm-tracking)',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  },
  '.cm-activeLineGutter': {
    backgroundColor: PRIMARY_10,
    color: 'var(--wd-primary)',
    fontWeight: '700',
  },

  // Task markers: `[ ]` like a list marker, `[x]` in tertiary
  // The decoration is the outer span; the highlighter's own span inside it would win, so the
  // rule covers the descendants too.
  '.cm-wd-task, .cm-wd-task span': { color: 'var(--wd-secondary)' },
  '.cm-wd-task-done, .cm-wd-task-done span': { color: 'var(--wd-tertiary)', fontWeight: '700' },

  // Find bar (Cmd+F): an inline bar under the pane header. The panel is CodeMirror's own, so the
  // rules below restyle its controls; the replace row only shows for Find and Replace.
  '.cm-panels': {
    backgroundColor: 'var(--wd-surface-container-low)',
    color: 'var(--wd-on-surface)',
    fontFamily: 'var(--wd-font-sans)',
    fontSize: 'var(--wd-text-label-md-size)',
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--wd-hairline)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--wd-hairline)' },
  [FIND_BAR]: { padding: '4px 40px 4px 12px' },
  [`${FIND_BAR_PLAIN} br, ${FIND_BAR_PLAIN} input[name=replace], ${FIND_BAR_PLAIN} button[name=replace], ${FIND_BAR_PLAIN} button[name=replaceAll]`]:
    { display: 'none' },
  [`${FIND_BAR} input.cm-textfield, ${FIND_BAR} button.cm-button, ${FIND_BAR} label`]: {
    margin: '2px 6px 2px 0',
  },
  [`${FIND_BAR} label`]: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    height: CONTROL_HEIGHT,
    margin: '2px 8px 2px 0',
    color: 'var(--wd-on-surface-variant)',
    fontSize: 'inherit',
    textTransform: 'capitalize',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  },
  [`${FIND_BAR} input[type=checkbox]`]: {
    margin: '0',
    accentColor: 'var(--wd-primary)',
  },
  '.cm-panel input.cm-textfield': {
    boxSizing: 'border-box',
    width: '200px',
    maxWidth: '100%',
    height: CONTROL_HEIGHT,
    padding: '0 8px',
    border: '1px solid var(--wd-outline-variant)',
    borderRadius: CONTROL_RADIUS,
    backgroundColor: 'var(--wd-surface-container-lowest)',
    color: 'var(--wd-on-surface)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    outline: 'none',
    verticalAlign: 'middle',
  },
  '.cm-panel input.cm-textfield::placeholder': {
    color: 'var(--wd-on-surface-variant)',
    opacity: '1',
  },
  '.cm-panel input.cm-textfield:focus': {
    borderColor: 'var(--wd-primary)',
    boxShadow: '0 0 0 1px var(--wd-primary)',
  },
  '.cm-panel button.cm-button': {
    boxSizing: 'border-box',
    height: CONTROL_HEIGHT,
    padding: '0 10px',
    border: '1px solid transparent',
    borderRadius: CONTROL_RADIUS,
    backgroundImage: 'none',
    backgroundColor: 'var(--wd-inline-code-bg)',
    color: 'var(--wd-on-surface)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    fontWeight: '500',
    textTransform: 'capitalize',
    cursor: 'pointer',
    verticalAlign: 'middle',
  },
  '.cm-panel button.cm-button:hover': { backgroundColor: ON_SURFACE_12 },
  '.cm-panel button.cm-button:active': { backgroundImage: 'none', backgroundColor: ON_SURFACE_18 },
  '.cm-panel button:focus-visible, .cm-panel input[type=checkbox]:focus-visible': {
    outline: '2px solid var(--wd-primary)',
    outlineOffset: '1px',
  },
  [`${FIND_BAR} [name=close]`]: {
    top: '4px',
    right: '8px',
    width: CONTROL_HEIGHT,
    height: CONTROL_HEIGHT,
    borderRadius: CONTROL_RADIUS,
    backgroundColor: 'transparent',
    color: 'var(--wd-on-surface-variant)',
    fontSize: '18px',
    lineHeight: '24px',
    textAlign: 'center',
    cursor: 'pointer',
  },
  [`${FIND_BAR} [name=close]:hover`]: {
    backgroundColor: 'var(--wd-inline-code-bg)',
    color: 'var(--wd-on-surface)',
  },
  // Completion popup (autocomplete): design tokens only; text is on-surface or on-primary.
  '.cm-tooltip.cm-tooltip-autocomplete': {
    backgroundColor: 'var(--wd-surface-container)',
    border: '1px solid var(--wd-outline-variant)',
    borderRadius: '6px',
    overflow: 'hidden',
    fontFamily: 'var(--wd-font-mono)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--wd-font-mono)' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    padding: '2px 8px',
    color: 'var(--wd-on-surface)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--wd-primary)',
    color: 'var(--wd-on-primary)',
  },
  '.cm-tooltip-autocomplete .cm-completionDetail': {
    marginLeft: '0.8em',
    fontStyle: 'normal',
    color: 'inherit',
    opacity: '0.85',
  },
  '.cm-completionInfo': {
    backgroundColor: 'var(--wd-surface-container)',
    border: '1px solid var(--wd-outline-variant)',
    borderRadius: '6px',
    color: 'var(--wd-on-surface)',
    padding: '4px 8px',
  },
  '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '700' },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--wd-secondary) 22%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--wd-secondary) 50%, transparent)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--wd-primary) 30%, transparent)',
  },
});

/** Markdown syntax colors from the mock and, plus a small set for fenced code. */
export const markdownHighlightStyle = HighlightStyle.define([
  // Headings: bold text, primary `#` marks
  { tag: tags.heading1, fontWeight: '700' },
  { tag: tags.heading2, fontWeight: '600' },
  { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], fontWeight: '500' },
  { tag: tags.heading, fontWeight: '600' },
  { tag: syntaxTags.headingMark, color: 'var(--wd-primary)', fontWeight: '700' },

  // Markers (list and quote marks, emphasis stars, link brackets, code ticks, table pipes)
  { tag: tags.processingInstruction, color: 'var(--wd-secondary)' },
  { tag: tags.contentSeparator, color: 'var(--wd-secondary)' },

  // Inline styles: bold semibold, italic in primary, strikethrough struck out
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic', color: 'var(--wd-primary)' },
  // The spec colors this with `outline`, which is below the 4.5:1 text contrast; the line-through
  // carries the meaning, so the text stays readable in on-surface-variant.
  {
    tag: tags.strikethrough,
    textDecoration: 'line-through',
    color: 'var(--wd-on-surface-variant)',
  },
  { tag: tags.link, color: 'var(--wd-primary)' },
  { tag: tags.url, color: 'var(--wd-on-surface-variant)' },
  {
    tag: syntaxTags.inlineCode,
    backgroundColor: 'var(--wd-inline-code-bg)',
    borderRadius: '3px',
  },
  // The language name after the opening fence
  { tag: tags.labelName, color: 'var(--wd-on-surface-variant)' },
  { tag: tags.comment, color: 'var(--wd-on-surface-variant)', fontStyle: 'italic' },

  // Code inside fences
  {
    tag: [
      tags.keyword,
      tags.modifier,
      tags.operatorKeyword,
      tags.controlKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
    ],
    color: 'var(--wd-secondary)',
    fontWeight: '600',
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace, tags.tagName],
    color: 'var(--wd-primary)',
  },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--wd-tertiary)' },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp],
    color: 'var(--wd-on-surface-variant)',
  },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--wd-tertiary)' },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: 'var(--wd-primary)',
  },
]);

export const editorAppearance = [editorTheme, syntaxHighlighting(markdownHighlightStyle)];
