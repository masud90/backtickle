/**
 * Crash recovery. The text of every document with unsaved changes is kept
 * in the app's recovery folder 2 s after the last edit and at once when the window loses focus.
 * The entry goes away when the document is saved, reverted or closed, and when the window closes
 * cleanly. After a crash or a forced quit the entries come back at the next launch as documents
 * marked "Recovered".
 *
 * Lazy: the shell loads this module at the first unsaved edit or when the launch check finds
 * entries; the launch check itself is one cheap call (`recoveryList`). One timer per edited
 * document, no polling. Nothing is evaluated; the text only goes to the backend's own folder.
 */
import { FLAVORS, type FlavorId } from '@/flavors';
import type { RecoveryEntry, RecoveryWrite, ViewMode } from '@/lib/platform';
import type { Shell } from './shell.svelte';
import { type Tab, tabIsDirty, untitledTab } from './tab';

export const RECOVERY_DELAY_MS = 2000;
/** The sentence the real-app check types. */
export const BENCH_SENTENCE = 'Recovery check: this sentence was never saved.';

/** A random id for an entry: 32 hex digits. */
function newId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The offset of a caret given as 1-based line and column from 0, clamped to the text. */
export function caretOffset(text: string, line: number, column: number): number {
  let offset = 0;
  for (let current = 1; current < line; current++) {
    const next = text.indexOf('\n', offset);
    if (next < 0) return text.length;
    offset = next + 1;
  }
  const end = text.indexOf('\n', offset);
  const lineLength = (end < 0 ? text.length : end) - offset;
  return offset + Math.max(0, Math.min(column, lineLength));
}

/** The editor state JSON of a recovered text (what `EditorState.fromJSON` reads), caret set. */
export function stateJson(text: string, line: number, column: number): unknown {
  const caret = caretOffset(text, line, column);
  return { doc: text, selection: { main: 0, ranges: [{ anchor: caret, head: caret }] } };
}

/** What the shell gives the recovery code (its members are private to it). */
export interface RecoveryHost {
  /** The tab for a file as the shell opens it, or a rejection. */
  readTab(path: string, view: ViewMode): Promise<Tab>;
  nextId(): number;
  /** True when another window holds the file. */
  heldElsewhere(path: string): Promise<boolean>;
  tabForPath(path: string): Tab | undefined;
  removeTab(id: number): Promise<void>;
  addTab(tab: Tab): void;
  activate(id: number): Promise<void>;
}

export class Recovery {
  private readonly shell: Shell;
  private readonly entryIds = new Map<number, string>();
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  /** Writes and removals of one entry run one after the other. */
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(shell: Shell) {
    this.shell = shell;
  }

  /** The document changed: keep it 2 s after the last edit. */
  edited(tabId: number): void {
    clearTimeout(this.timers.get(tabId));
    this.timers.set(
      tabId,
      setTimeout(() => {
        this.timers.delete(tabId);
        void this.write(tabId);
      }, RECOVERY_DELAY_MS),
    );
  }

  /** The window lost focus (or is going away): every document that waits is written now. */
  async flushAll(): Promise<void> {
    const waiting = [...this.timers.keys()];
    for (const tabId of waiting) clearTimeout(this.timers.get(tabId));
    this.timers.clear();
    await Promise.all(waiting.map((tabId) => this.write(tabId)));
  }

  /** Saved, reverted, closed or no longer different: the entry is removed. */
  forget(tabId: number): Promise<void> {
    clearTimeout(this.timers.get(tabId));
    this.timers.delete(tabId);
    const id = this.entryIds.get(tabId);
    if (!id) return Promise.resolve();
    this.entryIds.delete(tabId);
    return this.chain(id, () => this.shell.platform.recoveryRemove([id]));
  }

  /** A clean close of the window: every entry of this window goes. */
  async forgetAll(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    const ids = [...this.entryIds.values()];
    this.entryIds.clear();
    if (ids.length === 0) return;
    await Promise.all(ids.map((id) => this.chain(id, () => Promise.resolve())));
    await this.shell.platform.recoveryRemove(ids).catch(() => {});
  }

  /** A recovered document keeps the entry it came from. */
  adopt(tabId: number, id: string): void {
    this.entryIds.set(tabId, id);
  }

  /** The number of documents with an entry. */
  get count(): number {
    return this.entryIds.size;
  }

  destroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private chain(id: string, task: () => Promise<unknown>): Promise<void> {
    const run = (this.chains.get(id) ?? Promise.resolve()).then(task, task).then(
      () => {},
      () => {},
    );
    this.chains.set(id, run);
    void run.then(() => {
      if (this.chains.get(id) === run) this.chains.delete(id);
    });
    return run;
  }

  private snapshot(tabId: number): RecoveryWrite | null {
    const tab = this.shell.getTab(tabId);
    if (!tab || tab.guide || !tabIsDirty(tab)) return null;
    const workspace = this.shell.workspaceApi;
    const text = workspace?.textOf(tabId) ?? tab.initialText ?? '';
    const position = workspace?.position(tabId) ?? null;
    return {
      text,
      path: tab.path,
      name: tab.name,
      flavor: tab.flavor,
      view: tab.view,
      line: position?.cursor.line ?? tab.restoreCursor?.line ?? 1,
      column: position?.cursor.column ?? tab.restoreCursor?.column ?? 0,
      window: this.shell.windowLabel,
      modifiedMs: tab.modifiedMs,
    };
  }

  private async write(tabId: number): Promise<void> {
    const entry = this.snapshot(tabId);
    if (!entry) return;
    let id = this.entryIds.get(tabId);
    if (!id) {
      id = newId();
      this.entryIds.set(tabId, id);
    }
    const written = id;
    await this.chain(written, () => this.shell.platform.recoveryWrite(written, entry));
  }

  /**
   * Types a fixed sentence into the open document (a new one when none is open) and keeps it
   * now: the launch hook of the real-app check (`WRITEDOWN_BENCH=recovery-edit`).
   */
  async runEditBench(): Promise<void> {
    const shell = this.shell;
    if (!shell.active) await shell.newDocument();
    const workspace = await shell.ensureWorkspaceApi();
    workspace.typeAtEnd(BENCH_SENTENCE);
    const id = shell.activeId;
    if (id === null) return;
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    await this.write(id);
  }
}

/** The tab for a kept document: its text unsaved, the file (if any) as it is on disk now. */
async function recoveredTab(host: RecoveryHost, entry: RecoveryEntry): Promise<Tab> {
  let base: Tab | null = null;
  if (entry.path && !(await host.heldElsewhere(entry.path))) {
    try {
      base = await host.readTab(entry.path, entry.view);
    } catch {
      base = null; // moved or deleted: the text is still kept, as a document without a file
    }
  }
  const tab: Tab =
    base ??
    untitledTab({
      id: host.nextId(),
      name: entry.name,
      text: entry.text,
      view: entry.view,
      flavor: FLAVORS.some((f) => f.id === entry.flavor) ? (entry.flavor as FlavorId) : 'gfm',
      reason: 'default',
    });
  const savedText = base ? (base.initialText ?? '') : '';
  return {
    ...tab,
    initialText: entry.text,
    textDirty: true,
    recovered: true,
    // The file changed on disk since the entry was written: the usual banner asks.
    externalChange:
      base !== null && entry.modifiedMs !== null && base.modifiedMs !== entry.modifiedMs,
    restoreCursor: null,
    transfer: {
      editorState: stateJson(entry.text, entry.line, entry.column),
      savedText,
    },
  };
}

/**
 * Reopens the kept documents as tabs marked "Recovered". A recovered document replaces the tab
 * the session restored for the same path. Resolves to the number of documents reopened.
 */
export async function restoreRecovered(
  host: RecoveryHost,
  recovery: Recovery,
  entries: readonly RecoveryEntry[],
): Promise<number> {
  let last: number | null = null;
  let count = 0;
  for (const entry of entries) {
    const tab = await recoveredTab(host, entry);
    const same = tab.path ? host.tabForPath(tab.path) : undefined;
    if (same) await host.removeTab(same.id);
    host.addTab(tab);
    recovery.adopt(tab.id, entry.id);
    last = tab.id;
    count += 1;
  }
  if (last !== null) await host.activate(last);
  return count;
}
