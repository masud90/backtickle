/** Relative times for the save status and the recent documents ("2m ago", "Yesterday", "May 14"). */
import type { LocationKind } from '@/lib/platform';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function startOfDay(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Whole calendar days between two instants, in the local time zone. */
function calendarDays(thenMs: number, nowMs: number): number {
  // Round, because a day with a clock change is 23 or 25 hours long.
  return Math.round((startOfDay(nowMs) - startOfDay(thenMs)) / 86_400_000);
}

const MONTH_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const MONTH_DAY_YEAR = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/**
 * "just now" under a minute, "Nm ago" under an hour, "Nh ago" the rest of the same day,
 * "Yesterday", "N days ago" under a week, then "May 14" (this year) or "May 14, 2025".
 * A time in the future (a clock that is a little off) reads "just now".
 */
export function relativeTime(thenMs: number, nowMs: number): string {
  const elapsed = nowMs - thenMs;
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  const days = calendarDays(thenMs, nowMs);
  if (days <= 0) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  const then = new Date(thenMs);
  const sameYear = then.getFullYear() === new Date(nowMs).getFullYear();
  return (sameYear ? MONTH_DAY : MONTH_DAY_YEAR).format(then);
}

const LOCATION_NAMES: Record<LocationKind, string | null> = {
  icloud: 'iCloud Drive',
  onedrive: 'OneDrive',
  dropbox: 'Dropbox',
  'google-drive': 'Google Drive',
  local: null,
};

/** The cloud service to name in the save status, or null for a local file. */
export function locationName(location: LocationKind): string | null {
  return LOCATION_NAMES[location];
}

export interface SaveStatusInput {
  /** The document has a file. */
  hasPath: boolean;
  dirty: boolean;
  /** When the file was last written or read, in milliseconds since the epoch. */
  savedAtMs: number | null;
  location: LocationKind;
}

/** The text of the save status pill: "Not saved", "Edited", "Saved to iCloud Drive • 2m ago". */
export function saveStatusText(input: SaveStatusInput, nowMs: number): string {
  if (!input.hasPath) return 'Not saved';
  if (input.dirty) return 'Edited';
  const cloud = locationName(input.location);
  const head = cloud ? `Saved to ${cloud}` : 'Saved';
  return input.savedAtMs === null ? head : `${head} • ${relativeTime(input.savedAtMs, nowMs)}`;
}
