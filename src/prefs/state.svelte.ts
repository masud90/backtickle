/**
 * What the Preferences window knows: the current settings, the snapshot taken when it opened,
 * and the keys changed from this window (for Cancel). Every change goes to `updateSettings` at
 * once; a stream of changes (a slider drag) is sent at most every 100 ms, and `commit` sends
 * the last value on release.
 */
import type { DeepPartial, Platform, Settings } from '@/lib/platform';

export const THROTTLE_MS = 100;

export function getAt(source: unknown, key: string): unknown {
  let value = source;
  for (const part of key.split('.')) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/** `editor.fontSize` and 14 become `{ editor: { fontSize: 14 } }`. */
export function patchFor(entries: Iterable<[string, unknown]>): DeepPartial<Settings> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    const parts = key.split('.');
    let node = patch;
    for (const part of parts.slice(0, -1)) {
      node[part] = (node[part] as Record<string, unknown> | undefined) ?? {};
      node = node[part] as Record<string, unknown>;
    }
    node[parts[parts.length - 1] as string] = value;
  }
  return patch as DeepPartial<Settings>;
}

export class PrefsState {
  settings = $state<Settings | null>(null);
  /** Set when a settings call fails. */
  error = $state<string | null>(null);

  private snapshot: Settings | null = null;
  private changed = new Set<string>();
  private pending = new Map<string, unknown>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSent = 0;
  private stop: (() => void) | null = null;
  private readonly platform: Platform;

  constructor(platform: Platform) {
    this.platform = platform;
  }

  async start(): Promise<void> {
    const initial = await this.platform.getSettings();
    this.snapshot = structuredClone($state.snapshot(initial)) as Settings;
    this.settings = initial;
    this.stop = await this.platform.onSettingsChanged((next) => {
      this.settings = next;
    });
  }

  dispose(): void {
    this.stop?.();
    if (this.timer) clearTimeout(this.timer);
  }

  value(key: string): unknown {
    return getAt(this.settings, key);
  }

  /** Marks keys as changed from this window (also for changes Rust makes for us). */
  track(...keys: string[]): void {
    for (const key of keys) this.changed.add(key);
  }

  get changedKeys(): string[] {
    return [...this.changed];
  }

  /** Sets one setting. With `throttle`, a burst is sent at most every 100 ms. */
  set(key: string, value: unknown, throttle = false): void {
    this.changed.add(key);
    this.pending.set(key, value);
    if (throttle) {
      this.schedule();
    } else {
      void this.flush();
    }
  }

  /** Sends what is waiting, now. */
  commit(): Promise<void> {
    return this.flush();
  }

  /** One `updateSettings` call that sets these keys (a category reset). */
  async setMany(entries: Array<[string, unknown]>): Promise<void> {
    for (const [key, value] of entries) {
      this.changed.add(key);
      this.pending.set(key, value);
    }
    await this.flush();
  }

  private schedule(): void {
    if (this.timer) return;
    const wait = Math.max(0, this.lastSent + THROTTLE_MS - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, wait);
  }

  private async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending.size === 0) return;
    const entries = [...this.pending.entries()];
    this.pending.clear();
    this.lastSent = Date.now();
    // Show the new values at once; the answer (clamped) replaces them.
    if (this.settings) {
      const next = structuredClone($state.snapshot(this.settings)) as Settings;
      for (const [key, value] of entries) setAt(next, key, value);
      this.settings = next;
    }
    try {
      const result = await this.platform.updateSettings(patchFor(entries));
      if (this.pending.size === 0) this.settings = result;
      this.error = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'The settings could not be saved.';
    }
  }

  /** Cancel: one patch that sets back every key changed from this window. */
  async cancel(): Promise<void> {
    await this.flush();
    if (!this.snapshot || this.changed.size === 0) return;
    const entries: Array<[string, unknown]> = [...this.changed].map((key) => [
      key,
      getAt(this.snapshot, key),
    ]);
    this.changed.clear();
    await this.platform.updateSettings(patchFor(entries));
  }
}

function setAt(target: unknown, key: string, value: unknown): void {
  const parts = key.split('.');
  let node = target as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) node = node[part] as Record<string, unknown>;
  node[parts[parts.length - 1] as string] = value;
}
