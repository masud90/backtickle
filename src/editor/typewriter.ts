/**
 * Typewriter scrolling (`editor.typewriter`, Phase 5): after the cursor moves, the line it is on is
 * scrolled to the vertical center of the editor. Loaded on demand by the controller, so a document
 * without the setting never pays for it.
 *
 * - The centering is CodeMirror's own `scrollIntoView` effect with `y: 'center'`, added to every
 *   transaction that moves the cursor or edits the text, so typing, Return, arrow keys, undo and
 *   jumps (find, outline) all land the line in the middle. A click with the mouse does not.
 * - Wheel and trackpad scrolling change no transaction, so they stay free until the next cursor move.
 * - The scrolling is a direct `scrollTop` change, never animated: nothing here needs Reduce motion.
 * - Bottom padding of half the editor height lets the last line reach the center. The height comes
 *   from a CSS variable set through the CSSOM (the CSP forbids `style` attributes in markup).
 */
import { EditorState, type Extension, Transaction } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

/** Whether a transaction should bring the cursor line to the center. */
export function wantsCentering(tr: Transaction): boolean {
  if (!tr.selection && !tr.docChanged) return false;
  // A click puts the cursor where the pointer is; moving the text under it would be disorienting.
  if (tr.isUserEvent('select.pointer')) return false;
  if (tr.annotation(Transaction.remote)) return false;
  return true;
}

const center = EditorState.transactionExtender.of((tr) => {
  if (!wantsCentering(tr)) return null;
  const head = tr.newSelection.main.head;
  return { effects: EditorView.scrollIntoView(head, { y: 'center' }) };
});

/** Keeps `--wd-typewriter-pad` at half the height of the scroller. */
const padding = ViewPlugin.fromClass(
  class {
    private height = -1;
    private readonly view: EditorView;

    constructor(view: EditorView) {
      this.view = view;
      this.apply();
    }

    update(update: ViewUpdate): void {
      if (update.geometryChanged || update.viewportChanged) this.apply();
    }

    private apply(): void {
      const height = this.view.scrollDOM.clientHeight;
      if (height === this.height) return;
      this.height = height;
      this.view.dom.style.setProperty('--wd-typewriter-pad', `${Math.round(height / 2)}px`);
    }

    destroy(): void {
      this.view.dom.style.removeProperty('--wd-typewriter-pad');
    }
  },
);

const theme = EditorView.theme({
  '.cm-content': { paddingBottom: 'var(--wd-typewriter-pad, 50vh)' },
});

export const typewriterExtension: Extension = [center, padding, theme];
