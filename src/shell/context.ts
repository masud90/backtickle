/**
 * What a flavor pack needs from outside the document: bibliographies,
 * included files, the Obsidian vault index and the Quarto project file. The pack says what it
 * needs (`needs`), this module fetches it through the platform, caches it per document by href,
 * and hands it to `prepare`. The shell never parses what it fetched.
 *
 * `contextFor` is synchronous: it uses what has arrived, starts the fetches of what has not, and
 * calls `onArrived` when they are in so the preview renders again. A failed read is a missing
 * file for the pack (null), never an error dialog.
 */

import type { LinkedText, Platform, VaultIndex } from '@/lib/platform';
import { embedPathsOf, onEmbedLinked } from '@/preview/embed-links';
import type { ContextInputs, ContextNeeds, DocContext, Pipeline } from '@/preview/types';

/** How long a vault index fetched by one tab serves the others. */
const VAULT_SHARE_MS = 30_000;

type Reader = Pick<Platform, 'readLinkedText' | 'vaultIndex' | 'quartoProject'>;

type Slot<T> = { state: 'pending' } | { state: 'done'; value: T };

interface Cache {
  path: string | null;
  bibliographies: Map<string, Slot<LinkedText | null>>;
  includes: Map<string, Slot<LinkedText | null>>;
  vault: Slot<VaultIndex | null> | undefined;
  project: Slot<LinkedText | null> | undefined;
  /** Fetches that have not finished. */
  inFlight: Set<Promise<void>>;
  /** The pack's last `preload` promise that is being awaited. */
  preloading: Promise<void> | undefined;
}

export class ContextFetcher {
  private readonly reader: Reader;
  private readonly onArrived: (tabId: number) => void;
  private readonly caches = new Map<number, Cache>();
  /**
   * The vault indexes fetched lately, by root: tabs of one vault share one index instead of each
   * walking the folder (a vault can have 20,000 files). An index is used for 30 seconds, and
   * `reset` (Refresh, reload) drops it.
   */
  private readonly vaults = new Map<string, { at: number; index: VaultIndex }>();

  private readonly onLinked: (() => void) | undefined;

  constructor(reader: Reader, onArrived: (tabId: number) => void, onLinked?: () => void) {
    this.reader = reader;
    this.onArrived = onArrived;
    this.onLinked = onLinked;
    // An embedded note is read by the preview itself; the watch set learns of it here.
    onEmbedLinked(onLinked);
  }

  /** The canonical paths of every file fetched for any document (for the watch set). */
  linkedPaths(): string[] {
    const paths = new Set<string>();
    for (const cache of this.caches.values()) {
      for (const path of this.linkedPathsOf(cache)) paths.add(path);
    }
    return [...paths];
  }

  /** The document used one of these files, or (with `vault`) its vault index. */
  uses(tabId: number, paths: readonly string[], vault: boolean): boolean {
    const cache = this.caches.get(tabId);
    if (!cache) return false;
    if (vault && cache.vault) return true;
    const wanted = new Set(paths);
    const known = this.linkedPathsOf(cache);
    return known.some((path) => wanted.has(path));
  }

  private linkedPathsOf(cache: Cache): string[] {
    const found: string[] = [];
    for (const slots of [cache.bibliographies, cache.includes]) {
      for (const slot of slots.values()) {
        if (slot.state === 'done' && slot.value) found.push(slot.value.path);
      }
    }
    if (cache.project?.state === 'done' && cache.project.value)
      found.push(cache.project.value.path);
    found.push(...embedPathsOf(cache.path));
    return found;
  }

  /** The context of the source with what has arrived so far; undefined for a pack without one. */
  contextFor(
    tabId: number,
    pipeline: Pipeline,
    source: () => string,
    path: string | null,
  ): DocContext | undefined {
    if (!pipeline.needs || !pipeline.prepare) return undefined;
    const text = source();
    const needs = pipeline.needs(text);
    const cache = this.cacheOf(tabId, path);
    this.fetchMissing(tabId, cache, needs);
    const inputs = this.inputsOf(cache, needs);
    this.preload(tabId, cache, pipeline, inputs, true);
    const context = pipeline.prepare(text, inputs);
    // `prepare` can learn of inputs that only exist now (an include inside an include, the
    // bibliography named in the project file): fetch them too. Each arrival renders again, and
    // a href that is already known is never fetched twice, so a cycle settles.
    this.fetchMissing(tabId, cache, pipeline.needs(text));
    return context;
  }

  /** Resolves when everything the source needs has been fetched (or has failed). */
  async ready(tabId: number, pipeline: Pipeline, source: () => string, path: string | null) {
    if (!pipeline.needs) return;
    const cache = this.cacheOf(tabId, path);
    this.fetchMissing(tabId, cache, pipeline.needs(source()), false);
    do {
      while (cache.inFlight.size > 0) await Promise.allSettled([...cache.inFlight]);
      const text = source();
      const needs = pipeline.needs(text);
      const inputs = this.inputsOf(cache, needs);
      // Code that `prepare` needs, which can be known only when the files are in.
      this.preload(tabId, cache, pipeline, inputs, false);
      // What `prepare` learns from the files that arrived (nested includes, project bibliography).
      if (pipeline.prepare) {
        pipeline.prepare(text, inputs);
        this.fetchMissing(tabId, cache, pipeline.needs(text), false);
      }
    } while (cache.inFlight.size > 0);
  }

  /** Lets the pack load code that its `prepare` needs; the preview renders again when it is in. */
  private preload(
    tabId: number,
    cache: Cache,
    pipeline: Pipeline,
    inputs: ContextInputs,
    notify: boolean,
  ): void {
    const work = pipeline.preload?.(inputs);
    if (!work || work === cache.preloading) return;
    cache.preloading = work;
    const job: Promise<void> = work
      .catch(() => undefined)
      .then(() => {
        cache.inFlight.delete(job);
        if (notify && this.caches.get(tabId) === cache) this.onArrived(tabId);
      });
    cache.inFlight.add(job);
  }

  /** Forgets what was fetched for a document, so the next use reads it again. */
  reset(tabId: number): void {
    const vault = this.caches.get(tabId)?.vault;
    if (vault?.state === 'done' && vault.value) this.vaults.delete(vault.value.root);
    this.caches.delete(tabId);
  }

  /** A recent index of the vault that holds `path`, if any tab fetched one. */
  private sharedVault(path: string): VaultIndex | null {
    const now = Date.now();
    let best: VaultIndex | null = null;
    for (const [root, entry] of this.vaults) {
      if (now - entry.at > VAULT_SHARE_MS) {
        this.vaults.delete(root);
      } else if (
        path.startsWith(`${root.replace(/\/+$/, '')}/`) &&
        (!best || root.length > best.root.length)
      ) {
        best = entry.index;
      }
    }
    return best;
  }

  drop(tabId: number): void {
    this.caches.delete(tabId);
  }

  private cacheOf(tabId: number, path: string | null): Cache {
    let cache = this.caches.get(tabId);
    // Saved to another place: relative hrefs mean other files now.
    if (cache && cache.path !== path) cache = undefined;
    if (!cache) {
      cache = {
        path,
        bibliographies: new Map(),
        includes: new Map(),
        vault: undefined,
        project: undefined,
        inFlight: new Set(),
        preloading: undefined,
      };
      this.caches.set(tabId, cache);
    }
    return cache;
  }

  private fetchMissing(tabId: number, cache: Cache, needs: ContextNeeds, notify = true): void {
    const { path } = cache;
    const track = <T>(work: Promise<T>, assign: (value: T) => void): void => {
      const job = work.then((value) => {
        assign(value);
        cache.inFlight.delete(job);
        if (notify && this.caches.get(tabId) === cache) this.onArrived(tabId);
        this.onLinked?.();
      });
      cache.inFlight.add(job);
    };
    const readText = async (href: string, purpose: 'bibliography' | 'include') => {
      if (path === null) return null;
      try {
        return await this.reader.readLinkedText(path, href, purpose);
      } catch {
        return null;
      }
    };
    const fetchHrefs = (
      hrefs: readonly string[],
      slots: Map<string, Slot<LinkedText | null>>,
      purpose: 'bibliography' | 'include',
    ) => {
      for (const href of hrefs) {
        if (slots.has(href)) continue;
        slots.set(href, { state: 'pending' });
        track(readText(href, purpose), (value) => slots.set(href, { state: 'done', value }));
      }
    };
    fetchHrefs(needs.bibliographies, cache.bibliographies, 'bibliography');
    fetchHrefs(needs.includes, cache.includes, 'include');
    const shared = needs.vault && !cache.vault && path !== null ? this.sharedVault(path) : null;
    if (shared) cache.vault = { state: 'done', value: shared };
    if (needs.vault && !cache.vault) {
      cache.vault = { state: 'pending' };
      const work =
        path === null
          ? Promise.resolve(null)
          : this.reader.vaultIndex(path).catch((): VaultIndex | null => null);
      track(work, (value) => {
        cache.vault = { state: 'done', value };
        if (value) this.vaults.set(value.root, { at: Date.now(), index: value });
      });
    }
    if (needs.project && !cache.project) {
      cache.project = { state: 'pending' };
      const work =
        path === null
          ? Promise.resolve(null)
          : this.reader.quartoProject(path).catch((): LinkedText | null => null);
      track(work, (value) => {
        cache.project = { state: 'done', value };
      });
    }
  }

  private inputsOf(cache: Cache, needs: ContextNeeds): ContextInputs {
    const bibliographies: ContextInputs['bibliographies'] = [];
    for (const href of needs.bibliographies) {
      const slot = cache.bibliographies.get(href);
      if (slot?.state === 'done' && slot.value) {
        bibliographies.push({ href, path: slot.value.path, text: slot.value.text });
      }
    }
    const includes: ContextInputs['includes'] = new Map();
    for (const href of needs.includes) {
      const slot = cache.includes.get(href);
      const value = slot?.state === 'done' ? slot.value : null;
      includes.set(href, value ? { path: value.path, text: value.text } : null);
    }
    const vault = cache.vault?.state === 'done' && needs.vault ? cache.vault.value : null;
    const project = cache.project?.state === 'done' && needs.project ? cache.project.value : null;
    return {
      path: cache.path,
      bibliographies,
      includes,
      vault,
      project: project ? { path: project.path, text: project.text } : null,
    };
  }
}
