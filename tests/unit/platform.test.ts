import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  vi.resetModules();
});

describe('getPlatform outside Tauri', () => {
  it('loads the in-memory mock and answers "pong (mock)"', async () => {
    const { getPlatform } = await import('@/lib/platform');
    const platform = await getPlatform();

    expect(platform.kind).toBe('mock');
    expect(await platform.ping()).toBe('pong (mock)');
    expect(await platform.appVersion()).toBe('0.0.0-mock');
  });

  it('reuses one instance across calls', async () => {
    const { getPlatform } = await import('@/lib/platform');

    expect(await getPlatform()).toBe(await getPlatform());
  });
});

describe('getPlatform inside Tauri', () => {
  it('calls the Rust commands "ping" and "app_version" through invoke', async () => {
    const invoke = vi.fn(async (command: string) => (command === 'ping' ? 'pong' : '1.2.3'));
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: { invoke },
      configurable: true,
    });

    const { getPlatform } = await import('@/lib/platform');
    const platform = await getPlatform();

    expect(platform.kind).toBe('tauri');
    expect(await platform.ping()).toBe('pong');
    expect(await platform.appVersion()).toBe('1.2.3');
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(['ping', 'app_version']);
  });
});
