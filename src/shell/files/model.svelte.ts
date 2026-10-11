/**
 * The state and the operations of the Files sidebar. One model per window (`getFilesModel`); it
 * outlives the panel, so the open folder and the expanded folders survive a switch of tab.
 */
import type { FileChange } from '@/lib/platform';
import { errorMessage, fileName, isCancelled } from '../document';
import type { Shell } from '../shell.svelte';
import {
  ancestorsBelow,
  flattenTree,
  isUnder,
  type Level,
  nextNewName,
  parentPath,
  type Row,
  remapPath,
  sortEntries,
} from './tree';

/** An inline rename in progress. */
export interface Renaming {
  path: string;
  kind: 'folder' | 'file';
  /** Created a moment ago; cancelling keeps the item. */
  isNew: boolean;
  error: string | null;
}

const models = new WeakMap<Shell, FilesModel>();

export function getFilesModel(shell: Shell): FilesModel {
  let model = models.get(shell);
  if (!model) {
    model = new FilesModel(shell);
    models.set(shell, model);
  }
  return model;
}

/** The model of the window if the Files panel (or a session restore) already created it. */
export function existingFilesModel(shell: Shell): FilesModel | undefined {
  return models.get(shell);
}

export class FilesModel {
  readonly shell: Shell;
  /** The open folder, or null. */
  folder = $state<string | null>(null);
  levels = $state.raw<ReadonlyMap<string, Level>>(new Map());
  expanded = $state.raw<ReadonlySet<string>>(new Set());
  loading = $state.raw<ReadonlySet<string>>(new Set());
  /** The row with the focus (a path). */
  focused = $state<string | null>(null);
  renaming = $state.raw<Renaming | null>(null);
  /** A plain-language message about the folder (it could not be listed). */
  error = $state<string | null>(null);
  readonly rows: Row[] = $derived(
    this.folder ? flattenTree(this.folder, this.levels, this.expanded, this.loading) : [],
  );
  readonly truncated: boolean = $derived(
    [...this.levels.values()].some((level) => level.truncated),
  );
  private stopWatching: (() => void) | null = null;
  private generation = 0;

  constructor(shell: Shell) {
    this.shell = shell;
    const launched = shell.launch.folderPath;
    if (launched) void this.setFolder(launched, []);
    void shell.platform
      .onFileChanged((changes) => void this.onChanges(changes))
      .then((stop) => {
        this.stopWatching = stop;
      })
      .catch(() => {});
  }

  destroy(): void {
    this.stopWatching?.();
    this.stopWatching = null;
  }

  // ---- the folder and its levels --------------------------------------------------------------

  /** Shows `folder` (already granted) with these folders expanded (the session, WP3.7). */
  async setFolder(folder: string, expanded: readonly string[]): Promise<void> {
    const clean = folder.length > 1 ? folder.replace(/\/$/, '') : folder;
    this.generation++;
    this.folder = clean;
    this.levels = new Map();
    this.expanded = new Set(expanded);
    this.loading = new Set();
    this.focused = null;
    this.renaming = null;
    this.error = null;
    this.shell.openFolderPath = clean;
    await this.load(clean);
    await this.loadMany(expanded.filter((path) => path !== clean));
  }

  /** The expanded folders, for the session. */
  expandedFolders(): string[] {
    return [...this.expanded];
  }

  async load(path: string): Promise<void> {
    await this.loadMany([path]);
  }

  /**
   * Lists these folders and commits all the results at once (one rebuild of the rows, not one per
   * folder: restoring 40 expanded folders used to rebuild a 2,000-row list 80 times).
   */
  async loadMany(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    const generation = this.generation;
    const platform = this.shell.platform;
    const loading = new Set(this.loading);
    for (const path of paths) loading.add(path);
    this.loading = loading;
    const results = await Promise.all(
      paths.map(async (path) => {
        try {
          return { path, listing: await platform.listFolder(path), error: null as unknown };
        } catch (error) {
          return { path, listing: null, error };
        }
      }),
    );
    if (generation !== this.generation) return;
    const levels = new Map(this.levels);
    const expanded = new Set(this.expanded);
    let expandedChanged = false;
    let levelsChanged = false;
    for (const { path, listing, error } of results) {
      if (listing) {
        levels.set(path, { entries: sortEntries(listing.entries), truncated: listing.truncated });
        levelsChanged = true;
        if (path === this.folder) this.error = null;
      } else if (path === this.folder) {
        this.error = `The folder could not be read. ${errorMessage(error)}`;
      } else {
        // A folder that went away: drop it from the tree.
        if (expanded.delete(path)) expandedChanged = true;
        if (levels.delete(path)) levelsChanged = true;
      }
    }
    if (levelsChanged) this.levels = levels;
    if (expandedChanged) this.expanded = expanded;
    const rest = new Set(this.loading);
    for (const path of paths) rest.delete(path);
    this.loading = rest;
  }

  /** Lists these folders again (only those that are loaded). */
  async relist(paths: Iterable<string>): Promise<void> {
    const wanted = new Set<string>();
    for (const path of paths) if (this.levels.has(path)) wanted.add(path);
    await this.loadMany([...wanted]);
  }

  async expand(path: string): Promise<void> {
    if (this.expanded.has(path)) return;
    this.expanded = new Set(this.expanded).add(path);
    if (!this.levels.has(path)) await this.load(path);
  }

  collapse(path: string): void {
    if (!this.expanded.has(path)) return;
    const next = new Set(this.expanded);
    next.delete(path);
    this.expanded = next;
  }

  async toggle(path: string): Promise<void> {
    if (this.expanded.has(path)) this.collapse(path);
    else await this.expand(path);
  }

  /** Expands the folders above a file so its row exists (the active document is revealed). */
  async reveal(path: string): Promise<boolean> {
    const root = this.folder;
    if (!root || !isUnder(path, root) || path === root) return false;
    for (const folder of ancestorsBelow(root, path)) await this.expand(folder);
    return true;
  }

  // ---- changes made elsewhere -------------------------------------------------------------------

  private async onChanges(changes: FileChange[]): Promise<void> {
    const root = this.folder;
    if (!root) return;
    const parents = new Set<string>();
    for (const change of changes) {
      if (change.scope !== 'folder' || !isUnder(change.path, root)) continue;
      parents.add(parentPath(change.path));
      if (change.kind === 'removed') this.forget(change.path);
    }
    await this.relist(parents);
  }

  /** Drops what the tree remembers below a path that no longer exists. */
  private forget(path: string): void {
    const levels = new Map(this.levels);
    for (const key of levels.keys()) if (isUnder(key, path)) levels.delete(key);
    this.levels = levels;
    const expanded = new Set(this.expanded);
    for (const key of expanded) if (isUnder(key, path)) expanded.delete(key);
    this.expanded = expanded;
  }

  /** A folder was renamed or moved: its expanded state and loaded levels follow. */
  private remap(oldPath: string, newPath: string): void {
    const levels = new Map<string, Level>();
    for (const [key, level] of this.levels) {
      if (isUnder(key, oldPath)) levels.set(remapPath(key, oldPath, newPath), level);
      else levels.set(key, level);
    }
    this.levels = levels;
    const expanded = new Set<string>();
    for (const key of this.expanded) expanded.add(remapPath(key, oldPath, newPath));
    this.expanded = expanded;
    if (this.focused) this.focused = remapPath(this.focused, oldPath, newPath);
  }

  // ---- operations -------------------------------------------------------------------------------

  /** The folder a New File or New Folder goes into: the focused folder, the folder of the focused file, or the root. */
  targetFolder(path: string | null = this.focused): string | null {
    if (!this.folder) return null;
    if (!path || path === this.folder) return this.folder;
    const row = this.rows.find((candidate) => candidate.path === path);
    if (!row) return this.folder;
    return row.kind === 'folder' ? row.path : row.parent;
  }

  private async makeItem(kind: 'file' | 'folder', inFolder: string | null): Promise<void> {
    const folder = inFolder ?? this.targetFolder();
    if (!folder) return;
    const platform = this.shell.platform;
    try {
      if (!this.levels.has(folder)) await this.load(folder);
      if (folder !== this.folder) await this.expand(folder);
      const taken = (this.levels.get(folder)?.entries ?? []).map((entry) => entry.name);
      const path =
        kind === 'file'
          ? await platform.createFile(folder, nextNewName(taken, 'Untitled', '.md'))
          : await platform.createFolder(folder, nextNewName(taken, 'Untitled Folder', ''));
      await this.load(folder);
      this.focused = path;
      if (kind === 'file') {
        await this.shell.enqueue(() => this.shell.openInSplit(path));
      }
      this.renaming = { path, kind, isNew: true, error: null };
    } catch (error) {
      if (!isCancelled(error)) this.shell.showError(errorMessage(error));
    }
  }

  newFile(inFolder: string | null = null): Promise<void> {
    return this.makeItem('file', inFolder);
  }

  newFolder(inFolder: string | null = null): Promise<void> {
    return this.makeItem('folder', inFolder);
  }

  startRename(path: string): void {
    const row = this.rows.find((candidate) => candidate.path === path);
    if (!row) return;
    this.focused = path;
    this.renaming = { path, kind: row.kind, isNew: false, error: null };
  }

  cancelRename(): void {
    this.renaming = null;
  }

  /** Renames `path`; resolves to an error message when the platform refuses (the field stays open). */
  async rename(path: string, name: string): Promise<string | null> {
    const platform = this.shell.platform;
    try {
      const next = await platform.renamePath(path, name);
      await this.pathMoved(path, next);
      this.renaming = null;
      this.focused = next;
      return null;
    } catch (error) {
      return errorMessage(error);
    }
  }

  /** The bookkeeping after a rename or move: open tabs follow, the tree is listed again. */
  async pathMoved(oldPath: string, newPath: string, inQueue = false): Promise<void> {
    const shell = this.shell;
    this.remap(oldPath, newPath);
    // Commands run inside the shell's queue already; waiting on it again would never finish.
    if (inQueue) await shell.followPath(oldPath, newPath);
    else await shell.enqueue(() => shell.followPath(oldPath, newPath));
    await this.relist([parentPath(oldPath), parentPath(newPath)]);
  }

  async duplicate(path: string): Promise<void> {
    try {
      const copy = await this.shell.platform.duplicatePath(path);
      await this.relist([parentPath(copy)]);
      this.focused = copy;
      await this.shell.enqueue(() => this.shell.openPaths([copy]));
    } catch (error) {
      if (!isCancelled(error)) this.shell.showError(errorMessage(error));
    }
  }

  async trash(path: string): Promise<void> {
    const shell = this.shell;
    const platform = shell.platform;
    const name = fileName(path);
    try {
      const yes = await platform.ask({
        title: `Move "${name}" to the Trash?`,
        message: 'You can get it back from the Trash.',
        ok: 'Move to Trash',
        cancel: 'Cancel',
      });
      if (!yes) return;
      const index = this.rows.findIndex((row) => row.path === path);
      await platform.trashPath(path);
      this.forget(path);
      await shell.enqueue(() => shell.pathTrashed(path));
      await this.relist([parentPath(path)]);
      const after = this.rows[Math.min(index, this.rows.length - 1)];
      this.focused = after?.path ?? null;
    } catch (error) {
      if (!isCancelled(error)) shell.showError(errorMessage(error));
    }
  }

  async revealInFinder(path: string): Promise<void> {
    try {
      await this.shell.platform.revealInFinder(path);
    } catch (error) {
      if (!isCancelled(error)) this.shell.showError(errorMessage(error));
    }
  }

  async copyPath(path: string): Promise<void> {
    try {
      await this.shell.platform.writeClipboard({ text: path });
    } catch {
      this.shell.showError('The path could not be copied.');
    }
  }
}
