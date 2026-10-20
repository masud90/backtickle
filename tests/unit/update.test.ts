import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newerRelease, UPDATE_INTERVAL_MS, UpdateChecker } from '@/shell/update';

describe('newerRelease', () => {
  it('offers a newer release with a page link built from the tag', () => {
    expect(newerRelease('v0.3.0', '0.2.0')).toEqual({
      version: '0.3.0',
      url: 'https://github.com/masud90/backtickle/releases/tag/v0.3.0',
    });
    expect(newerRelease('v1.0.0', '0.9.9')?.version).toBe('1.0.0');
    expect(newerRelease('0.2.10', '0.2.9')?.version).toBe('0.2.10');
  });

  it('offers nothing for the same or an older release', () => {
    expect(newerRelease('v0.2.0', '0.2.0')).toBeNull();
    expect(newerRelease('v0.1.9', '0.2.0')).toBeNull();
    expect(newerRelease('v0.10.0', '1.0.0')).toBeNull();
  });

  it('ignores tags that are not a plain version, and a failed check', () => {
    expect(newerRelease(null, '0.2.0')).toBeNull();
    expect(newerRelease('v0.3.0-beta', '0.2.0')).toBeNull();
    expect(newerRelease('v0.3.0/../../evil', '0.2.0')).toBeNull();
    expect(newerRelease('latest', '0.2.0')).toBeNull();
  });

  it('compares a test build by its numbers', () => {
    expect(newerRelease('v0.0.1', '0.0.0-mock')?.version).toBe('0.0.1');
  });
});

describe('UpdateChecker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(tag: string | null = 'v9.0.0') {
    const latestRelease = vi.fn(async () => tag);
    const found = vi.fn();
    const checker = new UpdateChecker({ latestRelease, appVersion: async () => '0.2.0' }, found);
    return { latestRelease, found, checker };
  }

  it('checks when switched on and then once a day', async () => {
    const { latestRelease, found, checker } = setup();
    checker.sync(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(latestRelease).toHaveBeenCalledTimes(1);
    expect(found).toHaveBeenCalledWith(expect.objectContaining({ version: '9.0.0' }));

    checker.sync(true); // no second timer, no extra check
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS - 1);
    expect(latestRelease).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(latestRelease).toHaveBeenCalledTimes(2);
    checker.stop();
  });

  it('makes no request while off and drops an answer that arrives after switching off', async () => {
    const { latestRelease, found, checker } = setup();
    checker.sync(false);
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS * 2);
    expect(latestRelease).not.toHaveBeenCalled();

    checker.sync(true);
    checker.sync(false);
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS * 2);
    expect(latestRelease).toHaveBeenCalledTimes(1);
    expect(found).not.toHaveBeenCalled();
  });

  it('stays quiet when there is nothing newer or the check fails', async () => {
    const { found, checker } = setup(null);
    checker.sync(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(found).not.toHaveBeenCalled();
    checker.stop();

    const failing = new UpdateChecker(
      {
        latestRelease: async () => Promise.reject(new Error('offline')),
        appVersion: async () => '0.2.0',
      },
      found,
    );
    failing.sync(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(found).not.toHaveBeenCalled();
    failing.stop();
  });
});
