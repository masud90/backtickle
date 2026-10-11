/**
 * Files sidebar and document file operations (WP3.2). The shell loads
 * this module only when a command runs; the panel and the model sit beside it.
 *
 * Signatures: each function takes the shell and resolves when the command is done.
 */
import { mount, unmount } from 'svelte';
import { errorMessage, fileName, isCancelled } from '../document';
import type { Shell } from '../shell.svelte';
import { tabIsDirty } from '../tab';
import { getFilesModel } from './model.svelte';
import RenameSheet from './RenameSheet.svelte';
import { finalName, nameProblem, parentPath } from './tree';

export { getFilesModel } from './model.svelte';

/** File > Open Folder…: choose a folder (`platform.folderDialog('open')`) and show it in Files. */
export async function openFolder(shell: Shell): Promise<void> {
  const folder = await shell.platform.folderDialog('open');
  if (!folder) return;
  await getFilesModel(shell).setFolder(folder, []);
  await shell.showSidebarTab('files');
}

/** Shows the rename sheet and resolves when it is closed. */
function showRenameSheet(
  title: string,
  value: string,
  kind: 'file' | 'folder',
  onSubmit: (typed: string) => Promise<string | null>,
): Promise<void> {
  return new Promise((resolve) => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const sheet = mount(RenameSheet, {
      target: document.body,
      props: {
        title,
        value,
        kind,
        onSubmit,
        onClose: () => {
          void unmount(sheet);
          previous?.focus();
          resolve();
        },
      },
    });
  });
}

/** File > Rename… for the active saved document. */
export async function renameActive(shell: Shell): Promise<void> {
  const tab = shell.active;
  const path = tab?.path;
  if (!path) return;
  await showRenameSheet('Rename', fileName(path), 'file', async (typed) => {
    const name = finalName(fileName(path), typed, 'file');
    const problem = nameProblem(name);
    if (problem) return problem;
    try {
      const next = await shell.platform.renamePath(path, name);
      const model = getFilesModel(shell);
      await model.pathMoved(path, next, true);
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  });
}

/** File > Move To… for the active saved document. */
export async function moveActive(shell: Shell): Promise<void> {
  const path = shell.active?.path;
  if (!path) return;
  try {
    const folder = await shell.platform.folderDialog('move');
    if (!folder) return;
    const next = await shell.platform.movePath(path, folder);
    await getFilesModel(shell).pathMoved(path, next, true);
  } catch (error) {
    if (!isCancelled(error)) shell.showError(errorMessage(error));
  }
}

/** File > Duplicate for the active saved document: the copy opens. */
export async function duplicateActive(shell: Shell): Promise<void> {
  const path = shell.active?.path;
  if (!path) return;
  try {
    const copy = await shell.platform.duplicatePath(path);
    await getFilesModel(shell).relist([parentPath(copy)]);
    await shell.openPaths([copy]);
  } catch (error) {
    if (!isCancelled(error)) shell.showError(errorMessage(error));
  }
}

/** File > Revert to Saved for the active saved document: asks first when it has changes. */
export async function revertActive(shell: Shell): Promise<void> {
  const tab = shell.active;
  if (!tab?.path) return;
  if (tabIsDirty(tab)) {
    const yes = await shell.platform.ask({
      title: `Revert "${tab.name}" to the saved version?`,
      message: 'Your unsaved changes will be lost.',
      ok: 'Revert',
      cancel: 'Cancel',
    });
    if (!yes) return;
  }
  try {
    await shell.revertTab(tab.id);
  } catch (error) {
    if (!isCancelled(error)) shell.showError(errorMessage(error));
  }
}
