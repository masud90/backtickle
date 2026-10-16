/**
 * The menu actions with their labels, enabling rules and shortcuts (labels and accelerators as in
 * `src-tauri/src/menu_spec.rs`; `tests/unit/prefs-shortcuts.test.ts` compares the two). Plain
 * data with no imports, so the Preferences window can list the shortcuts without loading the
 * command registry.
 */
import type { MenuAction } from '@/lib/platform';

/** What a command needs in order to be enabled. Same names as `Need` in `menu_spec.rs`. */
export type Need =
  | 'always'
  | 'window'
  | 'document'
  | 'can-save'
  | 'editor'
  | 'tabs'
  | 'saved-document'
  | 'can-export-docx'
  | 'can-exact-preview'
  | 'can-render';

export type Spec = readonly [label: string, need: Need, shortcut?: string];

/** Labels, shortcuts and enabling of every menu action (labels as in `menu_spec.rs`). */
export const SPECS: Record<MenuAction, Spec> = {
  new: ['New', 'always', '⌘N'],
  open: ['Open…', 'always', '⌘O'],
  'open-folder': ['Open Folder…', 'always', '⌥⌘O'],
  'quick-open': ['Quick Open…', 'always', '⇧⌘O'],
  'close-tab': ['Close Tab', 'window', '⌘W'],
  'close-window': ['Close Window', 'window', '⇧⌘W'],
  save: ['Save', 'can-save', '⌘S'],
  'save-as': ['Save As…', 'document', '⇧⌘S'],
  duplicate: ['Duplicate', 'saved-document'],
  rename: ['Rename…', 'saved-document'],
  'move-to': ['Move To…', 'saved-document'],
  revert: ['Revert to Saved', 'saved-document'],
  'export-html': ['Export as HTML…', 'document'],
  'export-docx': ['Export as Word Document…', 'can-export-docx'],
  'export-pdf': ['Export as PDF…', 'document', '⌥⌘P'],
  print: ['Print…', 'document', '⌘P'],
  'reveal-in-finder': ['Reveal in Finder', 'document'],
  undo: ['Undo', 'document', '⌘Z'],
  redo: ['Redo', 'document', '⇧⌘Z'],
  'copy-html': ['Copy as HTML', 'saved-document'],
  'paste-plain': ['Paste and Match Style', 'editor', '⌥⇧⌘V'],
  find: ['Find…', 'document', '⌘F'],
  'find-replace': ['Find and Replace…', 'document', '⌥⌘F'],
  'find-next': ['Find Next', 'document', '⌘G'],
  'find-previous': ['Find Previous', 'document', '⇧⌘G'],
  'search-folder': ['Search in Folder…', 'always', '⇧⌘F'],
  bold: ['Bold', 'editor', '⌘B'],
  italic: ['Italic', 'editor', '⌘I'],
  strikethrough: ['Strikethrough', 'editor', '⇧⌘X'],
  code: ['Inline Code', 'editor', '⌘E'],
  link: ['Link…', 'editor', '⌘K'],
  image: ['Image', 'editor'],
  quote: ['Quote', 'editor', '⇧⌘.'],
  'bullet-list': ['Bulleted List', 'editor', '⇧⌘8'],
  'numbered-list': ['Numbered List', 'editor', '⇧⌘7'],
  'task-list': ['Task List', 'editor', '⇧⌘9'],
  'code-block': ['Code Block', 'editor'],
  table: ['Table', 'editor'],
  rule: ['Horizontal Rule', 'editor'],
  'heading-1': ['Heading 1', 'editor', '⌥⌘1'],
  'heading-2': ['Heading 2', 'editor', '⌥⌘2'],
  'heading-3': ['Heading 3', 'editor', '⌥⌘3'],
  'heading-4': ['Heading 4', 'editor', '⌥⌘4'],
  'heading-5': ['Heading 5', 'editor', '⌥⌘5'],
  'heading-6': ['Heading 6', 'editor', '⌥⌘6'],
  paragraph: ['Paragraph', 'editor', '⌥⌘0'],
  'command-palette': ['Command Palette…', 'always', '⇧⌘P'],
  'view-editor': ['View: Editor', 'document', '⌘1'],
  'view-split': ['View: Split', 'document', '⌘2'],
  'view-preview': ['View: Preview', 'document', '⌘3'],
  'toggle-sidebar': ['Show or Hide Sidebar', 'window', '^⌘S'],
  'toggle-sync-scroll': ['Sync Scroll', 'document'],
  'toggle-typewriter': ['Typewriter Scrolling', 'document'],
  'toggle-live-preview': ['Live Preview in Editor', 'document'],
  'render-quarto': ['Render with Quarto…', 'can-render'],
  'toggle-exact-preview': ['Exact Preview (Pandoc)', 'can-exact-preview'],
  'zoom-in': ['Zoom In', 'document', '⌘='],
  'zoom-out': ['Zoom Out', 'document', '⌘-'],
  'zoom-reset': ['Actual Size', 'document', '⌘0'],
  'next-tab': ['Show Next Tab', 'tabs', '^Tab'],
  'previous-tab': ['Show Previous Tab', 'tabs', '^⇧Tab'],
  'move-tab-to-new-window': ['Move Tab to New Window', 'tabs'],
  'markdown-guide': ['Markdown Guide', 'always'],
};
