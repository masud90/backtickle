/** Quick Open (WP3.3), built on `Picker.svelte`. */
import { mount, unmount } from 'svelte';
import { getFilesModel } from '../files/model.svelte';
import type { Shell } from '../shell.svelte';
import QuickOpen from './QuickOpen.svelte';

let shown = false;

/**
 * File > Quick Open…: pick a Markdown file of the open tabs, the recents or the open folder.
 * Returns when the picker is shown (the menu action must not wait for it to close).
 */
export async function openQuickOpen(shell: Shell): Promise<void> {
  if (shown) return;
  shown = true;
  const component = mount(QuickOpen, {
    target: document.body,
    props: {
      shell,
      folder: getFilesModel(shell).folder,
      onClose: () => {
        shown = false;
        void unmount(component);
      },
    },
  });
}
