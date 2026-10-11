/**
 * The session (WP3.7): the documents with their views, the active one, the folder, the
 * sidebar tab and the expanded folders, stored on quit and reopened at the next launch. Not loaded
 * at startup unless a session is to be restored.
 */
import type { Session, SessionTab } from '@/lib/platform';
import type { Shell } from './shell.svelte';

/** Reopens the saved session; false when there was nothing to restore. */
export async function restoreSession(shell: Shell): Promise<boolean> {
  let session: Session | null;
  try {
    session = await shell.platform.getSession();
  } catch {
    return false;
  }
  if (!session) return false;
  const tabs = session.tabs.filter((tab) => typeof tab.path === 'string' && tab.path !== '');
  const windows = session.windows ?? [];
  if (tabs.length === 0 && !session.folder && windows.length === 0) return false;
  shell.setSidebarTab(session.sidebarTab);
  if (tabs.length > 0) await shell.openSessionTabs(tabs, session.active);
  if (session.folder) {
    const { getFilesModel } = await import('./files/model.svelte');
    await getFilesModel(shell).setFolder(session.folder, session.expanded ?? []);
  }
  // The other windows of the session open where they were (Rust reads the stored session).
  if (windows.length > 0) await shell.platform.restoreWindows().catch(() => []);
  return true;
}

/** Saves the session (open documents, active tab, folder, sidebar tab, expanded folders). */
export async function saveSession(shell: Shell): Promise<void> {
  const saved = shell.tabs.filter((tab) => tab.path !== null && !tab.guide);
  const tabs: SessionTab[] = saved.map((tab) => ({ path: tab.path as string, view: tab.view }));
  const activePath = shell.active?.path ?? null;
  const index = saved.findIndex((tab) => tab.path === activePath);
  const folder = shell.isMain ? (shell.openFolderPath ?? shell.launch.folderPath ?? null) : null;
  let expanded: string[] = [];
  if (folder) {
    const { existingFilesModel } = await import('./files/model.svelte');
    expanded = existingFilesModel(shell)?.expandedFolders() ?? [];
  }
  await shell.platform.setSession({
    tabs,
    active: index >= 0 ? index : 0,
    folder,
    sidebarTab: shell.sidebarTab,
    expanded,
  });
}
