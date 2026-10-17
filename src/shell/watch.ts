/**
 * External-change detection (WP3.7). Not loaded at startup: the shell imports it
 * lazily when the watcher first reports a change.
 *
 * The shell sends the watch set (open documents, the linked files their previews fetched, the open
 * folder) and loads this module when the first `file-changed` batch arrives. The folder scope
 * belongs to the Files model, which lists the affected levels again.
 * Document scope: a clean document reloads silently with the caret and scroll kept by line; a
 * document with unsaved changes gets the "changed by another app" banner; a removed one is
 * marked missing. Linked scope: the preview fetches what it needs again and renders.
 */
import { samePath } from '@/lib/paths';
import type { FileChange } from '@/lib/platform';
import type { Shell } from './shell.svelte';

const MARKDOWN = /\.(md|markdown|mdown|mkd|mkdn|mdx|qmd|rmd|mmd)$/i;

/** Answers one batch of changes from the watcher. */
export function handleChanges(shell: Shell, changes: FileChange[]): void {
  const linked: string[] = [];
  let structural = false;
  for (const change of changes) {
    if (change.scope === 'document') {
      void shell.enqueue(() => documentChanged(shell, change));
    }
    if (change.scope === 'linked') linked.push(change.path);
    if (change.kind !== 'modified' && MARKDOWN.test(change.path)) structural = true;
  }
  if (linked.length > 0 || structural) {
    void shell.enqueue(() => shell.refreshLinked(linked, structural));
  }
}

async function documentChanged(shell: Shell, change: FileChange): Promise<void> {
  const tab = shell.tabs.find(
    (candidate) => candidate.path !== null && samePath(candidate.path, change.path),
  );
  if (!tab) return;
  if (change.kind === 'removed') {
    if (!tab.missing) shell.patchTab(tab.id, { missing: true });
    return;
  }
  let file: Awaited<ReturnType<typeof shell.platform.readDocument>>;
  try {
    file = await shell.platform.readDocument(change.path);
  } catch {
    return;
  }
  const edited = tab.textDirty || tab.format.lineEnding !== tab.savedLineEnding;
  const sameText = shell.tabText(tab.id) === file.text;
  if (!tab.missing && file.modifiedMs === tab.modifiedMs) return;
  if (!edited && sameText) {
    shell.patchTab(tab.id, {
      modifiedMs: file.modifiedMs,
      savedAtMs: file.modifiedMs,
      missing: false,
    });
    return;
  }
  if (!edited) {
    await shell.revertTab(tab.id, true);
    return;
  }
  if (sameText) {
    shell.patchTab(tab.id, { modifiedMs: file.modifiedMs, missing: false });
    return;
  }
  if (!tab.externalChange || tab.missing) {
    shell.patchTab(tab.id, { externalChange: true, missing: false });
  }
}
