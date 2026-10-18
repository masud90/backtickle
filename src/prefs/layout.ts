/**
 * How the settings of each category are grouped into cards, and which control a setting gets
 * where the kind alone does not decide. Anything in `SETTINGS_META` that is not listed here
 * lands in a final "More" card, so a new setting shows up without UI code.
 */
import type { SettingCategory, SettingMeta } from '@/lib/settings-meta';
import { settingsIn } from '@/lib/settings-meta';

export interface CardLayout {
  title: string;
  keys: string[];
}

export const CARDS: Record<SettingCategory, CardLayout[]> = {
  general: [
    { title: 'Appearance', keys: ['appearance', 'vibrancy'] },
    {
      title: 'Opening documents',
      keys: ['openExistingIn', 'openNewIn', 'restoreSession', 'recentLimit'],
    },
    { title: 'Reading time', keys: ['readingWpm'] },
  ],
  editor: [
    { title: 'Typeface', keys: ['editor.fontFamily', 'editor.fontSize', 'editor.lineHeight'] },
    {
      title: 'Writing',
      keys: [
        'editor.tabSize',
        'editor.insertSpaces',
        'editor.softWrap',
        'editor.spellcheck',
        'editor.autoPair',
        'editor.continueLists',
        'editor.typewriter',
        'editor.livePreview',
      ],
    },
    {
      title: 'Display',
      keys: ['editor.lineNumbers', 'editor.currentLine', 'editor.paneHeaders'],
    },
  ],
  preview: [
    { title: 'Flavor', keys: ['defaultFlavor', 'preview.autoDetectFlavor'] },
    {
      title: 'Reading',
      keys: ['preview.font', 'preview.fontSize', 'preview.columnWidth', 'preview.codeCards'],
    },
    {
      title: 'Syntax',
      keys: [
        'preview.hashtagPills',
        'preview.obsidianCommentsDimmed',
        'preview.smartPunctuation',
        'preview.math',
      ],
    },
    { title: 'Images', keys: ['preview.remoteImages'] },
    { title: 'Export', keys: ['export.pandocPath'] },
  ],
  accessibility: [
    {
      title: 'Typography and legibility',
      keys: [
        'a11y.dyslexia',
        'a11y.dyslexiaFont',
        'a11y.ruler',
        'a11y.rulerTint',
        'a11y.spotlight',
      ],
    },
    { title: 'Motion and contrast', keys: ['a11y.reduceMotion', 'a11y.highContrast'] },
    { title: 'Interface', keys: ['a11y.scale'] },
  ],
  saving: [
    {
      title: 'Saving',
      keys: [
        'saving.autoSave',
        'saving.newLineEnding',
        'saving.newFinalNewline',
        'saving.defaultFolder',
      ],
    },
    { title: 'Folders', keys: ['files.ignore'] },
  ],
};

export interface Card {
  title: string;
  settings: SettingMeta[];
}

/** The cards of one category, from the table: listed keys first, then any unlisted ones. */
export function cardsFor(category: SettingCategory): Card[] {
  const all = settingsIn(category);
  const used = new Set<string>();
  const cards: Card[] = [];
  for (const layout of CARDS[category]) {
    const settings = layout.keys
      .map((key) => all.find((meta) => meta.key === key))
      .filter((meta): meta is SettingMeta => meta !== undefined);
    for (const meta of settings) used.add(meta.key);
    if (settings.length > 0) cards.push({ title: layout.title, settings });
  }
  const rest = all.filter((meta) => !used.has(meta.key));
  if (rest.length > 0) cards.push({ title: 'More', settings: rest });
  return cards;
}

/** Settings shown as a slider (a range with a shown value). */
export const SLIDER_KEYS: ReadonlySet<string> = new Set([
  'preview.fontSize',
  'preview.columnWidth',
  'a11y.scale',
]);

/** Choices shown as round color swatches. */
export const SWATCH_KEYS: ReadonlySet<string> = new Set(['a11y.rulerTint']);

/** The one-line description under each category title. */
export const CATEGORY_DESCRIPTIONS: Record<SettingCategory | 'shortcuts', string> = {
  general: 'How Backtickle looks, opens documents and counts reading time.',
  editor: 'The typeface and behavior of the Markdown editor.',
  preview: 'How the preview renders your documents and which Markdown flavor applies.',
  accessibility: 'Reading comfort, motion and contrast, and the size of the interface.',
  saving: 'When and how files are saved, and which folders Backtickle skips.',
  shortcuts: 'Every keyboard shortcut of the menus and the editor. Choose Change to set your own.',
};
