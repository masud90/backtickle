/**
 * The update check: at launch and then once a day, the main window asks GitHub for the newest
 * release and shows a banner when it is newer than this app. Nothing is downloaded or installed:
 * the banner's button opens the release page in the browser (releases are not signed for an
 * in-app updater). The `checkForUpdates` setting turns it off; it is the app's only network
 * request of its own.
 */
import type { Platform } from '@/lib/platform';

export const RELEASE_PAGE = 'https://github.com/masud90/backtickle/releases/tag/';
export const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface AvailableUpdate {
  /** Such as `0.3.0`. */
  version: string;
  /** The release page on GitHub. */
  url: string;
}

type Triple = [number, number, number];

/** `1.2.3` or `v1.2.3`; with `suffix`, also `1.2.3-beta` (the running app may be a test build). */
function parseVersion(text: string, suffix: boolean): Triple | null {
  const match = (suffix ? /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/ : /^v?(\d+)\.(\d+)\.(\d+)$/).exec(
    text.trim(),
  );
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/**
 * The update a release tag offers over the running version, or null when there is none. Only a
 * plain `vX.Y.Z` tag counts, and the page link is built from it, not taken from the answer.
 */
export function newerRelease(tag: string | null, current: string): AvailableUpdate | null {
  if (tag === null) return null;
  const latest = parseVersion(tag, false);
  const running = parseVersion(current, true);
  if (!latest || !running) return null;
  for (const [index, part] of latest.entries()) {
    const other = running[index] ?? 0;
    if (part > other) {
      const version = latest.join('.');
      return { version, url: `${RELEASE_PAGE}v${version}` };
    }
    if (part < other) return null;
  }
  return null;
}

/** Runs the check while the setting is on; `onUpdate` hears of each newer release found. */
export class UpdateChecker {
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Bumped when the check stops, so an answer still on its way is dropped. */
  private generation = 0;

  private readonly platform: Pick<Platform, 'latestRelease' | 'appVersion'>;
  private readonly onUpdate: (update: AvailableUpdate) => void;

  constructor(
    platform: Pick<Platform, 'latestRelease' | 'appVersion'>,
    onUpdate: (update: AvailableUpdate) => void,
  ) {
    this.platform = platform;
    this.onUpdate = onUpdate;
  }

  /** Starts (a check now, then one a day) or stops with the setting. */
  sync(enabled: boolean): void {
    if (enabled === (this.timer !== undefined)) return;
    if (!enabled) {
      this.stop();
      return;
    }
    this.timer = setInterval(() => void this.check(), UPDATE_INTERVAL_MS);
    void this.check();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.generation++;
  }

  private async check(): Promise<void> {
    const generation = this.generation;
    try {
      const [tag, current] = await Promise.all([
        this.platform.latestRelease(),
        this.platform.appVersion(),
      ]);
      const update = newerRelease(tag, current);
      if (update && generation === this.generation) this.onUpdate(update);
    } catch {
      // A failed check says nothing; the next one is a day away.
    }
  }
}
