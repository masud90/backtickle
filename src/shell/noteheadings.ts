/**
 * The headings of another note, for the `[[Note#` completion of an Obsidian document: the note is
 * found in the vault index like a wikilink is (`resolveNote`), read with `readLinkedText`
 * (purpose `embed`) and its ATX headings returned. Any failure gives an empty list.
 */
import type { Platform, VaultIndex } from '@/lib/platform';

export function noteHeadingsFor(
  platform: Pick<Platform, 'readLinkedText'>,
  /** The path of the document being edited, read when the list is asked for (Save As moves it). */
  docPath: () => string | null,
  vault: VaultIndex | null,
): (name: string) => Promise<string[]> {
  return async (name) => {
    try {
      const { pathInVault, relativeHref, resolveNote } = await import(
        '@/preview/rules/obsidian/resolve'
      );
      const path = docPath();
      if (!path || !vault) return [];
      const from = pathInVault(vault, path);
      const note = resolveNote(vault, from, name);
      if (note === null) return [];
      const { text } = await platform.readLinkedText(path, relativeHref(from, note), 'embed');
      const { headingsOf } = await import('@/editor/flavors/obsidian');
      return headingsOf(text);
    } catch {
      return [];
    }
  };
}
