/** The self-contained HTML page of File > Export > HTML. */
import type { RenderResult } from '@/preview/types';
import { lightCss } from './css';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The title: the title block, else the first heading of level 1, else the file name. */
export function pageTitle(
  result: Pick<RenderResult, 'frontmatter' | 'headings'>,
  fileName: string,
): string {
  const value = result.frontmatter?.data.title;
  if (typeof value === 'string' || typeof value === 'number') {
    const title = String(value).replace(/\s+/g, ' ').trim();
    if (title !== '') return title;
  }
  const h1 = result.headings.find((heading) => heading.level === 1);
  const heading = h1?.text.replace(/\s+/g, ' ').trim();
  if (heading) return heading;
  const base = fileName.replace(/\.[^./]+$/, '').trim();
  return base === '' ? 'Untitled' : base;
}

/** `<!doctype html>` page: charset, title, the light theme CSS inline, the body, no script. */
export function buildPage(
  title: string,
  body: string,
  preview: { css: string; lightCodeCards: boolean } = { css: '', lightCodeCards: false },
): string {
  return [
    '<!doctype html>',
    `<html lang="en" data-theme="light"${preview.lightCodeCards ? ' data-wd-code-cards="light"' : ''}>`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light">',
    '<meta name="generator" content="Writedown">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>\n${lightCss()}${preview.css === '' ? '' : `\n${preview.css}`}\n</style>`,
    '</head>',
    '<body>',
    `<main><article class="wd-preview">${body}</article></main>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
