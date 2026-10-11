import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createPandocPipeline } from '@/preview/packs/pandoc';
import type { ContextInputs } from '@/preview/types';

export const PANDOC =
  '/Applications/RStudio.app/Contents/Resources/app/quarto/bin/tools/aarch64/pandoc';
export const HAS_PANDOC = existsSync(PANDOC);

export const NO_INPUTS: ContextInputs = {
  path: null,
  bibliographies: [],
  includes: new Map(),
  vault: null,
  project: null,
};

export function pipeline() {
  return createPandocPipeline();
}

/** Raw HTML of the Pandoc pack for a source, with its context. */
export function ours(source: string, path: string | null = null): string {
  const p = pipeline();
  const context = p.prepare?.(source, { ...NO_INPUTS, path });
  return p.renderRaw(source, context);
}

/** Sanitized blocks joined, for security and structure checks. */
export function sanitized(source: string, path: string | null = null): string {
  const p = pipeline();
  const context = p.prepare?.(source, { ...NO_INPUTS, path });
  return p
    .render(source, context)
    .blocks.map((block) => block.html)
    .join('\n');
}

export function pandocHtml(source: string): string {
  return execFileSync(PANDOC, ['-f', 'markdown', '-t', 'html', '--wrap=none'], {
    input: source,
    encoding: 'utf8',
  });
}

/** A structural form of HTML: tags, the listed attributes, collapsed text. */
export function canon(html: string, attributes: string[] = []): string {
  const root = document.createElement('div');
  root.innerHTML = html;
  const walk = (node: Node): string => {
    if (node.nodeType === 3) return (node.textContent ?? '').replace(/\s+/g, ' ');
    if (!(node instanceof Element)) return '';
    const attrs = attributes
      .filter((name) => node.hasAttribute(name))
      .map((name) => ` ${name}="${node.getAttribute(name)}"`)
      .join('');
    const inner = [...node.childNodes].map(walk).join('');
    return `<${node.tagName.toLowerCase()}${attrs}>${inner}</${node.tagName.toLowerCase()}>`;
  };
  return [...root.childNodes]
    .map(walk)
    .join('')
    .replace(/> +</g, '><')
    .replace(/<(\w+)> /g, '<$1>')
    .replace(/ <\/(\w+)>/g, '</$1>')
    .trim();
}
