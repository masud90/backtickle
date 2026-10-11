import { describe, expect, it } from 'vitest';
import { locationName, relativeTime, saveStatusText } from '@/shell/time';

// A fixed clock: Sunday 4 October 2026, 14:30 local time.
const NOW = new Date(2026, 9, 4, 14, 30, 0).getTime();
const at = (...args: [number, number, number, number?, number?]) => new Date(...args).getTime();

describe('relativeTime', () => {
  it('says "just now" for under a minute, and for a clock that is a little ahead', () => {
    expect(relativeTime(NOW, NOW)).toBe('just now');
    expect(relativeTime(NOW - 59_000, NOW)).toBe('just now');
    expect(relativeTime(NOW + 5_000, NOW)).toBe('just now');
  });

  it('counts minutes under an hour', () => {
    expect(relativeTime(NOW - 60_000, NOW)).toBe('1m ago');
    expect(relativeTime(NOW - 2 * 60_000, NOW)).toBe('2m ago');
    expect(relativeTime(NOW - 59 * 60_000 - 59_000, NOW)).toBe('59m ago');
  });

  it('counts hours within the same day', () => {
    expect(relativeTime(at(2026, 9, 4, 13, 30), NOW)).toBe('1h ago');
    expect(relativeTime(at(2026, 9, 4, 9, 0), NOW)).toBe('5h ago');
    expect(relativeTime(at(2026, 9, 4, 0, 5), NOW)).toBe('14h ago');
  });

  it('says "Yesterday" for the day before, even when fewer than 24 hours have passed', () => {
    expect(relativeTime(at(2026, 9, 3, 23, 0), NOW)).toBe('Yesterday');
    expect(relativeTime(at(2026, 9, 3, 9, 0), NOW)).toBe('Yesterday');
  });

  it('counts days under a week', () => {
    expect(relativeTime(at(2026, 9, 2, 12), NOW)).toBe('2 days ago');
    expect(relativeTime(at(2026, 8, 28, 12), NOW)).toBe('6 days ago');
  });

  it('shows the date from a week on: no year in the current year', () => {
    expect(relativeTime(at(2026, 8, 27, 12), NOW)).toBe('Sep 27');
    expect(relativeTime(at(2026, 4, 14, 8), NOW)).toBe('May 14');
  });

  it('shows the year for earlier years', () => {
    expect(relativeTime(at(2025, 4, 14, 8), NOW)).toBe('May 14, 2025');
  });
});

describe('locationName', () => {
  it('names the cloud services and nothing for a local file', () => {
    expect(locationName('icloud')).toBe('iCloud Drive');
    expect(locationName('onedrive')).toBe('OneDrive');
    expect(locationName('dropbox')).toBe('Dropbox');
    expect(locationName('google-drive')).toBe('Google Drive');
    expect(locationName('local')).toBeNull();
  });
});

describe('saveStatusText', () => {
  const base = { hasPath: true, dirty: false, location: 'local' as const };

  it('says "Not saved" for a document without a file, edited or not', () => {
    expect(saveStatusText({ ...base, hasPath: false, savedAtMs: null }, NOW)).toBe('Not saved');
    expect(saveStatusText({ ...base, hasPath: false, dirty: true, savedAtMs: null }, NOW)).toBe(
      'Not saved',
    );
  });

  it('says "Edited" for unsaved changes', () => {
    expect(saveStatusText({ ...base, dirty: true, savedAtMs: NOW - 5000 }, NOW)).toBe('Edited');
  });

  it('shows when the file was saved', () => {
    expect(saveStatusText({ ...base, savedAtMs: NOW }, NOW)).toBe('Saved • just now');
    expect(saveStatusText({ ...base, savedAtMs: NOW - 2 * 60_000 }, NOW)).toBe('Saved • 2m ago');
  });

  it('names the cloud service', () => {
    expect(saveStatusText({ ...base, location: 'icloud', savedAtMs: NOW - 120_000 }, NOW)).toBe(
      'Saved to iCloud Drive • 2m ago',
    );
    expect(saveStatusText({ ...base, location: 'onedrive', savedAtMs: NOW }, NOW)).toBe(
      'Saved to OneDrive • just now',
    );
  });

  it('is only "Saved" when no time is known', () => {
    expect(saveStatusText({ ...base, savedAtMs: null }, NOW)).toBe('Saved');
  });
});
