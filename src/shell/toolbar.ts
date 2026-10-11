/** What the toolbar offers. Every button runs the menu action of the same name. */
import type { MenuAction, ViewMode } from '@/lib/platform';
import type { IconName } from '@/shell/icons';

export interface ToolbarButton {
  action: MenuAction;
  /** The accessible name; also the first words of the tooltip. */
  label: string;
  /** The shortcut shown in the tooltip, as the menu shows it. */
  shortcut?: string;
  /** An icon, or the text of a type-styled button (B, I, S). */
  icon?: IconName;
  glyph?: 'bold' | 'italic' | 'strike';
}

/** Buttons before the Heading menu. */
export const TEXT_BUTTONS: readonly ToolbarButton[] = [
  { action: 'bold', label: 'Bold', shortcut: '⌘B', glyph: 'bold' },
  { action: 'italic', label: 'Italic', shortcut: '⌘I', glyph: 'italic' },
  { action: 'strikethrough', label: 'Strikethrough', shortcut: '⇧⌘X', glyph: 'strike' },
  { action: 'code', label: 'Inline Code', shortcut: '⌘E', icon: 'code' },
];

/** Buttons after the Heading menu, in groups separated by a divider. */
export const BLOCK_GROUPS: readonly (readonly ToolbarButton[])[] = [
  [
    { action: 'quote', label: 'Quote', shortcut: '⇧⌘.', icon: 'format-quote' },
    { action: 'rule', label: 'Horizontal Rule', icon: 'horizontal-rule' },
  ],
  [
    {
      action: 'bullet-list',
      label: 'Bulleted List',
      shortcut: '⇧⌘8',
      icon: 'format-list-bulleted',
    },
    {
      action: 'numbered-list',
      label: 'Numbered List',
      shortcut: '⇧⌘7',
      icon: 'format-list-numbered',
    },
    { action: 'task-list', label: 'Task List', shortcut: '⇧⌘9', icon: 'check-box' },
  ],
  [
    { action: 'link', label: 'Link', shortcut: '⌘K', icon: 'link' },
    { action: 'image', label: 'Image', icon: 'image' },
    { action: 'code-block', label: 'Code Block', icon: 'code-blocks' },
    { action: 'table', label: 'Table', icon: 'table-chart' },
  ],
];

export interface HeadingEntry {
  action: MenuAction;
  label: string;
  shortcut: string;
}

/** The Heading menu: Paragraph, then Heading 1 to 6 (Option-Command-0 to 6, as in the menu bar). */
export const HEADING_ENTRIES: readonly HeadingEntry[] = [
  { action: 'paragraph', label: 'Paragraph', shortcut: '⌥⌘0' },
  { action: 'heading-1', label: 'Heading 1', shortcut: '⌥⌘1' },
  { action: 'heading-2', label: 'Heading 2', shortcut: '⌥⌘2' },
  { action: 'heading-3', label: 'Heading 3', shortcut: '⌥⌘3' },
  { action: 'heading-4', label: 'Heading 4', shortcut: '⌥⌘4' },
  { action: 'heading-5', label: 'Heading 5', shortcut: '⌥⌘5' },
  { action: 'heading-6', label: 'Heading 6', shortcut: '⌥⌘6' },
];

export interface ViewButton {
  mode: ViewMode;
  label: string;
  shortcut: string;
  icon: IconName;
}

export const VIEW_BUTTONS: readonly ViewButton[] = [
  { mode: 'editor', label: 'Editor', shortcut: '⌘1', icon: 'edit-note' },
  { mode: 'split', label: 'Split', shortcut: '⌘2', icon: 'vertical-split' },
  { mode: 'preview', label: 'Preview', shortcut: '⌘3', icon: 'visibility' },
];

/** The tooltip of a button: its name, and the shortcut in parentheses when it has one. */
export function tooltip(label: string, shortcut?: string): string {
  return shortcut ? `${label} (${shortcut})` : label;
}

/** The next index of a roving group for an arrow key, wrapping; null for other keys. */
export function rovingIndex(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
