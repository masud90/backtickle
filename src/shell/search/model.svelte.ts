/**
 * The state of the Search tab. One model for each shell, so the query and the results survive a
 * switch of sidebar tab. A search starts 250 ms after the last change; a new one cancels the
 * running one, and a late answer of an older search is dropped.
 */
import type { SearchResult } from '@/lib/platform';
import { errorMessage } from '../document';
import { getFilesModel } from '../files/model.svelte';
import type { Shell } from '../shell.svelte';

export const SEARCH_DEBOUNCE_MS = 250;

const models = new WeakMap<Shell, SearchModel>();

export function getSearchModel(shell: Shell): SearchModel {
  let model = models.get(shell);
  if (!model) {
    model = new SearchModel(shell);
    models.set(shell, model);
  }
  return model;
}

export class SearchModel {
  query = $state('');
  caseSensitive = $state(false);
  wholeWord = $state(false);
  regex = $state(false);
  /** The last finished search of the current settings, or null. */
  result = $state.raw<SearchResult | null>(null);
  /** The folder the result is for. */
  resultFolder = $state<string | null>(null);
  searching = $state(false);
  /** A failure that is not a pattern error (the folder could not be read). */
  failure = $state<string | null>(null);
  /** Paths of the result files that are collapsed. */
  collapsed = $state.raw<ReadonlySet<string>>(new Set());
  /** The panel focuses its field when it can (the command was run before the panel loaded). */
  focusPending = $state(false);

  // Seeded with the time: Rust remembers cancelled ids, and a new window must not reuse one.
  private nextId = Date.now();
  private running: number | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  private readonly shell: Shell;

  constructor(shell: Shell) {
    this.shell = shell;
  }

  get folder(): string | null {
    return getFilesModel(this.shell).folder;
  }

  /** Something changed (the query or a toggle, the folder): search after the pause. */
  schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), SEARCH_DEBOUNCE_MS);
  }

  toggle(which: 'caseSensitive' | 'wholeWord' | 'regex'): void {
    this[which] = !this[which];
    this.schedule();
  }

  toggleCollapsed(path: string): void {
    const next = new Set(this.collapsed);
    if (!next.delete(path)) next.add(path);
    this.collapsed = next;
  }

  /** Cancels the running search, if any. */
  private cancelRunning(): void {
    if (this.running !== null) {
      void this.shell.platform.cancelSearch(this.running).catch(() => {});
      this.running = null;
    }
  }

  async run(): Promise<void> {
    clearTimeout(this.timer);
    const folder = this.folder;
    const query = this.query;
    this.cancelRunning();
    this.failure = null;
    if (!folder || query === '') {
      this.nextId++; // an answer still on its way is stale
      this.result = null;
      this.resultFolder = null;
      this.searching = false;
      return;
    }
    const id = this.nextId++;
    this.running = id;
    this.searching = true;
    try {
      const result = await this.shell.platform.searchFolder({
        id,
        folder,
        query,
        caseSensitive: this.caseSensitive,
        wholeWord: this.wholeWord,
        regex: this.regex,
      });
      if (id !== this.nextId - 1) return;
      if (result.cancelled) return;
      this.result = result;
      this.resultFolder = folder;
    } catch (error) {
      if (id !== this.nextId - 1) return;
      this.result = null;
      this.failure = errorMessage(error);
    } finally {
      if (id === this.nextId - 1) {
        this.running = null;
        this.searching = false;
      }
    }
  }
}
