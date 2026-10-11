/**
 * Where an Obsidian link points: the vault index maps a
 * name typed in `[[...]]` to a path in the vault. Order: the exact path (with or without the
 * extension), else every file whose path ends with the name; the one with the fewest folder steps
 * from the current note wins, ties go in alphabetical order of the path.
 *
 * Everything here is pure and works on paths relative to the vault root, '/' separated.
 */
import type { VaultIndex } from '@/lib/platform';

/** Extensions of the notes of a vault (the Markdown family and plain text). */
export const NOTE_EXTENSIONS = new Set([
  'md',
  'markdown',
  'mdown',
  'mkd',
  'mkdn',
  'mdx',
  'qmd',
  'rmd',
  'mmd',
  'txt',
]);

export const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'bmp',
  'avif',
]);

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The name without the extension of a note (`Folder/Note.md` gives `Note`). */
export function noteName(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 && NOTE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())
    ? name.slice(0, dot)
    : name;
}

function stripNoteExtension(path: string): string {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  if (dot > slash + 1 && NOTE_EXTENSIONS.has(path.slice(dot + 1).toLowerCase())) {
    return path.slice(0, dot);
  }
  return path;
}

/** Lookup tables of one vault, built once per index object. */
interface Lookup {
  notes: ReadonlySet<string>;
  /** Lower-case path suffixes (without the note extension) to the notes that end with them. */
  noteKeys: Map<string, string[]>;
  files: ReadonlySet<string>;
  /** Lower-case path suffixes of the attachments (with the extension). */
  fileKeys: Map<string, string[]>;
}

const lookups = new WeakMap<VaultIndex, Lookup>();

function addSuffixes(map: Map<string, string[]>, key: string, path: string): void {
  let from = 0;
  for (;;) {
    const suffix = key.slice(from);
    const list = map.get(suffix);
    if (list) list.push(path);
    else map.set(suffix, [path]);
    const slash = key.indexOf('/', from);
    if (slash < 0) return;
    from = slash + 1;
  }
}

function lookupOf(vault: VaultIndex): Lookup {
  let lookup = lookups.get(vault);
  if (!lookup) {
    const noteKeys = new Map<string, string[]>();
    for (const note of vault.notes) {
      addSuffixes(noteKeys, stripNoteExtension(note).toLowerCase(), note);
    }
    const fileKeys = new Map<string, string[]>();
    for (const file of vault.attachments) addSuffixes(fileKeys, file.toLowerCase(), file);
    lookup = {
      notes: new Set(vault.notes),
      noteKeys,
      files: new Set(vault.attachments),
      fileKeys,
    };
    lookups.set(vault, lookup);
  }
  return lookup;
}

const dirsOf = (path: string | null): string[] => {
  if (path === null) return [];
  const parts = path.split('/');
  parts.pop();
  return parts;
};

/** Folder steps between the folder of `from` and the folder of `to` (up, then down). */
export function folderSteps(from: string | null, to: string): number {
  const a = dirsOf(from);
  const b = dirsOf(to);
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common++;
  return a.length - common + (b.length - common);
}

function nearest(candidates: readonly string[], from: string | null): string | null {
  let best: string | null = null;
  let bestSteps = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const steps = folderSteps(from, candidate);
    if (
      steps < bestSteps ||
      (steps === bestSteps && best !== null && alphabetical(candidate, best) < 0)
    ) {
      best = candidate;
      bestSteps = steps;
    }
  }
  return best;
}

function alphabetical(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la !== lb) return la < lb ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function clean(target: string): string {
  return target.trim().replace(/^\/+/, '');
}

/** The note a link points to, as a path relative to the vault root, or null. */
export function resolveNote(
  vault: VaultIndex | null,
  from: string | null,
  target: string,
): string | null {
  if (!vault) return null;
  const name = clean(target);
  if (name === '') return null;
  const lookup = lookupOf(vault);
  if (lookup.notes.has(name)) return name;
  if (lookup.notes.has(`${name}.md`)) return `${name}.md`;
  const candidates = lookup.noteKeys.get(stripNoteExtension(name).toLowerCase());
  return candidates ? nearest(candidates, from) : null;
}

/** An attachment (image, PDF) a link points to, or null. */
export function resolveFile(
  vault: VaultIndex | null,
  from: string | null,
  target: string,
): string | null {
  if (!vault) return null;
  const name = clean(target);
  if (name === '') return null;
  const lookup = lookupOf(vault);
  if (lookup.files.has(name)) return name;
  const candidates = lookup.fileKeys.get(name.toLowerCase());
  return candidates ? nearest(candidates, from) : null;
}

/** The path of a vault file seen from the folder of `from`, percent-encoded, with `../` steps. */
export function relativeHref(from: string | null, to: string): string {
  const a = dirsOf(from);
  const parts = to.split('/');
  let common = 0;
  while (common < a.length && common < parts.length - 1 && a[common] === parts[common]) common++;
  const segments = [
    ...Array.from({ length: a.length - common }, () => '..'),
    ...parts.slice(common).map(encodeURIComponent),
  ];
  return segments.join('/');
}

/** `path` relative to the vault root, or null when it is not inside the vault. */
export function pathInVault(vault: VaultIndex | null, path: string | null): string | null {
  if (!vault || path === null) return null;
  const root = vault.root.replace(/\/+$/, '');
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null;
}

// ---- the vaults seen so far -------------------------------------------------------------------

const known = new Map<string, VaultIndex>();

/** Remembers a vault index (the embed code finds it again by the path of a note). */
export function rememberVault(vault: VaultIndex): void {
  known.set(vault.root.replace(/\/+$/, ''), vault);
  if (known.size > 8) known.delete(known.keys().next().value as string);
}

/** The vault index of the vault that holds `path`, if one was seen. */
export function knownVaultOf(path: string): VaultIndex | null {
  let found: VaultIndex | null = null;
  let length = -1;
  for (const [root, vault] of known) {
    if (path.startsWith(`${root}/`) && root.length > length) {
      found = vault;
      length = root.length;
    }
  }
  return found;
}
