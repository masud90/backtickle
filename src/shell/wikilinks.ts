/**
 * A click on a wikilink of an Obsidian note: find the note with the
 * vault index (exact path, then the nearest by folder steps, ties alphabetical), open it through
 * `openLinkedDocument` with the resolved relative path, and scroll to the heading or block.
 *
 * The preview already writes a resolved wikilink with a real relative `href`, so the shell's
 * ordinary document-link handling does the same thing; this module is the click-time version
 * for a link that was drawn before the vault index arrived, and the one place that says how a
 * wikilink maps to a path and an anchor.
 */
import type { Platform } from '@/lib/platform';
import { pathInVault, relativeHref, resolveNote } from '@/preview/rules/obsidian/resolve';
import { slugify } from '@/preview/slug';

export interface WikilinkTarget {
  /** The name as typed (empty for `[[#Heading]]`). */
  target: string;
  heading: string | null;
  block: string | null;
}

/** The target of a rendered wikilink, or null when the element is not one. */
export function wikilinkOf(element: Element | null): WikilinkTarget | null {
  const link = element?.closest('a.wikilink');
  if (!link) return null;
  return {
    target: link.getAttribute('data-target') ?? '',
    heading: link.getAttribute('data-heading'),
    block: link.getAttribute('data-block'),
  };
}

/** The element id to scroll to: the slug of a heading, or `^id` of a block. */
export function anchorOf(link: WikilinkTarget): string | null {
  if (link.block !== null) return `^${link.block}`;
  if (link.heading !== null) return slugify(link.heading);
  return null;
}

export interface WikilinkHost {
  platform: Pick<Platform, 'openLinkedDocument' | 'vaultIndex'>;
  /** Opens (or shows) the document at this absolute path. */
  open(path: string): Promise<void>;
  /** Scrolls the document that is shown to an element id. */
  scrollTo(id: string): Promise<void>;
}

export type WikilinkResult = 'opened' | 'anchor' | 'unresolved';

/** Follows a wikilink of the note at `fromPath`. */
export async function followWikilink(
  host: WikilinkHost,
  fromPath: string,
  link: WikilinkTarget,
): Promise<WikilinkResult> {
  const anchor = anchorOf(link);
  if (link.target === '') {
    if (anchor === null) return 'unresolved';
    await host.scrollTo(anchor);
    return 'anchor';
  }
  const vault = await host.platform.vaultIndex(fromPath).catch(() => null);
  const from = pathInVault(vault, fromPath);
  const note = resolveNote(vault, from, link.target);
  if (note === null) return 'unresolved';
  const path = await host.platform.openLinkedDocument(fromPath, relativeHref(from, note));
  await host.open(path);
  if (anchor !== null) await host.scrollTo(anchor);
  return 'opened';
}
