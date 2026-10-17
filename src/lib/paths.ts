/**
 * Path helpers that know the roots of both systems. Paths always use `/`: on Windows the Rust
 * side sends `C:/Users/a/Notes/a.md`, and a network share as `//server/share/a.md`. On macOS the
 * only root is `/`, so these helpers behave there exactly as the plain string code they replace.
 * Linux paths are POSIX paths like those of macOS: one root, `/`, and names that keep their case.
 */
import { isWindows } from './os';

const DRIVE_ROOT = /^[A-Za-z]:\//;
const SHARE_ROOT = /^\/\/[^/]+\/[^/]+(?:\/|$)/;

/**
 * The root an absolute path starts with, with its trailing slash: `/`, and on Windows `C:/` or
 * `//server/share/`. An empty string for a relative path.
 */
export function pathRoot(path: string): string {
  if (isWindows()) {
    const drive = DRIVE_ROOT.exec(path);
    if (drive) return drive[0];
    const share = SHARE_ROOT.exec(path);
    if (share) return share[0].endsWith('/') ? share[0] : `${share[0]}/`;
  }
  return path.startsWith('/') ? '/' : '';
}

export function isAbsolutePath(path: string): boolean {
  return pathRoot(path) !== '';
}

/**
 * The folder that holds `path`. A path right below a root gives the root (`/`, `C:/`), a root
 * gives itself, and a bare name gives null.
 */
export function parentFolder(path: string): string | null {
  const root = pathRoot(path);
  if (root !== '' && path.length <= root.length) return root;
  const slash = path.lastIndexOf('/');
  if (slash < 0) return null;
  return slash < root.length ? root : path.slice(0, slash);
}

/**
 * `href` (`../img.png`, `a/b.md`, or an absolute path) resolved against the folder `folder`.
 * `.` and empty steps are dropped, and `..` never climbs above the root.
 */
export function joinPath(folder: string, href: string): string {
  const hrefRoot = pathRoot(href);
  const root = hrefRoot !== '' ? hrefRoot : pathRoot(folder);
  const steps = hrefRoot !== '' ? [] : folder.slice(root.length).split('/');
  steps.push(...href.slice(hrefRoot.length).split('/'));
  const parts: string[] = [];
  for (const part of steps) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return root + parts.join('/');
}

/**
 * The `file:` URL of a path: `file:///Users/a/b.png`, `file:///C:/Users/a/b.png`, or
 * `file://server/share/b.png` for a network share. A relative path is read from `/`.
 */
export function fileUrl(path: string): string {
  const root = pathRoot(path);
  if (root === '/') return `file://${encodeURI(path)}`;
  if (root.startsWith('//')) return `file:${encodeURI(path)}`;
  if (root !== '') return `file:///${encodeURI(path)}`;
  return `file://${encodeURI(`/${path}`)}`;
}

/**
 * True when two paths name the same file. Windows ignores case in file names, so there the paths
 * are compared without it; macOS and Linux compare them as they are.
 */
export function samePath(a: string, b: string): boolean {
  if (a === b) return true;
  return isWindows() && a.toLowerCase() === b.toLowerCase();
}
