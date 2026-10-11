/** The model of one open document (a tab). Pure data and the functions that derive from it. */
import type { FlavorId, FlavorReason } from '@/flavors';
import type {
  DocumentContext,
  DocumentFile,
  LineEnding,
  LocationKind,
  SaveFormat,
  ViewMode,
} from '@/lib/platform';
import type { DocStats, Heading } from '@/preview/types';
import { fileName } from './document';

export interface Tab {
  id: number;
  /** The canonical path, or null for a document that has no file yet. */
  path: string | null;
  /** The name shown in the title bar and the tab strip. */
  name: string;
  /** The text the editor state is created from. Dropped (null) once the state exists. */
  initialText: string | null;
  /** How the document is saved. The line ending can be switched from the status bar. */
  format: SaveFormat;
  /** The line ending at the last save or load: a different one counts as an edit. */
  savedLineEnding: LineEnding;
  legacyEncoding: string | null;
  lossy: boolean;
  readOnly: boolean;
  /** The file's modification time at the last read or save, or null without a file. */
  modifiedMs: number | null;
  /** When the document was last written or read, for the save status. */
  savedAtMs: number | null;
  location: LocationKind;
  flavor: FlavorId;
  reason: FlavorReason;
  /** The flavor chosen in the pill for this document, or null. */
  chosenFlavor: FlavorId | null;
  /** The document in the editor differs from the saved text. */
  textDirty: boolean;
  view: ViewMode;
  /** The top line of the editor and the scroll offset of the preview, restored on switching back. */
  editorTopLine: number;
  previewScrollTop: number;
  /** Numbers for the status bar, from the last render or analysis. */
  stats: DocStats | null;
  /** The outline of the document, from the last render or analysis. */
  headings: Heading[];
  /** The user dismissed these banners. */
  dismissed: { legacy: boolean; lossy: boolean; readOnly: boolean };
  /** The user agreed to save despite replaced characters. */
  lossyAccepted: boolean;
  /** The built-in Markdown guide. */
  guide: boolean;
  /** The file is no longer on disk (trashed or removed) while the tab holds unsaved changes. */
  missing: boolean;
  /** Another app changed the file while the tab holds unsaved changes (the banner asks). */
  externalChange: boolean;
  /**
   * Where the caret goes when the editor state is first created (1-based line, column from 0):
   * the saved document state, or the position kept across a reload. Taken once.
   */
  restoreCursor: { line: number; column: number } | null;
  /**
   * The editor state (JSON, with the undo history) and the saved text of a tab that was moved
   * here from another window. Taken once, when the tab is first shown.
   */
  transfer: { editorState: unknown; savedText: string } | null;
  /** Reopened from crash recovery; the banner asks Keep or Discard (Phase 5). */
  recovered: boolean;
}

/**
 * Dirty: the text differs from the saved text, the line ending was switched, or the file is gone
 * from disk (the document then only exists in Writedown, so it counts as unsaved).
 */
export function tabIsDirty(
  tab: Pick<Tab, 'textDirty' | 'format' | 'savedLineEnding'> & { missing?: boolean },
): boolean {
  return tab.textDirty || tab.format.lineEnding !== tab.savedLineEnding || tab.missing === true;
}

export interface NewTabInput {
  id: number;
  name: string;
  text: string;
  view: ViewMode;
  flavor: FlavorId;
  reason: FlavorReason;
  chosenFlavor?: FlavorId | null;
  guide?: boolean;
}

/** A tab for a document that has no file. */
export function untitledTab(input: NewTabInput): Tab {
  return {
    id: input.id,
    path: null,
    name: input.name,
    initialText: input.text,
    format: { encoding: 'utf-8', lineEnding: 'lf' },
    savedLineEnding: 'lf',
    legacyEncoding: null,
    lossy: false,
    readOnly: false,
    modifiedMs: null,
    savedAtMs: null,
    location: 'local',
    flavor: input.flavor,
    reason: input.reason,
    chosenFlavor: input.chosenFlavor ?? null,
    textDirty: false,
    view: input.view,
    editorTopLine: 0,
    previewScrollTop: 0,
    stats: null,
    headings: [],
    dismissed: { legacy: false, lossy: false, readOnly: false },
    lossyAccepted: false,
    guide: input.guide ?? false,
    missing: false,
    externalChange: false,
    restoreCursor: null,
    transfer: null,
    recovered: false,
  };
}

/** The fields of a tab that travel with it to another window; the rest is rebuilt there. */
const MOVED_KEYS = [
  'name',
  'format',
  'savedLineEnding',
  'legacyEncoding',
  'lossy',
  'readOnly',
  'modifiedMs',
  'savedAtMs',
  'location',
  'flavor',
  'reason',
  'chosenFlavor',
  'textDirty',
  'view',
  'editorTopLine',
  'previewScrollTop',
  'dismissed',
  'lossyAccepted',
  'guide',
  'missing',
  'externalChange',
] as const satisfies ReadonlyArray<keyof Tab>;

/** The serializable part of a tab, for `TabTransfer.tab`. */
export function movedFields(tab: Tab): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const key of MOVED_KEYS) fields[key] = tab[key];
  return fields;
}

/**
 * A tab from what another window sent: the moved fields over a fresh untitled tab, each taken
 * only if it has the right type. The text and the editor state arrive separately.
 */
export function tabFromTransfer(
  id: number,
  transfer: {
    path: string | null;
    text: string;
    savedText: string;
    editorState: unknown;
    tab: Record<string, unknown>;
  },
): Tab {
  const given = transfer.tab;
  const base = untitledTab({
    id,
    name: typeof given.name === 'string' ? given.name : 'Untitled',
    text: transfer.text,
    view: given.view === 'editor' || given.view === 'preview' ? given.view : 'split',
    flavor: (typeof given.flavor === 'string' ? given.flavor : 'gfm') as FlavorId,
    reason: (typeof given.reason === 'string' ? given.reason : 'default') as FlavorReason,
    chosenFlavor: typeof given.chosenFlavor === 'string' ? (given.chosenFlavor as FlavorId) : null,
    guide: given.guide === true,
  });
  const tab: Tab = { ...base, path: transfer.path };
  const text = (key: keyof Tab) => typeof given[key] === 'string';
  const num = (key: keyof Tab) => typeof given[key] === 'number' && Number.isFinite(given[key]);
  const bool = (key: keyof Tab) => typeof given[key] === 'boolean';
  const patch: Partial<Tab> = {};
  const format = given.format as { encoding?: unknown; lineEnding?: unknown } | undefined;
  if (format && typeof format.encoding === 'string' && typeof format.lineEnding === 'string') {
    patch.format = format as Tab['format'];
  }
  if (given.savedLineEnding === 'lf' || given.savedLineEnding === 'crlf') {
    patch.savedLineEnding = given.savedLineEnding;
  }
  if (text('legacyEncoding')) patch.legacyEncoding = given.legacyEncoding as string;
  if (text('location')) patch.location = given.location as Tab['location'];
  for (const key of ['lossy', 'readOnly', 'lossyAccepted', 'missing', 'externalChange'] as const) {
    if (bool(key)) patch[key] = given[key] as boolean;
  }
  if (bool('textDirty')) patch.textDirty = given.textDirty as boolean;
  for (const key of ['modifiedMs', 'savedAtMs'] as const) {
    if (num(key)) patch[key] = given[key] as number;
  }
  for (const key of ['editorTopLine', 'previewScrollTop'] as const) {
    if (num(key)) patch[key] = given[key] as number;
  }
  const dismissed = given.dismissed as Partial<Tab['dismissed']> | undefined;
  if (dismissed) {
    patch.dismissed = {
      legacy: dismissed.legacy === true,
      lossy: dismissed.lossy === true,
      readOnly: dismissed.readOnly === true,
    };
  }
  return {
    ...tab,
    ...patch,
    transfer:
      transfer.editorState == null
        ? null
        : { editorState: transfer.editorState, savedText: transfer.savedText },
  };
}

/** A tab for a file that was read. */
export function fileTab(
  id: number,
  file: DocumentFile,
  context: DocumentContext,
  view: ViewMode,
  flavor: { flavor: FlavorId; reason: FlavorReason; chosen: FlavorId | null },
): Tab {
  return {
    ...untitledTab({
      id,
      name: fileName(file.path),
      text: file.text,
      view,
      flavor: flavor.flavor,
      reason: flavor.reason,
      chosenFlavor: flavor.chosen,
    }),
    path: file.path,
    format: { encoding: file.encoding, lineEnding: file.lineEnding },
    savedLineEnding: file.lineEnding,
    legacyEncoding: file.legacyEncoding,
    lossy: file.lossy,
    readOnly: file.readOnly,
    modifiedMs: file.modifiedMs,
    savedAtMs: file.modifiedMs,
    location: context.location,
  };
}
