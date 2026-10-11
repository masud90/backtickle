/**
 * The editor side of Obsidian: Lezer Markdown extensions for
 * wikilinks, embeds, highlights, comments (inline and block), tags and callout headers; the
 * Insert commands; and the completion of note names after `[[` and `![[`, fed from the vault
 * index through the framework's completion data.
 */

import type { Completion, CompletionSource } from '@codemirror/autocomplete';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { Prec } from '@codemirror/state';
import { styleTags, tags } from '@lezer/highlight';
import type { BlockContext, Line, MarkdownConfig } from '@lezer/markdown';
import { getCompletionData, noteSource } from '../complete';
import { insertBlock, wrapSelection } from '../inserts';
import { syntaxTags } from '../markdown';
import type { FlavorEditor, InsertCommand } from './index';

const BANG = 33;
const HASH = 35;
const PERCENT = 37;
const EQUALS = 61;
const OPEN = 91;

const TAG_CHAR = /[\p{L}\p{N}_/-]/u;

/** The Lezer extension. */
export const obsidianMarkdown: MarkdownConfig = {
  defineNodes: [
    'Wikilink',
    'WikiEmbed',
    'Highlight',
    'ObsidianComment',
    'ObsidianCommentBlock',
    'ObsidianTag',
    'CalloutMark',
  ],
  parseInline: [
    {
      name: 'Wikilink',
      before: 'Link',
      parse(cx, next, pos) {
        const embed = next === BANG;
        const start = embed ? pos + 1 : pos;
        if (!embed && next !== OPEN) return -1;
        if (cx.char(start) !== OPEN || cx.char(start + 1) !== OPEN) return -1;
        const text = cx.slice(start + 2, cx.end);
        const match = /^[^[\]\n]+\]\]/.exec(text);
        if (!match) return -1;
        const end = start + 2 + match[0].length;
        return cx.addElement(cx.elt(embed ? 'WikiEmbed' : 'Wikilink', pos, end));
      },
    },
    {
      name: 'Highlight',
      before: 'Emphasis',
      parse(cx, next, pos) {
        if (next !== EQUALS || cx.char(pos + 1) !== EQUALS || cx.char(pos + 2) === EQUALS) {
          return -1;
        }
        const text = cx.slice(pos + 2, cx.end);
        const match = /^[^\s=](?:[^\n]*?[^\s])?==/.exec(text) ?? /^[^\s=]==/.exec(text);
        if (!match) return -1;
        return cx.addElement(cx.elt('Highlight', pos, pos + 2 + match[0].length));
      },
    },
    {
      name: 'ObsidianComment',
      before: 'Emphasis',
      parse(cx, next, pos) {
        if (next !== PERCENT || cx.char(pos + 1) !== PERCENT) return -1;
        const text = cx.slice(pos + 2, cx.end);
        const close = text.indexOf('%%');
        if (close < 0) return -1;
        return cx.addElement(cx.elt('ObsidianComment', pos, pos + 2 + close + 2));
      },
    },
    {
      name: 'ObsidianTag',
      before: 'Emphasis',
      parse(cx, next, pos) {
        if (next !== HASH) return -1;
        const before = pos > cx.offset ? cx.slice(pos - 1, pos) : ' ';
        if (!/[\s([{"'>*~=]/.test(before)) return -1;
        let end = pos + 1;
        while (end < cx.end && TAG_CHAR.test(cx.slice(end, end + 1))) end++;
        const name = cx.slice(pos + 1, end);
        if (name === '' || /^\d+$/.test(name)) return -1;
        return cx.addElement(cx.elt('ObsidianTag', pos, end));
      },
    },
    {
      name: 'CalloutMark',
      before: 'Link',
      parse(cx, next, pos) {
        if (next !== OPEN || cx.char(pos + 1) !== BANG) return -1;
        if (cx.slice(cx.offset, pos).trim() !== '') return -1;
        const match = /^\[![A-Za-z0-9_-]+\][+-]?/.exec(cx.slice(pos, cx.end));
        if (!match) return -1;
        return cx.addElement(cx.elt('CalloutMark', pos, pos + match[0].length));
      },
    },
  ],
  parseBlock: [
    {
      // `%%` alone on a line (or with text) up to a later line with the closing `%%`, over blank lines.
      name: 'ObsidianCommentBlock',
      before: 'LinkReference',
      parse(cx: BlockContext, line: Line) {
        const first = line.text.slice(line.pos);
        if (!first.startsWith('%%') || first.indexOf('%%', 2) >= 0) return false;
        const from = cx.lineStart + line.pos;
        let end = cx.lineStart + line.text.length;
        while (cx.nextLine()) {
          end = cx.lineStart + line.text.length;
          if (line.text.includes('%%')) {
            cx.nextLine();
            break;
          }
        }
        cx.addElement(cx.elt('ObsidianCommentBlock', from, end));
        return true;
      },
    },
  ],
  props: [
    styleTags({
      Wikilink: tags.link,
      WikiEmbed: tags.link,
      Highlight: tags.attributeName,
      ObsidianComment: tags.comment,
      ObsidianCommentBlock: tags.comment,
      ObsidianTag: tags.tagName,
      CalloutMark: tags.processingInstruction,
    }),
  ],
};

// ---- Insert commands ---------------------------------------------------------

export const obsidianInserts: InsertCommand[] = [
  {
    id: 'obsidian-wikilink',
    label: 'Wikilink',
    icon: 'link',
    run: (view) => wrapSelection(view, '[[', ']]', 'Note'),
  },
  {
    id: 'obsidian-embed',
    label: 'Embed',
    icon: 'image',
    run: (view) => wrapSelection(view, '![[', ']]', 'Note'),
  },
  {
    id: 'obsidian-callout',
    label: 'Callout',
    icon: 'info',
    run: (view) => insertBlock(view, '> [!note] Title\n> Content', { from: 4, to: 8 }),
  },
  {
    id: 'obsidian-highlight',
    label: 'Highlight',
    icon: 'text-fields',
    run: (view) => wrapSelection(view, '==', '==', 'text'),
  },
  {
    id: 'obsidian-tag',
    label: 'Tag',
    icon: 'edit-note',
    run: (view) => wrapSelection(view, '#', '', 'tag'),
  },
  {
    id: 'obsidian-comment',
    label: 'Comment',
    icon: 'code',
    run: (view) => wrapSelection(view, '%%', '%%', 'comment'),
  },
];

const syntax = Prec.high(
  markdown({
    base: markdownLanguage,
    codeLanguages: languages,
    extensions: [
      obsidianMarkdown,
      {
        props: [
          styleTags({
            'ATXHeading1/HeaderMark ATXHeading2/HeaderMark ATXHeading3/HeaderMark ATXHeading4/HeaderMark ATXHeading5/HeaderMark ATXHeading6/HeaderMark SetextHeading1/HeaderMark SetextHeading2/HeaderMark':
              syntaxTags.headingMark,
            InlineCode: syntaxTags.inlineCode,
          }),
        ],
      },
    ],
    completeHTMLTags: false,
    pasteURLAsLink: false,
    addKeymap: false,
  }),
);

/** The ATX headings of a note's text (not inside fenced code), as written without the marks. */
export function headingsOf(text: string): string[] {
  const out: string[] = [];
  let fence = '';
  for (const line of text.split(/\r\n?|\n/)) {
    const marks = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marks) {
      if (fence === '') fence = marks;
      else if (marks.startsWith(fence.charAt(0)) && marks.length >= fence.length) fence = '';
      continue;
    }
    if (fence !== '') continue;
    const heading = /^ {0,3}#{1,6}[ \t]+(.*?)[ \t]*(?:[ \t]#+[ \t]*)?$/.exec(line)?.[1];
    if (heading) out.push(heading);
  }
  return out;
}

const HEADING_LINK = /!?\[\[([^\]\n|#]*)#([^\]\n|#^]*)$/;

/** Headings after `[[#` (this note) and `[[Note#` (that note, through the shell's hook). */
export const headingSource: CompletionSource = async (context) => {
  const match = context.matchBefore(HEADING_LINK);
  if (!match) return null;
  const parts = HEADING_LINK.exec(match.text);
  const name = (parts?.[1] ?? '').trim();
  const typed = parts?.[2] ?? '';
  let headings: string[];
  if (name === '') {
    headings = headingsOf(context.state.doc.toString());
  } else {
    const lookup = getCompletionData(context.state).noteHeadings;
    if (!lookup) return null;
    try {
      headings = await lookup(name);
    } catch {
      return null;
    }
  }
  if (context.aborted || headings.length === 0) return null;
  const from = match.to - typed.length;
  const options: Completion[] = [...new Set(headings)].map((heading) => ({
    label: heading,
    type: 'text',
    apply: (view, _completion, start, end) => {
      const closed = view.state.sliceDoc(end, end + 2) === ']]';
      view.dispatch({
        changes: { from: start, to: end, insert: closed ? heading : `${heading}]]` },
        selection: { anchor: start + heading.length + (closed ? 0 : 2) },
        userEvent: 'input.complete',
      });
    },
  }));
  return { from, options, validFor: /^[^\]\n|#^]*$/ };
};

export const flavorEditor: FlavorEditor = {
  syntax,
  inserts: obsidianInserts,
  completions: [noteSource, headingSource],
};
