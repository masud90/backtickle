/**
 * Every user-facing setting in one table: key path, default, range or
 * choices, and the text of Preferences. The Preferences window, its reset buttons and the tests
 * read this table. The defaults here equal `Settings` in `platform.ts` and `settings.rs`
 * (checked by `tests/unit/settings-meta.test.ts`). US English, sentence case, no em-dashes.
 */

export type SettingCategory = 'general' | 'editor' | 'preview' | 'accessibility' | 'saving';

/** The categories of the Preferences sidebar, in order. `shortcuts` has no settings, only a list. */
export const SETTING_CATEGORIES: ReadonlyArray<{
  id: SettingCategory | 'shortcuts';
  label: string;
}> = [
  { id: 'general', label: 'General' },
  { id: 'editor', label: 'Editor' },
  { id: 'preview', label: 'Markdown & Preview' },
  { id: 'accessibility', label: 'Accessibility' },
  { id: 'saving', label: 'Files & Saving' },
  { id: 'shortcuts', label: 'Keyboard Shortcuts' },
];

export interface SettingChoice {
  value: string;
  label: string;
}

interface SettingBase {
  /** Dotted path in the settings object, such as `editor.fontSize`. */
  key: string;
  /** Preferences label, sentence case. */
  label: string;
  /** One line under the label. */
  description: string;
  category: SettingCategory;
  /** Words the Preferences search also matches. */
  keywords: string[];
}

export type SettingMeta =
  | (SettingBase & { kind: 'boolean'; default: boolean })
  | (SettingBase & {
      kind: 'number';
      default: number;
      min: number;
      max: number;
      step: number;
      /** Shown after the number, such as `px`. */
      unit?: string;
    })
  | (SettingBase & { kind: 'choice'; default: string; choices: SettingChoice[] })
  | (SettingBase & { kind: 'path'; default: string | null })
  | (SettingBase & { kind: 'list'; default: string[] });

/** Settings that are stored but have no row in Preferences. */
export const INTERNAL_SETTING_KEYS: readonly string[] = [
  'version',
  'shortcuts',
  'view.sidebarVisible',
  'view.sidebarWidth',
  'view.splitRatio',
  'view.syncScroll',
  'view.zoom',
];

const VIEW_MODES: SettingChoice[] = [
  { value: 'editor', label: 'Editor' },
  { value: 'split', label: 'Split' },
  { value: 'preview', label: 'Preview' },
];

const TRI_STATE = (system: string): SettingChoice[] => [
  { value: 'system', label: system },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];

export const SETTINGS_META: readonly SettingMeta[] = [
  // ---- General ----
  {
    key: 'appearance',
    kind: 'choice',
    default: 'system',
    choices: [
      { value: 'system', label: 'Match system' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
    ],
    label: 'Appearance',
    description: 'Use the light or dark look, or follow macOS.',
    category: 'general',
    keywords: ['theme', 'light', 'dark', 'mode', 'color'],
  },
  {
    key: 'openExistingIn',
    kind: 'choice',
    default: 'preview',
    choices: VIEW_MODES,
    label: 'Open existing files in',
    description: 'The view a file opens in when you open it from disk.',
    category: 'general',
    keywords: ['open', 'view', 'mode', 'preview', 'split', 'editor'],
  },
  {
    key: 'openNewIn',
    kind: 'choice',
    default: 'split',
    choices: VIEW_MODES.filter((choice) => choice.value !== 'preview'),
    label: 'Open new documents in',
    description: 'The view a new, empty document opens in.',
    category: 'general',
    keywords: ['new', 'view', 'mode', 'split', 'editor'],
  },
  {
    key: 'restoreSession',
    kind: 'boolean',
    default: true,
    label: 'Reopen documents at launch',
    description: 'Open the documents and the folder of your last session when Writedown starts.',
    category: 'general',
    keywords: ['session', 'restore', 'startup', 'launch', 'reopen'],
  },
  {
    key: 'vibrancy',
    kind: 'boolean',
    default: true,
    label: 'Translucent sidebar',
    description:
      'Show the macOS sidebar material behind the sidebar. Off, or with Reduce Transparency on, the sidebar is opaque.',
    category: 'general',
    keywords: ['translucent', 'vibrancy', 'sidebar', 'transparency', 'blur', 'material'],
  },
  {
    key: 'recentLimit',
    kind: 'number',
    default: 20,
    min: 1,
    max: 100,
    step: 1,
    label: 'Recent documents',
    description: 'How many recent documents the Open Recent menu remembers.',
    category: 'general',
    keywords: ['recent', 'history', 'list', 'menu'],
  },
  {
    key: 'readingWpm',
    kind: 'number',
    default: 238,
    min: 50,
    max: 1000,
    step: 1,
    unit: 'words per minute',
    label: 'Reading speed',
    description: 'Words per minute used for the reading time in the status bar.',
    category: 'general',
    keywords: ['reading time', 'wpm', 'speed', 'status bar', 'words'],
  },

  // ---- Editor ----
  {
    key: 'editor.fontFamily',
    kind: 'choice',
    default: 'jetbrains-mono',
    choices: [
      { value: 'jetbrains-mono', label: 'JetBrains Mono' },
      { value: 'sf-mono', label: 'SF Mono' },
      { value: 'menlo', label: 'Menlo' },
    ],
    label: 'Editor font',
    description: 'The monospace typeface of the editor.',
    category: 'editor',
    keywords: ['font', 'typeface', 'monospace', 'jetbrains', 'menlo', 'sf mono'],
  },
  {
    key: 'editor.fontSize',
    kind: 'number',
    default: 13,
    min: 9,
    max: 32,
    step: 1,
    unit: 'px',
    label: 'Editor font size',
    description: 'The size of the text in the editor.',
    category: 'editor',
    keywords: ['font', 'size', 'text', 'bigger', 'smaller'],
  },
  {
    key: 'editor.lineHeight',
    kind: 'number',
    default: 1.7,
    min: 1.2,
    max: 2.4,
    step: 0.1,
    label: 'Line height',
    description: 'Space between lines in the editor, as a multiple of the font size.',
    category: 'editor',
    keywords: ['line height', 'leading', 'spacing', 'lines'],
  },
  {
    key: 'editor.tabSize',
    kind: 'number',
    default: 2,
    min: 1,
    max: 8,
    step: 1,
    unit: 'spaces',
    label: 'Tab size',
    description: 'How many spaces one indent level is.',
    category: 'editor',
    keywords: ['tab', 'indent', 'indentation', 'spaces', 'width'],
  },
  {
    key: 'editor.insertSpaces',
    kind: 'boolean',
    default: true,
    label: 'Insert spaces for Tab',
    description: 'Tab inserts spaces. Off inserts a tab character.',
    category: 'editor',
    keywords: ['tab', 'spaces', 'indent', 'indentation'],
  },
  {
    key: 'editor.softWrap',
    kind: 'boolean',
    default: true,
    label: 'Wrap long lines',
    description: 'Wrap lines at the edge of the editor instead of scrolling sideways.',
    category: 'editor',
    keywords: ['wrap', 'soft wrap', 'word wrap', 'long lines'],
  },
  {
    key: 'editor.lineNumbers',
    kind: 'boolean',
    default: true,
    label: 'Line numbers',
    description: 'Show line numbers beside the text.',
    category: 'editor',
    keywords: ['line numbers', 'gutter', 'numbers'],
  },
  {
    key: 'editor.currentLine',
    kind: 'boolean',
    default: true,
    label: 'Highlight current line',
    description: 'Shade the line that holds the cursor.',
    category: 'editor',
    keywords: ['current line', 'highlight', 'cursor', 'active line'],
  },
  {
    key: 'editor.spellcheck',
    kind: 'boolean',
    default: true,
    label: 'Check spelling',
    description: 'Underline misspelled words with the macOS spell checker.',
    category: 'editor',
    keywords: ['spelling', 'spell check', 'spellcheck', 'typos'],
  },
  {
    key: 'editor.autoPair',
    kind: 'boolean',
    default: false,
    label: 'Close brackets and quotes',
    description: 'Type one bracket, quote, **, __ or backtick and get the pair.',
    category: 'editor',
    keywords: ['auto pair', 'brackets', 'quotes', 'close', 'backticks', 'bold', 'pairs'],
  },
  {
    key: 'editor.typewriter',
    kind: 'boolean',
    default: false,
    label: 'Typewriter scrolling',
    description: 'Keep the line you are typing on in the middle of the editor',
    category: 'editor',
    keywords: ['typewriter', 'center', 'centre', 'scroll', 'middle', 'focus'],
  },
  {
    key: 'editor.continueLists',
    kind: 'boolean',
    default: true,
    label: 'Continue lists and quotes',
    description: 'Return starts the next list item or quote line.',
    category: 'editor',
    keywords: ['list', 'bullets', 'quote', 'return', 'enter', 'continue'],
  },
  {
    key: 'editor.paneHeaders',
    kind: 'boolean',
    default: true,
    label: 'Pane headers',
    description: 'Show the Editor and Preview labels above the two panes in Split view.',
    category: 'editor',
    keywords: ['header', 'labels', 'panes', 'split'],
  },

  // ---- Markdown & Preview ----
  {
    key: 'defaultFlavor',
    kind: 'choice',
    default: 'gfm',
    choices: [
      { value: 'commonmark', label: 'CommonMark' },
      { value: 'gfm', label: 'GitHub Flavored Markdown' },
      { value: 'obsidian', label: 'Obsidian' },
      { value: 'pandoc', label: 'Pandoc / MMD' },
      { value: 'quarto', label: 'Quarto / RMD' },
      { value: 'mdx', label: 'MDX' },
    ],
    label: 'Default flavor',
    description: 'The flavor used when a file does not say which one it is.',
    category: 'preview',
    keywords: ['flavor', 'markdown', 'dialect', 'gfm', 'commonmark', 'default'],
  },
  {
    key: 'preview.autoDetectFlavor',
    kind: 'boolean',
    default: true,
    label: 'Detect the flavor automatically',
    description: 'Off: only the file extension and your choice for the file are used.',
    category: 'preview',
    keywords: ['detect', 'auto', 'flavor', 'frontmatter', 'extension'],
  },
  {
    key: 'preview.font',
    kind: 'choice',
    default: 'inter',
    choices: [
      { value: 'inter', label: 'Inter' },
      { value: 'system', label: 'System' },
      { value: 'literata', label: 'Literata' },
      { value: 'atkinson', label: 'Atkinson Hyperlegible' },
      { value: 'lexend', label: 'Lexend' },
      { value: 'opendyslexic', label: 'OpenDyslexic' },
    ],
    label: 'Preview font',
    description: 'The typeface of the rendered document.',
    category: 'preview',
    keywords: ['font', 'typeface', 'serif', 'sans', 'inter', 'literata', 'reading'],
  },
  {
    key: 'preview.fontSize',
    kind: 'number',
    default: 15,
    min: 12,
    max: 28,
    step: 1,
    unit: 'px',
    label: 'Preview font size',
    description: 'The size of the text in the rendered document.',
    category: 'preview',
    keywords: ['font', 'size', 'text', 'bigger', 'smaller'],
  },
  {
    key: 'preview.columnWidth',
    kind: 'number',
    default: 720,
    min: 560,
    max: 1040,
    step: 40,
    unit: 'px',
    label: 'Column width',
    description: 'How wide the text column of the preview is.',
    category: 'preview',
    keywords: ['width', 'column', 'measure', 'line length', 'wide'],
  },
  {
    key: 'preview.hashtagPills',
    kind: 'boolean',
    default: false,
    label: 'Show #tags as pills',
    description: 'Draw #tags as small pills. Obsidian documents always do.',
    category: 'preview',
    keywords: ['tags', 'hashtag', 'pills', 'obsidian'],
  },
  {
    key: 'preview.obsidianCommentsDimmed',
    kind: 'boolean',
    default: false,
    label: 'Show Obsidian comments dimmed',
    description: 'Show %%comments%% in light gray instead of hiding them.',
    category: 'preview',
    keywords: ['comments', 'obsidian', 'hidden', 'dimmed'],
  },
  {
    key: 'preview.smartPunctuation',
    kind: 'boolean',
    default: true,
    label: 'Smart punctuation',
    description: 'Curly quotes, dashes and ellipses in Pandoc / MMD and Quarto / RMD.',
    category: 'preview',
    keywords: ['smart', 'quotes', 'typography', 'curly', 'dashes', 'ellipsis', 'pandoc', 'quarto'],
  },
  {
    key: 'preview.math',
    kind: 'boolean',
    default: true,
    label: 'Render math',
    description: 'Off: math shows as its source text.',
    category: 'preview',
    keywords: ['math', 'latex', 'katex', 'equations', 'formulas'],
  },
  {
    key: 'preview.remoteImages',
    kind: 'boolean',
    default: true,
    label: 'Load remote images',
    description: 'Off: images from the web are not requested and show a placeholder.',
    category: 'preview',
    keywords: ['images', 'remote', 'network', 'privacy', 'web', 'download'],
  },
  {
    key: 'preview.codeCards',
    kind: 'choice',
    default: 'dark',
    choices: [
      { value: 'dark', label: 'Dark' },
      { value: 'light', label: 'Light' },
    ],
    label: 'Code blocks',
    description: 'The look of code blocks in the preview.',
    category: 'preview',
    keywords: ['code', 'cards', 'blocks', 'dark', 'light', 'syntax'],
  },
  {
    key: 'export.pandocPath',
    kind: 'path',
    default: null,
    label: 'Pandoc',
    description: 'The Pandoc used to export Word documents. Empty: Writedown looks for one.',
    category: 'preview',
    keywords: ['pandoc', 'export', 'word', 'docx', 'path', 'rstudio'],
  },

  // ---- Accessibility ----
  {
    key: 'a11y.dyslexia',
    kind: 'boolean',
    default: false,
    label: 'Dyslexia-friendly reading',
    description: 'Use a dyslexia-friendly typeface and wider spacing in the preview.',
    category: 'accessibility',
    keywords: ['dyslexia', 'dyslexic', 'reading', 'spacing', 'typeface', 'font'],
  },
  {
    key: 'a11y.dyslexiaFont',
    kind: 'choice',
    default: 'opendyslexic',
    choices: [
      { value: 'opendyslexic', label: 'OpenDyslexic' },
      { value: 'atkinson', label: 'Atkinson Hyperlegible' },
      { value: 'lexend', label: 'Lexend' },
    ],
    label: 'Dyslexia-friendly typeface',
    description: 'The typeface used when dyslexia-friendly reading is on.',
    category: 'accessibility',
    keywords: ['dyslexia', 'font', 'opendyslexic', 'atkinson', 'lexend'],
  },
  {
    key: 'a11y.ruler',
    kind: 'boolean',
    default: false,
    label: 'Reading ruler',
    description: 'A tinted band that follows the cursor line or the pointer.',
    category: 'accessibility',
    keywords: ['ruler', 'reading', 'guide', 'line', 'tint', 'band'],
  },
  {
    key: 'a11y.rulerTint',
    kind: 'choice',
    default: 'yellow',
    choices: [
      { value: 'yellow', label: 'Yellow' },
      { value: 'blue', label: 'Blue' },
      { value: 'green', label: 'Green' },
      { value: 'pink', label: 'Pink' },
    ],
    label: 'Ruler color',
    description: 'The tint of the reading ruler.',
    category: 'accessibility',
    keywords: ['ruler', 'color', 'tint', 'yellow', 'blue', 'green', 'pink'],
  },
  {
    key: 'a11y.spotlight',
    kind: 'boolean',
    default: false,
    label: 'Focus-line spotlight',
    description: 'In the editor, dim every block except the one with the cursor.',
    category: 'accessibility',
    keywords: ['focus', 'spotlight', 'dim', 'distraction', 'highlight'],
  },
  {
    key: 'a11y.reduceMotion',
    kind: 'choice',
    default: 'system',
    choices: TRI_STATE('Follow macOS'),
    label: 'Reduce motion',
    description: 'Turn off animations and smooth scrolling.',
    category: 'accessibility',
    keywords: ['motion', 'animation', 'transitions', 'smooth', 'vestibular'],
  },
  {
    key: 'a11y.highContrast',
    kind: 'choice',
    default: 'system',
    choices: TRI_STATE('Follow macOS'),
    label: 'High-contrast dividers',
    description: 'Draw borders and dividers with stronger contrast.',
    category: 'accessibility',
    keywords: ['contrast', 'borders', 'dividers', 'increase contrast', 'outline'],
  },
  {
    key: 'a11y.scale',
    kind: 'number',
    default: 1,
    min: 1,
    max: 1.5,
    step: 0.1,
    label: 'Interface scale',
    description: 'Enlarge the controls of the window. Document text follows the zoom instead.',
    category: 'accessibility',
    keywords: ['scale', 'zoom', 'larger', 'bigger', 'interface', 'size', 'controls'],
  },

  // ---- Files & Saving ----
  {
    key: 'saving.autoSave',
    kind: 'boolean',
    default: false,
    label: 'Save automatically',
    description: 'Save changes to a file shortly after you stop typing.',
    category: 'saving',
    keywords: ['autosave', 'auto save', 'save', 'automatic'],
  },
  {
    key: 'saving.newLineEnding',
    kind: 'choice',
    default: 'lf',
    choices: [
      { value: 'lf', label: 'LF (macOS and Linux)' },
      { value: 'crlf', label: 'CRLF (Windows)' },
    ],
    label: 'Line endings for new files',
    description: 'Used for new documents. Existing files keep theirs.',
    category: 'saving',
    keywords: ['line endings', 'newline', 'lf', 'crlf', 'windows', 'eol'],
  },
  {
    key: 'saving.newFinalNewline',
    kind: 'boolean',
    default: false,
    label: 'End new files with a newline',
    description: 'Add a final line break when a new document is saved.',
    category: 'saving',
    keywords: ['final newline', 'trailing', 'end of file', 'eof'],
  },
  {
    key: 'saving.defaultFolder',
    kind: 'path',
    default: null,
    label: 'Default save folder',
    description: 'Where the Save dialog starts for a new document. Empty: the last folder used.',
    category: 'saving',
    keywords: ['folder', 'save', 'location', 'directory', 'default'],
  },
  {
    key: 'files.ignore',
    kind: 'list',
    default: ['node_modules', '_site', '_freeze', 'renv', 'venv', '__pycache__'],
    label: 'Ignored names',
    description: 'Files and folders with these names are left out of the Files tab and search.',
    category: 'saving',
    keywords: ['ignore', 'exclude', 'hidden', 'node_modules', 'files', 'search'],
  },
];

/** The meta of one setting by key path, or undefined. */
export function settingMeta(key: string): SettingMeta | undefined {
  return SETTINGS_META.find((meta) => meta.key === key);
}

/** The settings of one category, in table order. */
export function settingsIn(category: SettingCategory): SettingMeta[] {
  return SETTINGS_META.filter((meta) => meta.category === category);
}

/** The settings whose label, description, keywords or category match every word of `query`. */
export function searchSettings(query: string): SettingMeta[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...SETTINGS_META];
  return SETTINGS_META.filter((meta) => {
    const category = SETTING_CATEGORIES.find((entry) => entry.id === meta.category)?.label ?? '';
    const haystack = [meta.label, meta.description, category, ...meta.keywords]
      .join(' ')
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
