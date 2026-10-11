/**
 * A cache that is bounded by the number of entries and by the total size of its values, and
 * drops the least recently used entries first. Reading an entry makes it recent.
 */
export class BoundedCache<V> {
  private readonly entries = new Map<string, { value: V; size: number }>();
  private total = 0;
  private readonly maxEntries: number;
  private readonly maxSize: number;
  private readonly sizeOf: (key: string, value: V) => number;

  constructor(options: {
    maxEntries: number;
    maxSize: number;
    sizeOf: (key: string, value: V) => number;
  }) {
    this.maxEntries = options.maxEntries;
    this.maxSize = options.maxSize;
    this.sizeOf = options.sizeOf;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    // Move to the end of the iteration order: it is the most recent now.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  set(key: string, value: V): void {
    const old = this.entries.get(key);
    if (old) {
      this.total -= old.size;
      this.entries.delete(key);
    }
    const size = this.sizeOf(key, value);
    this.entries.set(key, { value, size });
    this.total += size;
    this.evict();
  }

  get size(): number {
    return this.entries.size;
  }

  /** The sum of the sizes of all values. */
  get totalSize(): number {
    return this.total;
  }

  clear(): void {
    this.entries.clear();
    this.total = 0;
  }

  private evict(): void {
    // Always keep the entry that was just added, even if it alone is larger than the limit.
    while (
      this.entries.size > 1 &&
      (this.entries.size > this.maxEntries || this.total > this.maxSize)
    ) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      const entry = this.entries.get(oldest.value);
      this.entries.delete(oldest.value);
      if (entry) this.total -= entry.size;
    }
  }
}
