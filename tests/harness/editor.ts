/**
 * A page for the editor tests in tests/ui/editor*.spec.ts: the controller alone on a plain page,
 * with the design tokens and fonts but no shell around it. Vite serves it in dev mode at
 * /tests/harness/editor.html, and the tests drive the controller through `window.__editor`.
 */
import { EditorController, type EditorSelectionInfo } from '@/editor/controller';
import '@/styles/tokens.css';
import '@/styles/fonts';

/** What the controller reported, for the tests to read back. */
interface HarnessEvents {
  changes: number;
  scrolls: number;
  selections: EditorSelectionInfo[];
}

declare global {
  interface Window {
    __editor: EditorController;
    __events: HarnessEvents;
    /** True once the fonts are loaded, so line wrapping is final. */
    __ready: boolean;
  }
}

const host = document.getElementById('host');
if (!host) throw new Error('The harness page needs a #host element.');

const events: HarnessEvents = { changes: 0, scrolls: 0, selections: [] };

const editor = new EditorController({
  parent: host,
  doc: '',
  onChange: () => {
    events.changes++;
  },
  onCursor: () => {},
});
editor.onScroll(() => {
  events.scrolls++;
});
editor.onSelection((info) => {
  events.selections.push(info);
});

window.__editor = editor;
window.__events = events;
void document.fonts.ready.then(() => {
  window.__ready = true;
});
