/**
 * The data side of Quick Open: which files can be picked and in what
 * order. With an empty query: open tabs, then recents, then the files of the open folder, each
 * path once. With a query: the fuzzy score of the relative path decides, the order above breaks
 * ties.
 */
import type { RecentEntry } from '@/lib/platform';
import { fuzzyRank } from '../fuzzy';
import type { PickerItem } from '../picker';

export type CandidateSource = 'tab' | 'recent' | 'folder';

export interface Candidate {
  path: string;
  name: string;
  /** What is shown next to the name: the folder, relative to the open folder when below it. */
  folder: string;
  /** What the query is matched against: the relative path (or the shown path outside the folder). */
  text: string;
  source: CandidateSource;
}

/** How many rows the list shows (the rest is reachable by typing more). */
export const MAX_ROWS = 100;

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

function candidate(
  path: string,
  source: CandidateSource,
  folder: string | null,
  shownFolder?: string,
): Candidate {
  const name = nameOf(path);
  const base = folder && folder.length > 1 ? folder.replace(/\/$/, '') : folder;
  if (base && path.startsWith(`${base}/`)) {
    const relative = path.slice(base.length + 1);
    const slash = relative.lastIndexOf('/');
    return {
      path,
      name,
      folder: slash < 0 ? '' : relative.slice(0, slash),
      text: relative,
      source,
    };
  }
  const dir = shownFolder ?? path.slice(0, Math.max(0, path.lastIndexOf('/')));
  return { path, name, folder: dir, text: dir ? `${dir}/${name}` : name, source };
}

export interface CandidateInput {
  /** Paths of the open documents, in tab order (untitled ones are not passed). */
  tabs: readonly string[];
  recents: readonly RecentEntry[];
  /** The open folder and its Markdown files (absolute paths), or null. */
  folder: string | null;
  folderFiles: readonly string[];
}

/** Every pickable file once, in the empty-query order. */
export function buildCandidates(input: CandidateInput): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  const add = (path: string, source: CandidateSource, shownFolder?: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    out.push(candidate(path, source, input.folder, shownFolder));
  };
  for (const path of input.tabs) add(path, 'tab');
  for (const entry of input.recents) if (entry.exists) add(entry.path, 'recent', entry.folder);
  for (const path of input.folderFiles) add(path, 'folder');
  return out;
}

/** Maps match indices in `text` (the relative path) to indices in the name, which ends it. */
export function nameMatches(item: Candidate, indices: readonly number[]): number[] {
  const offset = item.text.length - item.name.length;
  return indices.filter((index) => index >= offset).map((index) => index - offset);
}

/** The rows for a query. */
export function pickerRows(candidates: readonly Candidate[], query: string): PickerItem[] {
  const trimmed = query.trim();
  if (trimmed === '') {
    return candidates.slice(0, MAX_ROWS).map((item) => ({
      id: item.path,
      label: item.name,
      detail: item.folder,
    }));
  }
  return fuzzyRank(candidates, trimmed, (item) => item.text)
    .slice(0, MAX_ROWS)
    .map(({ item, indices }) => ({
      id: item.path,
      label: item.name,
      detail: item.folder,
      matches: nameMatches(item, indices),
    }));
}
