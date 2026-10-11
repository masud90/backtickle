import { describe, expect, it } from 'vitest';
import { createMockPlatform, MAX_TEXT_FILE_BYTES, MOCK_APP_VERSION } from '@/lib/platform-mock';

describe('mock platform: reading files', () => {
  it('serves a file after it was chosen in the open dialog', async () => {
    const platform = createMockPlatform({
      files: { '/notes/a.md': '# A\n\nhello' },
      dialog: '/notes/a.md',
    });

    const path = await platform.openFileDialog();
    expect(path).toBe('/notes/a.md');
    const file = await platform.readTextFile('/notes/a.md');

    expect(file).toEqual({ path: '/notes/a.md', text: '# A\n\nhello', bytes: 10 });
  });

  it('reports the size in UTF-8 bytes, not characters', async () => {
    const platform = createMockPlatform({ files: { '/u.md': 'héllo €' } });
    await platform.openFileDialog();

    const file = await platform.readTextFile('/u.md');

    expect(file.text.length).toBe(7);
    expect(file.bytes).toBe(10); // é is 2 bytes, € is 3
  });

  it('refuses a seeded file that was never chosen (the same rule as the Rust side)', async () => {
    const platform = createMockPlatform({
      files: { '/secret.md': 'x', '/other.md': 'y' },
      dialog: '/other.md',
    });
    await platform.openFileDialog();

    await expect(platform.readTextFile('/secret.md')).rejects.toThrow('not chosen');
    await expect(platform.readTextFile('/etc/passwd')).rejects.toThrow('not chosen');
  });

  it('reports a chosen path that has no content as not found', async () => {
    const platform = createMockPlatform({ files: {}, dialog: '/gone.md' });
    await platform.openFileDialog();

    await expect(platform.readTextFile('/gone.md')).rejects.toThrow('File not found: /gone.md');
  });

  it('allows the file given with --open without a dialog', async () => {
    const platform = createMockPlatform({
      files: { '/from/cli.md': 'text' },
      launch: { openPath: '/from/cli.md' },
    });

    const launch = await platform.launchOptions();
    const file = await platform.readTextFile('/from/cli.md');

    expect(launch.openPath).toBe('/from/cli.md');
    expect(file.text).toBe('text');
  });

  it('rejects files larger than 50 MB', async () => {
    expect(MAX_TEXT_FILE_BYTES).toBe(50 * 1024 * 1024);
    const platform = createMockPlatform({
      files: { '/big.md': 'a'.repeat(MAX_TEXT_FILE_BYTES + 1) },
    });
    await platform.openFileDialog();

    await expect(platform.readTextFile('/big.md')).rejects.toThrow('50 MB');
  });
});

describe('mock platform: the open dialog', () => {
  it('returns the first seeded file when no dialog result is configured', async () => {
    const platform = createMockPlatform({ files: { '/first.md': '1', '/second.md': '2' } });

    expect(await platform.openFileDialog()).toBe('/first.md');
  });

  it('returns null when nothing is seeded, or when the seed says "cancelled"', async () => {
    expect(await createMockPlatform({}).openFileDialog()).toBeNull();
    expect(
      await createMockPlatform({ files: { '/a.md': 'a' }, dialog: null }).openFileDialog(),
    ).toBeNull();
  });
});

describe('mock platform: launch options and hooks', () => {
  it('defaults to a plain start without measurement switches', async () => {
    const launch = await createMockPlatform({}).launchOptions();

    expect(launch).toEqual({
      openPath: null,
      welcome: false,
      perf: false,
      bench: false,
      view: null,
      folderPath: null,
      restoreSession: true,
      windowLabel: 'main',
    });
  });

  it('applies launch overrides from the seed', async () => {
    const launch = await createMockPlatform({
      launch: { welcome: true, perf: true },
    }).launchOptions();

    expect(launch).toMatchObject({ welcome: true, perf: true, bench: false });
  });

  it('keeps the version and ping answers', async () => {
    const platform = createMockPlatform({});

    expect(await platform.appVersion()).toBe(MOCK_APP_VERSION);
    expect(await platform.ping()).toBe('pong (mock)');
    expect(platform.kind).toBe('mock');
  });

  it('records performance marks in order', () => {
    window.__WRITEDOWN_MOCK_MARKS__ = [];
    const platform = createMockPlatform({});

    platform.perfMark('frontend-init');
    platform.perfMark('ready');

    expect(window.__WRITEDOWN_MOCK_MARKS__.map((mark) => mark.name)).toEqual([
      'frontend-init',
      'ready',
    ]);
  });

  it('keeps the last benchmark report', async () => {
    const platform = createMockPlatform({});

    await platform.benchReport({ renderMs: [1], e2eMs: [2], docBytes: 3 });

    expect(window.__WRITEDOWN_MOCK_BENCH__).toEqual({ renderMs: [1], e2eMs: [2], docBytes: 3 });
  });
});

describe('mock platform: search benchmark report', () => {
  it('keeps the last search benchmark report', async () => {
    const platform = createMockPlatform({});
    const report = { query: 'lantern', runs: [], error: null };

    await platform.benchSearchReport(report);

    expect(window.__WRITEDOWN_MOCK_SEARCH_BENCH__).toEqual(report);
  });
});
