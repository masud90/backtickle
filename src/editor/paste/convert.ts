/**
 * Clipboard HTML to Markdown (rule 4). This module and the unified packages it pulls in
 * are a lazy chunk, loaded on the first rich paste only.
 */
import DOMPurify from 'dompurify';
import { fromDom } from 'hast-util-from-dom';
import { toMdast } from 'hast-util-to-mdast';
import { gfmToMarkdown } from 'mdast-util-gfm';
import { toMarkdown } from 'mdast-util-to-markdown';
import type { FlavorId } from '../flavor';

export interface ConvertOptions {
  flavor: FlavorId;
  /** The page the HTML came from, to make relative links and image sources absolute. */
  baseUrl?: string;
}

const IMAGE_NOTE = 'image not pasted';
const FORBIDDEN = [
  'script',
  'style',
  'link',
  'meta',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'iframe',
  'object',
  'embed',
  'noscript',
  'template',
];

const styleOf = (el: Element) => (el.getAttribute('style') ?? '').toLowerCase();

/** An absolute http(s) or mailto URL, or null. */
function absolute(url: string, base: string | undefined): string | null {
  try {
    const parsed = new URL(url, base);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function unwrap(el: Element): void {
  el.replaceWith(...Array.from(el.childNodes));
}

function wrapChildren(el: Element, tag: string): void {
  const wrapper = el.ownerDocument.createElement(tag);
  wrapper.append(...Array.from(el.childNodes));
  el.append(wrapper);
}

/** `mso-list:l0 level2 lfo1` paragraphs become nested lists. */
function convertWordLists(root: Element): void {
  const doc = root.ownerDocument;
  const isItem = (el: Element | null): el is HTMLElement =>
    !!el && el.tagName === 'P' && /mso-list:\s*l\d+\s+level\d+/.test(styleOf(el));
  for (const p of Array.from(root.querySelectorAll('p'))) {
    if (!isItem(p) || !p.parentNode) continue;
    // One list: this paragraph and the item paragraphs that follow it directly.
    const items: HTMLElement[] = [];
    for (let el: Element | null = p; isItem(el); el = el.nextElementSibling) items.push(el);
    const top = doc.createElement('div');
    const stack: Array<{ level: number; list: Element; last: Element | null }> = [];
    for (const item of items) {
      const level = Number(/level(\d+)/.exec(styleOf(item))?.[1] ?? 1);
      let marker = '';
      for (const ignored of Array.from(item.querySelectorAll('span'))) {
        if (/mso-list:\s*ignore/.test(styleOf(ignored))) {
          marker = (ignored.textContent ?? '').trim();
          ignored.remove();
        }
      }
      for (const span of Array.from(item.querySelectorAll('span'))) {
        if (!(span.textContent ?? '').trim() && !span.querySelector('img')) span.remove();
      }
      const ordered = /^(?:\d+|[a-z]+|[ivxlcdm]+)[.)]/i.test(marker);
      while ((stack.at(-1)?.level ?? 0) > level) stack.pop();
      let entry = stack.at(-1);
      if (!entry || entry.level < level) {
        const list = doc.createElement(ordered ? 'ol' : 'ul');
        (entry?.last ?? top).append(list);
        entry = { level, list, last: null };
        stack.push(entry);
      }
      const li = doc.createElement('li');
      li.append(...Array.from(item.childNodes));
      entry.list.append(li);
      entry.last = li;
    }
    const first = top.firstElementChild;
    if (first) p.replaceWith(first);
    for (const item of items) if (item !== p) item.remove();
  }
}

/** Cleans the sanitized DOM: Word and Outlook markup, URLs, images, empty paragraphs. */
function tidy(root: Element, options: ConvertOptions): void {
  // Comments (Word's conditional comments, the clipboard fragment markers) never reach Markdown.
  const walker = root.ownerDocument.createTreeWalker(root, 128);
  const comments: Node[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) comments.push(node);
  for (const comment of comments) comment.parentNode?.removeChild(comment);
  // Office namespace elements (`<o:p>`, `<w:sdt>`) carry nothing of their own.
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (el.tagName.includes(':')) unwrap(el);
  }
  root.normalize();
  convertWordLists(root);
  for (const span of Array.from(root.querySelectorAll('span'))) {
    const style = styleOf(span);
    const bold = /font-weight:\s*(?:bold|[6-9]00)/.test(style);
    const italic = /font-style:\s*italic/.test(style);
    if (bold) wrapChildren(span, 'strong');
    if (italic) wrapChildren(span, 'em');
  }
  for (const a of Array.from(root.querySelectorAll('a'))) {
    const href = a.getAttribute('href');
    const url = href ? absolute(href, options.baseUrl) : null;
    if (url) a.setAttribute('href', url);
    else unwrap(a);
  }
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? '';
    const url = /^data:/i.test(src) ? null : absolute(src, options.baseUrl);
    if (url) {
      img.setAttribute('src', url);
    } else {
      const note = img.ownerDocument.createElement('em');
      note.textContent = IMAGE_NOTE;
      img.replaceWith(note);
    }
  }
  if (options.flavor === 'commonmark') {
    for (const el of Array.from(root.querySelectorAll('del, s, strike'))) unwrap(el);
  }
  for (const p of Array.from(root.querySelectorAll('p'))) {
    if (
      (p.textContent ?? '').replace(/[\s\u00a0]/g, '') === '' &&
      !p.querySelector('img, table, pre')
    ) {
      p.remove();
    }
  }
}

/** Replaces each table by a placeholder carrying its cleaned HTML (CommonMark has no tables). */
function tablesToHtml(root: Element): string[] {
  const blocks: string[] = [];
  for (const table of Array.from(root.querySelectorAll('table'))) {
    const clone = table.cloneNode(true) as Element;
    for (const el of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
      for (const name of el.getAttributeNames()) el.removeAttribute(name);
    }
    const html = clone.outerHTML.replace(/>\s+</g, '><').replace(/\n\s*\n/g, '\n');
    const holder = root.ownerDocument.createElement('wd-html');
    holder.setAttribute('data-index', String(blocks.length));
    blocks.push(html);
    table.replaceWith(holder);
  }
  return blocks;
}

/** The Markdown for the clipboard HTML in the document's flavor. */
export function htmlToMarkdown(html: string, options: ConvertOptions): string {
  // The wrapper keeps the parser from treating a leading <pre> or <table> specially.
  const body = DOMPurify.sanitize(`<div>${html}</div>`, {
    RETURN_DOM: true,
    FORCE_BODY: true,
    FORBID_TAGS: FORBIDDEN,
    FORBID_CONTENTS: ['script', 'style', 'noscript', 'template'],
  }) as unknown as Element;
  tidy(body, options);
  const commonmark = options.flavor === 'commonmark';
  const tables = commonmark ? tablesToHtml(body) : [];
  const hast = fromDom(body);
  const mdast = toMdast(hast, {
    handlers: commonmark
      ? {
          'wd-html': (_state, node) => ({
            type: 'html',
            value: tables[Number(node.properties?.dataIndex ?? 0)] ?? '',
          }),
        }
      : {},
  });
  const markdown = toMarkdown(mdast, {
    bullet: '-',
    emphasis: '*',
    strong: '*',
    fence: '`',
    rule: '-',
    listItemIndent: 'one',
    extensions: commonmark ? [] : [gfmToMarkdown()],
  });
  return markdown.replace(/\s+$/, '');
}
