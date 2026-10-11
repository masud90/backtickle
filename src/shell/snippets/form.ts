/** Checks of the snippet form (WP5.5). The Rust side cleans the list again when it is stored. */
import type { Snippet } from '@/lib/platform';

export interface SnippetDraft {
  /** Empty for a new snippet. */
  id: string;
  name: string;
  trigger: string;
  body: string;
}

const TRIGGER = /^[A-Za-z0-9_-]{1,32}$/;

/** What is wrong with the draft, in words for the user, or null. */
export function draftProblem(draft: SnippetDraft, list: Snippet[]): string | null {
  const name = draft.name.trim();
  if (!name) return 'Give the snippet a name.';
  if (name.length > 100) return 'The name can have at most 100 characters.';
  const trigger = draft.trigger.trim();
  if (trigger !== '') {
    if (!TRIGGER.test(trigger)) {
      return 'A trigger can use letters, digits, - and _ only (up to 32 characters).';
    }
    const clash = list.find((entry) => entry.trigger === trigger && entry.id !== draft.id);
    if (clash) return `The trigger "${trigger}" is used by "${clash.name}".`;
  }
  if (draft.body.length > 20000) return 'The text can have at most 20,000 characters.';
  return null;
}

/** The list with the draft added (no id) or replacing the snippet of the same id. */
export function withDraft(list: Snippet[], draft: SnippetDraft): Snippet[] {
  const entry: Snippet = {
    id: draft.id,
    name: draft.name.trim(),
    trigger: draft.trigger.trim(),
    body: draft.body,
  };
  if (!draft.id) return [...list, entry];
  return list.map((existing) => (existing.id === draft.id ? entry : existing));
}
