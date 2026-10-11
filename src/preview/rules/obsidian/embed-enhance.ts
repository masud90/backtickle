/**
 * Fills an embedded note (`div.embed > div.embed-content`) after the block was sanitized and
 * shown. The placeholder carries `data-href` (the path of the note
 * seen from the note in the tab) and `data-from` (that note's absolute path); this code reads the
 * target through `platform.readLinkedText(from, href, 'embed')`, takes the section or block the
 * embed names, renders it with the Obsidian pack (its own pipeline instance, so the result is
 * sanitized like the document), cleans it of everything that would confuse the host document
 * (ids, source line numbers, task toggles), and inserts it. Embeds inside it are filled the same
 * way, up to two levels deep; a note that is already open higher up shows a muted cycle card.
 *
 * Nothing inside an embed is part of the words or the outline: the host's parse saw only the
 * placeholder. What the document says in `data-from` and `data-href` can only name files inside
 * the vault of a document that was opened (the backend checks both).
 */
import { getPlatform, type LinkedText, type Platform } from '@/lib/platform';
import { recordEmbed } from '../../embed-links';
import type { EnhanceContext } from '../../enhance';
import { enhanceBlock } from '../../enhance';
import { contextFor } from './context';
import { extractBlock, extractHeading, stripFrontmatter } from './embed-section';
import { knownVaultOf, rememberVault } from './resolve';

/** How many levels of embedded notes are shown. */
export const MAX_EMBED_DEPTH = 2;

const filled = new WeakSet<Element>();
/** Embeds on the page with the file each one shows, so a changed note can fill them again. */
const shown = new Map<Element, { path: string; context: EnhanceContext }>();
const chains = new WeakMap<Element, string[]>();

const CACHE_MS = 3000;
const reads = new Map<string, { at: number; text: Promise<LinkedText> }>();

function read(platform: Platform, from: string, href: string): Promise<LinkedText> {
  const key = `${from}\u0001${href}`;
  const known = reads.get(key);
  if (known && Date.now() - known.at < CACHE_MS) return known.text;
  const text = platform.readLinkedText(from, href, 'embed');
  reads.set(key, { at: Date.now(), text });
  text.catch(() => reads.delete(key));
  if (reads.size > 40) reads.delete(reads.keys().next().value as string);
  return text;
}

function showNote(content: Element, message: string, kind: string): void {
  const note = content.ownerDocument.createElement('p');
  note.className = `embed-note ${kind}`;
  note.textContent = message;
  content.replaceChildren(note);
}

const CLEANED = ['id', 'data-line', 'data-end-line', 'data-key', 'data-wd-rl', 'data-wd-trl'];

/** Takes the block wrappers away and removes what only makes sense in the document itself. */
function clean(root: ParentNode): void {
  for (const wrapper of [...root.querySelectorAll('.wd-block')]) {
    wrapper.replaceWith(...wrapper.childNodes);
  }
  for (const element of root.querySelectorAll(
    '[id], [data-line], [data-end-line], [data-key], [data-wd-rl], [data-wd-trl], [data-task-line]',
  )) {
    for (const name of CLEANED) element.removeAttribute(name);
    // A task box in an embed does not toggle a line of the host.
    element.removeAttribute('data-task-line');
  }
}

async function vaultOf(platform: Platform, from: string) {
  const known = knownVaultOf(from);
  if (known) return known;
  const index = await platform.vaultIndex(from);
  if (index) rememberVault(index);
  return index;
}

async function fill(element: Element, context: EnhanceContext): Promise<void> {
  if (filled.has(element)) return;
  filled.add(element);
  const from = element.getAttribute('data-from');
  const href = element.getAttribute('data-href');
  const content = element.querySelector(':scope > .embed-content');
  if (!from || !href || !content) return;
  const chain = chains.get(element) ?? [from];
  element.classList.add('is-loading');
  try {
    const platform = await getPlatform();
    const file = await read(platform, from, href);
    recordEmbed(chain[0] ?? from, file.path);
    shown.set(element, { path: file.path, context });
    if (chain.includes(file.path)) {
      showNote(content, 'This note is embedded in itself (embed cycle).', 'embed-cycle');
      return;
    }
    if (chain.length > MAX_EMBED_DEPTH) {
      showNote(content, 'Embeds are shown two levels deep.', 'embed-limit');
      return;
    }
    let text = stripFrontmatter(file.text);
    const heading = element.getAttribute('data-heading');
    const block = element.getAttribute('data-block');
    if (heading) {
      const section = extractHeading(text, heading);
      if (section === null)
        return showNote(content, `Heading not found: ${heading}`, 'embed-missing');
      text = section;
    } else if (block) {
      const found = extractBlock(text, block);
      if (found === null) return showNote(content, `Block not found: ^${block}`, 'embed-missing');
      text = found;
    }
    const vault = await vaultOf(platform, from);
    const { sharedEmbedPipeline } = await import('../../packs/obsidian');
    const pipeline = sharedEmbedPipeline();
    const result = pipeline.render(text, contextFor(vault, file.path, from));
    const template = element.ownerDocument.createElement('template');
    template.innerHTML = result.blocks.map((rendered) => rendered.html).join('');
    clean(template.content);
    const nestedChain = [...chain, file.path];
    for (const nested of template.content.querySelectorAll('.embed')) {
      chains.set(nested, nestedChain);
    }
    content.replaceChildren(template.content);
    await Promise.allSettled(enhanceBlock(content, context));
  } catch {
    showNote(content, 'This note could not be read.', 'embed-error');
  } finally {
    element.classList.remove('is-loading');
  }
}

/** Starts filling an embed placeholder. Resolves when it and the embeds inside it are done. */
export function fillEmbed(element: Element, context: EnhanceContext): Promise<void> {
  return fill(element, context);
}

/** Notes changed on disk: the embeds that show them read and render again. */
export async function refreshEmbeds(paths: readonly string[]): Promise<void> {
  reads.clear();
  const work: Promise<void>[] = [];
  for (const [element, entry] of [...shown]) {
    if (!element.isConnected) {
      shown.delete(element);
    } else if (paths.includes(entry.path)) {
      filled.delete(element);
      work.push(fill(element, entry.context));
    }
  }
  await Promise.allSettled(work);
}
