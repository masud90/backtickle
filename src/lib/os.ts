/**
 * Which operating system the page runs on: macOS, Windows or Linux. The answer comes from the
 * user agent string, which WebView2 on Windows fills with `Windows` and WebKitGTK on Linux with
 * `X11; Linux` (or `Linux` alone under Wayland). Tests set it with `setOsForTesting`.
 *
 * Code that behaves differently on Windows asks `isWindows()`, on Linux `isLinux()`, and on macOS
 * `isMac()`. Linux shares the window chrome and the shortcut keys of Windows (a native title bar
 * and menu bar, Ctrl in place of ⌘), so code about those asks `!isMac()`; it shares the paths and
 * the file names of macOS (one root, case-sensitive names), so code about those asks
 * `isWindows()`. A label with a macOS, a Windows and a Linux wording goes through `byOs`. CSS
 * reads `data-os` on the root element (`markDocumentOs`).
 */

export type OsName = 'mac' | 'windows' | 'linux';

let forced: OsName | null = null;
/** The answer of `isWindows11`, asked once. */
let windows11: Promise<boolean> | null = null;

export function osName(): OsName {
  if (forced !== null) return forced;
  if (typeof navigator === 'undefined') return 'mac';
  if (/Windows/.test(navigator.userAgent)) return 'windows';
  if (/Linux/.test(navigator.userAgent)) return 'linux';
  return 'mac';
}

/** True when the page runs on Windows. */
export function isWindows(): boolean {
  return osName() === 'windows';
}

/** True when the page runs on Linux. */
export function isLinux(): boolean {
  return osName() === 'linux';
}

/** True when the page runs on macOS. */
export function isMac(): boolean {
  return osName() === 'mac';
}

/**
 * The macOS, the Windows or the Linux form of a label (or of any value). Without a Linux form,
 * Linux takes the Windows one.
 */
export function byOs<T>(mac: T, windows: T, linux: T = windows): T {
  const os = osName();
  if (os === 'windows') return windows;
  if (os === 'linux') return linux;
  return mac;
}

/** Sets `data-os` on the root element so the style sheets can tell the systems apart. */
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
