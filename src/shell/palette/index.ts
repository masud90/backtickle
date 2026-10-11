/** The command palette (WP3.3), built on `Picker.svelte` and the registry in `commands.ts`. */
import { mount, unmount } from 'svelte';
import type { Shell } from '../shell.svelte';
import Palette from './Palette.svelte';

let shown = false;

/**
 * View > Command Palette…: pick any enabled command of the registry. Returns when the palette is
 * shown (the menu action must not wait for it to close).
 */
export async function openPalette(shell: Shell): Promise<void> {
  if (shown) return;
  shown = true;
  const component = mount(Palette, {
    target: document.body,
    props: {
      shell,
      onClose: () => {
        shown = false;
        void unmount(component);
      },
    },
  });
}
