/** Smart paste (handler in `handler.ts`) and Paste and Match Style. */
import { EditorView } from '@codemirror/view';
import { getPlatform } from '@/lib/platform';
import type { Shell } from '@/shell/shell.svelte';

/** Edit > Paste and Match Style: paste the clipboard as plain text (`platform.readClipboardText`). */
export async function pastePlain(shell: Shell): Promise<void> {
  try {
    const platform = await getPlatform();
    const text = await platform.readClipboardText();
    const content = document.querySelector('.cm-content');
    const view = content instanceof HTMLElement ? EditorView.findFromDOM(content) : null;
    if (!view || view.state.readOnly || text === '') return;
    view.dispatch(
      view.state.update(view.state.replaceSelection(text), {
        userEvent: 'input.paste',
        scrollIntoView: true,
      }),
    );
    view.focus();
  } catch {
    shell.showError('Could not read the clipboard.');
  }
}
