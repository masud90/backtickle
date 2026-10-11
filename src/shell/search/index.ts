/** Search across the open folder (WP3.3). */
import type { Shell } from '../shell.svelte';
import { getSearchModel } from './model.svelte';

/** Edit > Find > Search in Folder…: show the Search tab and focus its query field. */
export async function showSearch(shell: Shell): Promise<void> {
  await shell.showSidebarTab('search');
  getSearchModel(shell).focusPending = true;
}
