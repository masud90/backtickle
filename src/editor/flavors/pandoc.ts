/**
 * The editor side of Pandoc / MultiMarkdown: Lezer Markdown
 * extensions for fenced div markers, attributes `{...}`, citations `@key` (colored as links),
 * footnote markers and CriticMarkup; the Insert commands; and the citation completion.
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { Prec } from '@codemirror/state';
import { styleTags, tags } from '@lezer/highlight';
import type { InlineContext, MarkdownConfig } from '@lezer/markdown';
import { citationSource } from '../complete';
import { insertBlock, wrapSelection } from '../inserts';
import { syntaxTags } from '../markdown';
import type { FlavorEditor, InsertCommand } from './index';

const AT = 64;
const COLON = 58;
const BRACE = 123;
const CIRCUMFLEX = 94;
const KEY_CHARS = /[\w:.#$%&\-+?<>~/]/;
const CRITIC_CLOSERS: Record<string, string> = {
  '++': '++}',
  '--': '--}',
  '~~': '~~}',
  '==': '==}',
  '>>': '<<}',
};
const CRITIC_NODES: Record<string, string> = {
  '++': 'CriticAdd',
  '--': 'CriticDelete',
  '~~': 'CriticSubstitute',
  '==': 'CriticHighlight',
  '>>': 'CriticComment',
};

function lineStartOf(cx: InlineContext, pos: number): boolean {
  return pos === cx.offset || /^\s*$/.test(cx.slice(cx.offset, pos));
}

/** The Lezer extension: inline parsers, because fenced div lines are paragraph lines. */
export const pandocMarkdown: MarkdownConfig = {
  defineNodes: [
    'DivMarker',
    'Attributes',
    'Citation',
    'FootnoteMark',
    'CriticAdd',
    'CriticDelete',
    'CriticSubstitute',
    'CriticHighlight',
    'CriticComment',
  ],
  parseInline: [
    {
      name: 'DivMarker',
      before: 'Escape',
      parse(cx, next, pos) {
        if (next !== COLON || !lineStartOf(cx, pos)) return -1;
        const text = cx.slice(pos, cx.end);
        const match = /^:{3,}/.exec(text);
        if (!match) return -1;
        return cx.addElement(cx.elt('DivMarker', pos, pos + match[0].length));
      },
    },
    {
      name: 'Attributes',
      before: 'Escape',
      parse(cx, next, pos) {
        if (next !== BRACE) return -1;
        const match = /^\{(?:[^{}\n"]|"[^"\n]*")*\}/.exec(cx.slice(pos, cx.end));
        if (!match) return -1;
        const body = match[0];
        if (!/^\{\s*[#.=]|^\{\s*[\w-]+=/.test(body)) return -1;
        return cx.addElement(cx.elt('Attributes', pos, pos + body.length));
      },
    },
    {
      name: 'Critic',
      before: 'Escape',
      parse(cx, next, pos) {
        if (next !== BRACE) return -1;
        const kind = cx.slice(pos + 1, pos + 3);
        const closer = CRITIC_CLOSERS[kind];
        const node = CRITIC_NODES[kind];
        if (!closer || !node) return -1;
        const text = cx.slice(pos, cx.end);
        const end = text.indexOf(closer, 3);
        if (end < 0) return -1;
        return cx.addElement(cx.elt(node, pos, pos + end + closer.length));
      },
    },
    {
      name: 'Citation',
      before: 'Link',
      parse(cx, next, pos) {
        if (next !== AT) return -1;
        const before = pos > cx.offset ? cx.slice(pos - 1, pos) : ' ';
        if (!/[\s[;(-]/.test(before)) return -1;
        let end = pos + 1;
        while (end < cx.end && KEY_CHARS.test(cx.slice(end, end + 1))) end++;
        // A trailing punctuation mark is not part of the key.
        while (end > pos + 1 && /[.:;,?!)]/.test(cx.slice(end - 1, end))) end--;
        if (end === pos + 1) return -1;
        return cx.addElement(cx.elt('Citation', pos, end));
      },
    },
    {
      name: 'FootnoteMark',
      before: 'Link',
      parse(cx, next, pos) {
        if (next !== CIRCUMFLEX || cx.slice(pos + 1, pos + 2) !== '[') return -1;
        return cx.addElement(cx.elt('FootnoteMark', pos, pos + 2));
      },
    },
  ],
  props: [
    styleTags({
      DivMarker: tags.processingInstruction,
      Attributes: tags.labelName,
      Citation: tags.link,
      FootnoteMark: tags.processingInstruction,
      CriticAdd: tags.link,
      CriticDelete: tags.strikethrough,
      CriticSubstitute: tags.link,
      CriticHighlight: tags.emphasis,
      CriticComment: tags.comment,
    }),
  ],
};

// ---- Insert commands ---------------------------------------------------------

export const pandocInserts: InsertCommand[] = [
  {
    id: 'pandoc-citation',
    label: 'Citation',
    icon: 'link',
    run: (view) => wrapSelection(view, '[@', ']', 'key'),
  },
  {
    id: 'pandoc-footnote',
    label: 'Footnote',
    icon: 'info',
    run: (view) => wrapSelection(view, '^[', ']', 'note'),
  },
  {
    id: 'pandoc-div',
    label: 'Fenced div',
    icon: 'code-blocks',
    run: (view) => {
      const text = '::: {.class}\nContent\n:::';
      return insertBlock(view, text, { from: 5, to: 10 });
    },
  },
  {
    id: 'pandoc-deflist',
    label: 'Definition list',
    icon: 'format-list-bulleted',
    run: (view) => {
      const text = 'Term\n: Definition';
      return insertBlock(view, text, { from: 0, to: 4 });
    },
  },
  {
    id: 'pandoc-superscript',
    label: 'Superscript',
    icon: 'text-fields',
    run: (view) => wrapSelection(view, '^', '^', 'sup'),
  },
  {
    id: 'pandoc-subscript',
    label: 'Subscript',
    icon: 'text-fields',
    run: (view) => wrapSelection(view, '~', '~', 'sub'),
  },
];

/**
 * A second Markdown language with the Pandoc extension, ahead of the base one in the flavor slot
 * (the editor takes the language with the highest precedence).
 */
const syntax = Prec.high(
  markdown({
    base: markdownLanguage,
    codeLanguages: languages,
    extensions: [
      pandocMarkdown,
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

export const flavorEditor: FlavorEditor = {
  syntax,
  inserts: pandocInserts,
  completions: [citationSource],
};
