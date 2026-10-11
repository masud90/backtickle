/**
 * What the Obsidian pack knows about the whole document before it renders any of it: where the
 * note is in its vault (links resolve from there), the vault index, and the note names for
 * completion. The context's `metadata` carries three reserved keys of ours:
 *
 * - `wd:note`: the path of the note in the vault, the base of link resolution (null: not in a vault);
 * - `wd:href-note`: the note that `href`s are written relative to (the same, except inside an
 *   embedded note, whose links must work from the tab that shows the embed);
 * - `wd:abs`: the absolute path of the note in the tab ('' for an unsaved document).
 */
import type { CompletionData } from '@/editor/complete';
import type { VaultIndex } from '@/lib/platform';
import { hashString } from '../../hash';
import type { ContextInputs, ContextNeeds, DocContext } from '../../types';
import { noteName, pathInVault, rememberVault } from './resolve';

export const NOTE_KEY = 'wd:note';
export const HREF_NOTE_KEY = 'wd:href-note';
export const ABS_KEY = 'wd:abs';

export interface ObsidianScope {
  /** The vault, or null when the note is in none. */
  vault: VaultIndex | null;
  /** Path of the note in the vault, or null. */
  note: string | null;
  hrefNote: string | null;
  abs: string;
}

/** The scope the rules read from a context. */
export function scopeOf(context: DocContext | null): ObsidianScope {
  if (!context) return { vault: null, note: null, hrefNote: null, abs: '' };
  const note = context.metadata[NOTE_KEY];
  const hrefNote = context.metadata[HREF_NOTE_KEY];
  const abs = context.metadata[ABS_KEY];
  return {
    vault: context.vault,
    note: typeof note === 'string' ? note : null,
    hrefNote: typeof hrefNote === 'string' ? hrefNote : null,
    abs: typeof abs === 'string' ? abs : '',
  };
}

const vaultHashes = new WeakMap<VaultIndex, string>();

function hashOfVault(vault: VaultIndex): string {
  let hash = vaultHashes.get(vault);
  if (hash === undefined) {
    hash = hashString(
      `${vault.root}\u0001${vault.notes.join('\u0002')}\u0001${vault.attachments.join('\u0002')}`,
    );
    vaultHashes.set(vault, hash);
  }
  return hash;
}

/** The context of a note: `abs` its path, `hostAbs` the path of the tab that shows it. */
export function contextFor(
  vault: VaultIndex | null,
  abs: string | null,
  hostAbs: string | null = abs,
): DocContext {
  if (vault) rememberVault(vault);
  const note = pathInVault(vault, abs);
  const hrefNote = pathInVault(vault, hostAbs);
  const metadata: Record<string, unknown> = {
    [NOTE_KEY]: note,
    [HREF_NOTE_KEY]: hrefNote,
    [ABS_KEY]: hostAbs ?? '',
  };
  return {
    metadata,
    labels: new Map(),
    citationKeys: [],
    bibliography: null,
    vault,
    includes: new Map(),
    signature: hashString(
      `${hostAbs ?? ''}|${note ?? ''}|${hrefNote ?? ''}|${vault ? hashOfVault(vault) : ''}`,
    ),
  };
}

export function prepareObsidian(_source: string, inputs: ContextInputs): DocContext {
  return contextFor(inputs.vault, inputs.path);
}

const NEEDS: ContextNeeds = { bibliographies: [], includes: [], vault: true, project: false };

/** Every Obsidian note wants the vault index (shared between tabs by the shell). */
export function needsObsidian(): ContextNeeds {
  return NEEDS;
}

const entries = new WeakMap<VaultIndex, NonNullable<CompletionData['notes']>>();

export function completionsObsidian(context: DocContext): CompletionData {
  const vault = context.vault;
  if (!vault) return { notes: [] };
  let notes = entries.get(vault);
  if (!notes) {
    notes = vault.notes.map((path) => ({ name: noteName(path), path }));
    entries.set(vault, notes);
  }
  return { notes };
}

// ---- windows ----------------------------------------------------------------------------------

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const unsafeLines = new WeakMap<readonly string[], Uint8Array>();

/**
 * A window must not start inside a `%%` comment that goes over several lines (its lines would be
 * read as Markdown). Worked out once per source (the lines array).
 */
export function obsidianUnsafeSplit(lines: readonly string[], index: number): boolean {
  let unsafe = unsafeLines.get(lines);
  if (!unsafe) {
    unsafe = new Uint8Array(lines.length);
    let fence = '';
    let open = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      if (open) unsafe[i] = 1;
      const marks = FENCE.exec(line)?.[1];
      if (!open && marks) {
        if (fence === '') fence = marks;
        else if (marks.startsWith(fence.charAt(0)) && marks.length >= fence.length) fence = '';
        continue;
      }
      if (fence !== '') continue;
      // Count the `%%` marks of the line: an odd number flips the state.
      let count = 0;
      for (let at = line.indexOf('%%'); at !== -1; at = line.indexOf('%%', at + 2)) count++;
      if (count % 2 === 1) open = !open;
    }
    unsafeLines.set(lines, unsafe);
  }
  return unsafe[index] === 1;
}
