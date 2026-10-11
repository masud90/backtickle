/**
 * Find in Preview mode: Edit > Find while the preview has the focus
 * opens a find bar over the preview pane. The editor keeps its own find bar.
 */
import type { Shell } from '@/shell/shell.svelte';
import { PreviewFindBar } from './bar';

let bar: PreviewFindBar | undefined;

/** Text selected in the preview, if it is short and on one line: it becomes the query. */
function selectedText(scroller: HTMLElement): string {
  const selection = scroller.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode) return '';
  if (!scroller.contains(selection.anchorNode)) return '';
  const text = selection.toString();
  return text.length <= 200 && !text.includes('\n') ? text : '';
}

function ensure(shell: Shell): PreviewFindBar | null {
  const host = shell.previewFindHost();
  if (!host) return null;
  if (bar?.attached && bar.hostScroller === host.scroller) return bar;
  bar?.close();
  bar = new PreviewFindBar(host);
  return bar;
}

/** Edit > Find… while the Preview view is on show: open the find bar over the preview. */
export async function openPreviewFind(shell: Shell): Promise<void> {
  const opened = ensure(shell);
  if (!opened) {
    shell.showError('Nothing to search yet');
    return;
  }
  opened.focus(selectedText(opened.hostScroller));
}

/** Find Next and Find Previous in the preview (opens the bar when it is not open). */
export async function stepPreviewFind(shell: Shell, direction: 1 | -1): Promise<void> {
  if (!bar?.attached) {
    await openPreviewFind(shell);
    return;
  }
  bar.step(direction);
}
