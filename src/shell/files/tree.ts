/** The pure side of the Files sidebar: ordering, rows, names, keys. */
import { isWindows } from '@/lib/os';
import { parentFolder } from '@/lib/paths';
import type { FolderEntry } from '@/lib/platform';

export interface Level {
  entries: FolderEntry[];
  truncated: boolean;
}

/** One visible row of the tree. */
export interface Row {
  path: string;
  name: string;
  kind: 'folder' | 'file';
  /** 1 for the children of the open folder. */
  level: number;
  /** The path of the folder that holds it. */
  parent: string;
  /** Folders only. */
  expanded: boolean;
  /** Folders only: the children are being listed. */
  loading: boolean;
}

/** Natural, case-insensitive order: "chapter 2" before "chapter 10", "a" and "A" together. */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** Folders first, then files, each in natural order. Does not change its argument. */
export function sortEntries(entries: readonly FolderEntry[]): FolderEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return naturalCompare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  });
}

/** The rows to show: the children of `root`, descending into expanded folders whose level is known. */
export function flattenTree(
  root: string,
  levels: ReadonlyMap<string, Level>,
  expanded: ReadonlySet<string>,
  loading: ReadonlySet<string> = new Set(),
): Row[] {
  const rows: Row[] = [];
  const walk = (folder: string, level: number) => {
    const entries = levels.get(folder)?.entries ?? [];
    for (const entry of entries) {
      const isOpen = entry.kind === 'folder' && expanded.has(entry.path);
      rows.push({
        path: entry.path,
        name: entry.name,
        kind: entry.kind,
        level,
        parent: folder,
        expanded: isOpen,
        loading: isOpen && loading.has(entry.path),
      });
      if (isOpen) walk(entry.path, level + 1);
    }
  };
  walk(root, 1);
  return rows;
}

export function parentPath(path: string): string {
  return parentFolder(path) ?? '/';
}

/** True when `path` is `folder` or lies below it. */
export function isUnder(path: string, folder: string): boolean {
  return path === folder || path.startsWith(folder.endsWith('/') ? folder : `${folder}/`);
}

/** The folders between `root` (excluded) and the file, outermost first. */
export function ancestorsBelow(root: string, path: string): string[] {
  if (!isUnder(path, root) || path === root) return [];
  const folders: string[] = [];
  let current = parentPath(path);
  // A share root comes back from `parentPath` with its slash (`//server/share/`).
  while (current !== root && current !== `${root}/` && isUnder(current, root)) {
    folders.unshift(current);
    const parent = parentPath(current);
    if (parent === current) break; // a root (`/`, `C:/`) is its own parent
    current = parent;
  }
  return folders;
}

/** The path after `oldPath` was renamed or moved to `newPath`; other paths come back unchanged. */
export function remapPath(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath) return newPath;
  return path.startsWith(`${oldPath}/`) ? `${newPath}${path.slice(oldPath.length)}` : path;
}

export const MARKDOWN_EXTENSIONS: readonly string[] = [
  '.md',
  '.markdown',
  '.mdown',
  '.mkd',
  '.mkdn',
  '.mdx',
  '.qmd',
  '.rmd',
  '.mmd',
  '.txt',
];

/** The extension of a name including the dot ("" when it has none; a leading dot is not one). */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
}

/** The name without its extension, for selecting just that part in the rename field. */
export function stemOf(name: string): string {
  const ext = extensionOf(name);
  return ext ? name.slice(0, -ext.length) : name;
}

/**
 * The name to rename to: the extension stays unless the person types another Markdown-family one
 * ("notes v1.2" stays a .md file; "notes.txt" becomes a text file). Folders take the typed name.
 */
export function finalName(oldName: string, typed: string, kind: 'folder' | 'file'): string {
  const name = typed.trim();
  if (kind === 'folder' || name === '') return name;
  const old = extensionOf(oldName);
  if (old === '') return name;
  const ext = extensionOf(name).toLowerCase();
  return MARKDOWN_EXTENSIONS.includes(ext) ? name : `${name}${old}`;
}

/**
 * What the platform will refuse, caught early so the field can say why (same rules as Rust). Linux
 * has the rules of macOS: Writedown refuses `:` there too.
 */
export function nameProblem(name: string): string | null {
  if (name.trim() === '') return 'Type a name.';
  if (isWindows()) return windowsNameProblem(name);
  if (name.includes('/') || name.includes(':')) return 'A name cannot contain "/" or ":".';
  if (name.startsWith('.')) return 'A name cannot start with a dot.';
  return null;
}

/** Windows also keeps `\ * ? " < > |`, a dot or a space at the end, and device names such as CON. */
function windowsNameProblem(name: string): string | null {
  if (/[\\/:*?"<>|]/.test(name)) return 'A name cannot contain \\ / : * ? " < > or |.';
  if (name.startsWith('.')) return 'A name cannot start with a dot.';
  if (/[. ]$/.test(name)) return 'A name cannot end with a dot or a space.';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    return 'That name is reserved by Windows.';
  }
  return null;
}

/** The first of "Untitled.md", "Untitled 2.md", ... that is not in `taken` (case-insensitive). */
export function nextNewName(taken: Iterable<string>, base: string, ext: string): string {
  const used = new Set<string>();
  for (const name of taken) used.add(name.toLowerCase());
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${base}${ext}` : `${base} ${n}${ext}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

export type TreeKey =
  | { kind: 'move'; to: number }
  | { kind: 'expand'; path: string }
  | { kind: 'collapse'; path: string }
  | { kind: 'open'; path: string }
  | { kind: 'toggle'; path: string };

/**
 * The effect of a navigation key on the tree (WAI-ARIA tree pattern). `index` is the focused row.
 * Returns null for a key the tree does not handle.
 */
export function treeKey(key: string, rows: readonly Row[], index: number): TreeKey | null {
  const row = rows[index];
  if (rows.length === 0) return null;
  switch (key) {
    case 'ArrowDown':
      return { kind: 'move', to: Math.min(rows.length - 1, index + 1) };
    case 'ArrowUp':
      return { kind: 'move', to: Math.max(0, index - 1) };
    case 'Home':
      return { kind: 'move', to: 0 };
    case 'End':
      return { kind: 'move', to: rows.length - 1 };
    case 'ArrowRight': {
      if (row?.kind !== 'folder') return null;
      if (!row.expanded) return { kind: 'expand', path: row.path };
      const next = rows[index + 1];
      return next && next.parent === row.path ? { kind: 'move', to: index + 1 } : null;
    }
    case 'ArrowLeft': {
      if (!row) return null;
      if (row.kind === 'folder' && row.expanded) return { kind: 'collapse', path: row.path };
      const parent = rows.findIndex((candidate) => candidate.path === row.parent);
      return parent >= 0 ? { kind: 'move', to: parent } : null;
    }
    case 'Enter':
      if (!row) return null;
      return row.kind === 'file'
        ? { kind: 'open', path: row.path }
        : { kind: 'toggle', path: row.path };
    default:
      return null;
  }
}
