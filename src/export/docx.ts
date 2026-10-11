/** File > Export > Word Document: the request for Pandoc. */
import type { FlavorId } from '@/flavors';
import type { DocxRequest, Platform } from '@/lib/platform';
import type { RenderResult } from '@/preview/types';
import { documentHtml } from './document-html';
import { dataUriResolver } from './images';

/** The Pandoc input format per flavor. Obsidian and MDX go through the document HTML. */
export function pandocRoute(flavor: FlavorId, fileName: string): string {
  switch (flavor) {
    case 'commonmark':
      return 'commonmark';
    case 'gfm':
      return 'gfm+tex_math_dollars';
    case 'pandoc':
      return /\.mmd$/i.test(fileName) ? 'markdown_mmd' : 'markdown';
    case 'quarto':
      return 'markdown';
    case 'obsidian':
    case 'mdx':
      return 'html';
  }
}

/** The leading YAML block of a document, or null. */
function leadingYaml(text: string): string | null {
  const match = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
  return match ? (match[1] ?? null) : null;
}

/** The document names a bibliography or lists references in its metadata. */
export function hasBibliography(text: string): boolean {
  const yaml = leadingYaml(text);
  return yaml !== null && /^(?:bibliography|references)[ \t]*:/m.test(yaml);
}

/** The suggested file name: the document name with `.docx`. */
export function suggestedDocxName(name: string): string {
  const base = name.replace(/\.[^./]+$/, '').trim();
  return `${base === '' ? 'Untitled' : base}.docx`;
}

export interface DocxInput {
  platform: Platform;
  flavor: FlavorId;
  fileName: string;
  docPath: string | null;
  text: string;
  result: RenderResult;
  outPath: string;
}

/** The request: the source (or, for Obsidian and MDX, the document HTML) and the route. */
export async function buildDocxRequest(input: DocxInput): Promise<DocxRequest> {
  const route = pandocRoute(input.flavor, input.fileName);
  const html = route === 'html';
  const body = html
    ? await documentHtml(input.result.blocks, {
        resolveImage:
          input.docPath === null ? null : dataUriResolver(input.platform, input.docPath),
      })
    : input.text;
  return {
    docPath: input.docPath,
    outPath: input.outPath,
    input: html ? `<!doctype html><meta charset="utf-8"><body>${body}</body>` : body,
    from: route,
    citeproc: !html && hasBibliography(input.text),
  };
}
