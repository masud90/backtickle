/**
 * What the Quarto rules keep in the markdown-it `env` besides the shared `wd` state: how deep an
 * included file is being rendered and which files are being rendered (to find a cycle).
 */
import type { Env } from 'markdown-it';
import { isAbsolutePath } from '@/lib/paths';

export interface QuartoState {
  /** 0 for the document, 1 for a file it includes, and so on. */
  depth: number;
  /** The keys of the files being rendered, outermost first. */
  stack: string[];
}

export type QuartoEnv = Env & { quarto?: QuartoState };

export const MAX_INCLUDE_DEPTH = 3;

/** The directory part of an include key (`a/b.qmd` gives `a`, `b.qmd` gives ''). */
function dirOf(key: string): string {
  const slash = key.lastIndexOf('/');
  return slash < 0 ? '' : key.slice(0, slash);
}

/**
 * The key an include goes by: its href relative to the document (the shell resolves hrefs
 * against the document, so a file included by an included file is named from the document's
 * folder). `parent` is the key of the file that contains the shortcode, '' for the document.
 */
export function resolveIncludeKey(parent: string, href: string): string {
  if (isAbsolutePath(href)) return href;
  const dir = dirOf(parent);
  const parts: string[] = [];
  for (const part of (dir === '' ? href : `${dir}/${href}`).split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..' && parts.length > 0 && parts.at(-1) !== '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

const INCLUDE = /\{\{<\s*include\s+([^>\n]*?)\s*>\}\}/g;

/** The hrefs of the include shortcodes in a text, as written. */
export function includeHrefs(text: string): string[] {
  if (!text.includes('{{<')) return [];
  const found: string[] = [];
  for (const match of text.matchAll(INCLUDE)) {
    const href = (match[1] ?? '').trim().replace(/^(["'])(.*)\1$/, '$2');
    if (href !== '' && !found.includes(href)) found.push(href);
  }
  return found;
}
