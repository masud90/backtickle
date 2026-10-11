/**
 * The question asked before documents with unsaved changes go away: the walk used by Close Tab,
 * Close Window and Quit. It is a function of the answers, so it can be tested without a window.
 */

export type CloseAnswer = 'save' | 'discard' | 'cancel';

export interface CloseWalkDeps<T> {
  /** Shows the document, so the person sees which one is asked about. */
  activate(item: T): Promise<void>;
  /** The native Save / Don't Save / Cancel question. */
  ask(item: T): Promise<CloseAnswer>;
  /** Saves the document. False when the save did not happen (Save As cancelled, or an error). */
  save(item: T): Promise<boolean>;
}

export interface CloseWalkResult<T> {
  /** True when every document was saved or discarded; false when the walk stopped. */
  completed: boolean;
  saved: T[];
  discarded: T[];
}

/**
 * Asks about each document in order. Save saves it first (and stops if the save does not
 * happen), Don't Save moves on, Cancel stops everything. Stopping leaves the rest untouched.
 */
export async function walkUnsaved<T>(
  items: readonly T[],
  deps: CloseWalkDeps<T>,
): Promise<CloseWalkResult<T>> {
  const saved: T[] = [];
  const discarded: T[] = [];
  for (const item of items) {
    await deps.activate(item);
    const answer = await deps.ask(item);
    if (answer === 'cancel') return { completed: false, saved, discarded };
    if (answer === 'save') {
      if (!(await deps.save(item))) return { completed: false, saved, discarded };
      saved.push(item);
    } else {
      discarded.push(item);
    }
  }
  return { completed: true, saved, discarded };
}
