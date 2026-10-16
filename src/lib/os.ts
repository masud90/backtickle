/**
 * Which operating system the page runs on: macOS or Windows. The answer comes from the user agent
 * string, which WebView2 on Windows fills with `Windows`. Tests set it with `setOsForTesting`.
 *
 * Code that behaves differently on Windows asks `isWindows()`; a label with a macOS and a Windows
 * wording goes through `byOs`. CSS reads `data-os` on the root element (`markDocumentOs`).
 */

export type OsName = 'mac' | 'windows';

let forced: OsName | null = null;
/** The answer of `isWindows11`, asked once. */
let windows11: Promise<boolean> | null = null;

/** True when the page runs on Windows. */
export function isWindows(): boolean {
  if (forced !== null) return forced === 'windows';
  return typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent);
}

export function osName(): OsName {
  return isWindows() ? 'windows' : 'mac';
}

/** The macOS or the Windows form of a label (or of any value). */
export function byOs<T>(mac: T, windows: T): T {
  return isWindows() ? windows : mac;
}

/** Sets `data-os` on the root element so the style sheets can tell the two systems apart. */
export function markDocumentOs(): void {
  document.documentElement.dataset.os = osName();
}

/** For unit tests: pretend to run on `os`, or go back to the user agent with null. */
export function setOsForTesting(os: OsName | null): void {
  forced = os;
  windows11 = null;
}

/** The part of `navigator.userAgentData` (Chromium, so WebView2) read here. */
interface UserAgentData {
  getHighEntropyValues?: (hints: string[]) => Promise<{ platformVersion?: string }>;
}

/**
 * True once the page knows it runs on Windows 11 or later: WebView2 reports a platform version
 * of 13 or more there (1 to 12 is Windows 10). False when it cannot tell. Asked once.
 */
export function isWindows11(): Promise<boolean> {
  windows11 ??= (async () => {
    const data = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
    if (!data?.getHighEntropyValues) return false;
    try {
      const { platformVersion } = await data.getHighEntropyValues(['platformVersion']);
      const major = Number.parseInt(platformVersion ?? '', 10);
      return Number.isFinite(major) && major >= 13;
    } catch {
      return false;
    }
  })();
  return windows11;
}
