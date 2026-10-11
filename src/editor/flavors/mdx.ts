/**
 * The MDX editor module: ESM lines, JSX blocks and `{expressions}`
 * highlighted as JavaScript (JSX) inside the Markdown parser, and the Insert menu commands.
 *
 * Lezer Markdown extensions cannot be added to the language that the framework put in the state, so
 * this module brings its own Markdown language (GFM base, the same fenced-code languages and tags
 * as `src/editor/markdown.ts`) at high precedence. Nothing is evaluated: the JavaScript parser
 * only colors the text.
 */
import { jsxLanguage } from '@codemirror/lang-javascript';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { type Extension, Prec } from '@codemirror/state';
import { parseMixed } from '@lezer/common';
import { styleTags } from '@lezer/highlight';
import type { BlockParser, InlineParser, MarkdownConfig } from '@lezer/markdown';
import { insertBlock, insertInline, wrapSelection } from '../inserts';
import { syntaxTags } from '../markdown';
import type { FlavorEditor } from './index';

const HEADING_NODES = [
  'ATXHeading1',
  'ATXHeading2',
  'ATXHeading3',
  'ATXHeading4',
  'ATXHeading5',
  'ATXHeading6',
  'SetextHeading1',
  'SetextHeading2',
];

/** The same refinements as the shared Markdown language (heading marks, inline code). */
const refinedTags = styleTags({
  [HEADING_NODES.map((heading) => `${heading}/HeaderMark`).join(' ')]: syntaxTags.headingMark,
  InlineCode: syntaxTags.inlineCode,
});

const ESM_LINE = /^(?:import|export)(?:\s|\{|\*)/;
const JSX_LINE = /^<(?:[A-Z]|\/[A-Z]|>|\/>)/;
const BLANK = /^\s*$/;

const QUOTES = new Set([0x22, 0x27, 0x60]);
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const BACKSLASH = 0x5c;

/** A block that runs to the next blank line: ESM at the top of the document, or a JSX tag line. */
function untilBlankLine(name: string, code: string, test: RegExp): BlockParser {
  return {
    name,
    before: 'HTMLBlock',
    parse(cx, line) {
      if (cx.parentType().name !== 'Document') return false;
      if (line.indent > 3 || !test.test(line.text.slice(line.pos))) return false;
      const from = cx.lineStart + line.pos;
      while (cx.nextLine()) {
        if (BLANK.test(line.text)) break;
      }
      const to = cx.prevLineEnd();
      cx.addElement(cx.elt(name, from, to, [cx.elt(code, from, to)]));
      return true;
    },
  };
}

/** `{expression}` inside a line of text: braces balanced, quoted strings skipped. */
const expressionParser: InlineParser = {
  name: 'MdxExpression',
  before: 'Escape',
  parse(cx, next, pos) {
    if (next !== OPEN_BRACE) return -1;
    let depth = 0;
    for (let i = pos; i < cx.end; i++) {
      const char = cx.char(i);
      if (char === BACKSLASH) {
        i++;
      } else if (QUOTES.has(char)) {
        let j = i + 1;
        while (j < cx.end && cx.char(j) !== char) j += cx.char(j) === BACKSLASH ? 2 : 1;
        if (j >= cx.end) return -1;
        i = j;
      } else if (char === OPEN_BRACE) {
        depth++;
      } else if (char === CLOSE_BRACE && --depth === 0) {
        return cx.addElement(
          cx.elt('MdxExpression', pos, i + 1, [cx.elt('MdxExpressionCode', pos, i + 1)]),
        );
      }
    }
    return -1;
  },
};

const CODE_NODES = new Set(['MdxEsmCode', 'MdxJsxCode', 'MdxExpressionCode']);

const mdxSyntax: MarkdownConfig = {
  defineNodes: [
    { name: 'MdxEsm', block: true },
    { name: 'MdxEsmCode', block: true },
    { name: 'MdxJsx', block: true },
    { name: 'MdxJsxCode', block: true },
    { name: 'MdxExpression' },
    { name: 'MdxExpressionCode' },
  ],
  parseBlock: [
    untilBlankLine('MdxEsm', 'MdxEsmCode', ESM_LINE),
    untilBlankLine('MdxJsx', 'MdxJsxCode', JSX_LINE),
  ],
  parseInline: [expressionParser],
  // JSX covers ESM too (a superset of JavaScript for coloring); it never runs.
  wrap: parseMixed((node) => (CODE_NODES.has(node.name) ? { parser: jsxLanguage.parser } : null)),
};

const syntax: Extension = Prec.high(
  markdown({
    base: markdownLanguage,
    codeLanguages: languages,
    extensions: [{ props: [refinedTags] }, mdxSyntax],
    completeHTMLTags: false,
    pasteURLAsLink: false,
    addKeymap: false,
  }),
);

export const flavorEditor: FlavorEditor = {
  syntax,
  inserts: [
    {
      id: 'mdx-import',
      label: 'Import line',
      icon: 'edit-note',
      run: (view) => insertBlock(view, "import Name from './name.js'", { from: 7, to: 11 }),
    },
    {
      id: 'mdx-component',
      label: 'Component',
      icon: 'code-blocks',
      run: (view) =>
        view.state.selection.main.empty
          ? insertInline(view, '<Name></Name>', { from: 1, to: 5 })
          : wrapSelection(view, '<Name>', '</Name>'),
    },
    {
      id: 'mdx-expression',
      label: 'Expression',
      icon: 'text-fields',
      run: (view) => wrapSelection(view, '{', '}'),
    },
  ],
};
