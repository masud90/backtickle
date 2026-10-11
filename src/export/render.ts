/**
 * File > Render with Quarto. A lazy chunk. Unsaved changes are saved
 * first (the user is asked); then the backend opens the document in RStudio or runs the render in
 * Terminal. Writedown never runs the document's code itself.
 */

import type { Shell } from '@/shell/shell.svelte';
import { tabIsDirty } from '@/shell/tab';

export const RSTUDIO_NOTICE = 'Opened in RStudio. Press Render (⇧⌘K) there.';
export const TERMINAL_NOTICE = 'Rendering in Terminal.';

function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : 'The render could not be started.';
}

export async function renderWithQuarto(shell: Shell): Promise<void> {
  const tab = shell.active;
  if (!tab?.path || !/\.(qmd|rmd)$/i.test(tab.path)) return;
  try {
    if (tabIsDirty(tab)) {
      const save = await shell.platform.ask({
        title: `Save "${tab.name}" before rendering?`,
        message: 'Rendering uses the saved file. Your changes are saved first.',
        ok: 'Save and Render',
        cancel: 'Cancel',
      });
      if (!save) return;
      if (!(await shell.saveTab(tab.id, false))) return;
    }
    const path = shell.active?.path ?? tab.path;
    const target = await shell.platform.renderWithQuarto(path);
    shell.showNotice(target === 'rstudio' ? RSTUDIO_NOTICE : TERMINAL_NOTICE);
  } catch (error) {
    shell.showError(messageOf(error));
  }
}
