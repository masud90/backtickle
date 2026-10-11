import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeepPartial, Platform, Settings } from '@/lib/platform';
import { getAt, PrefsState, patchFor, THROTTLE_MS } from '@/prefs/state.svelte';

function fakePlatform(initial: object) {
  let current = structuredClone(initial) as Record<string, unknown>;
  const calls: object[] = [];
  const platform = {
    getSettings: async () => structuredClone(current),
    updateSettings: async (patch: DeepPartial<Settings>) => {
      calls.push(structuredClone(patch));
      const merge = (target: Record<string, unknown>, source: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(source)) {
          if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            target[key] = target[key] ?? {};
            merge(target[key] as Record<string, unknown>, value as Record<string, unknown>);
          } else target[key] = value;
        }
      };
      merge(current, patch as Record<string, unknown>);
      return structuredClone(current);
    },
    onSettingsChanged: async () => () => {},
  } as unknown as Platform;
  return { platform, calls, set: (next: object) => (current = structuredClone(next) as never) };
}

describe('patchFor and getAt', () => {
  it('builds nested patches', () => {
    expect(
      patchFor([
        ['editor.fontSize', 14],
        ['appearance', 'dark'],
      ]),
    ).toEqual({
      editor: { fontSize: 14 },
      appearance: 'dark',
    });
  });
  it('reads dotted paths', () => {
    expect(getAt({ a: { b: 2 } }, 'a.b')).toBe(2);
    expect(getAt({ a: 1 }, 'a.b')).toBeUndefined();
  });
});

describe('PrefsState', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const initial = { appearance: 'system', editor: { fontSize: 13 }, view: { zoom: 1 } };

  it('sends a plain change at once', async () => {
    const { platform, calls } = fakePlatform(initial);
    const prefs = new PrefsState(platform);
    await prefs.start();
    prefs.set('appearance', 'dark');
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([{ appearance: 'dark' }]);
  });

  it('sends a drag at most every 100 ms, then the last value on commit', async () => {
    const { platform, calls } = fakePlatform(initial);
    const prefs = new PrefsState(platform);
    await prefs.start();
    prefs.set('editor.fontSize', 14, true);
    await vi.advanceTimersByTimeAsync(0);
    // The first value goes out at once; the rest wait for the window.
    for (let size = 15; size <= 20; size++) {
      prefs.set('editor.fontSize', size, true);
      await vi.advanceTimersByTimeAsync(10);
    }
    expect(calls.length).toBeLessThanOrEqual(2);
    await vi.advanceTimersByTimeAsync(THROTTLE_MS);
    expect(calls.length).toBeLessThanOrEqual(3);
    prefs.set('editor.fontSize', 21, true);
    await prefs.commit();
    expect(calls.at(-1)).toEqual({ editor: { fontSize: 21 } });
  });

  it('Cancel sets back only the keys changed here, in one call', async () => {
    const { platform, calls, set } = fakePlatform(initial);
    const prefs = new PrefsState(platform);
    await prefs.start();
    prefs.set('appearance', 'dark');
    prefs.set('editor.fontSize', 20);
    await vi.advanceTimersByTimeAsync(0);
    // The zoom changes elsewhere meanwhile.
    set({ appearance: 'dark', editor: { fontSize: 20 }, view: { zoom: 1.4 } });
    calls.length = 0;
    await prefs.cancel();
    expect(calls).toEqual([{ appearance: 'system', editor: { fontSize: 13 } }]);
  });

  it('Cancel with nothing changed sends nothing', async () => {
    const { platform, calls } = fakePlatform(initial);
    const prefs = new PrefsState(platform);
    await prefs.start();
    await prefs.cancel();
    expect(calls).toEqual([]);
  });
});
