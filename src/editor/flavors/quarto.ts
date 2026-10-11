/**
 * The editor side of Quarto / R Markdown: the Pandoc syntax, code in
 * chunks (```` ```{r label, echo=FALSE} ````) colored by its language, the `#|` option lines in
 * the metadata color, the Insert commands (the Pandoc ones plus chunk, callout, cross-reference,
 * tabset and figure) and the completions: citation keys and cross-reference labels.
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { LanguageDescription, syntaxTree } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { Prec, RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { styleTags } from '@lezer/highlight';
import { citationSource, labelSource } from '../complete';
import { insertBlock, insertInline } from '../inserts';
import { syntaxTags } from '../markdown';
import type { FlavorEditor, InsertCommand } from './index';
import { pandocInserts, pandocMarkdown } from './pandoc';

/** The language of a fence: the first word of the info string, with or without braces. */
function chunkLanguage(info: string): LanguageDescription | null {
  const word = /^\{?\s*\.?([A-Za-z][\w+-]*)/.exec(info.trim())?.[1];
  return word ? LanguageDescription.matchLanguageName(languages, word, true) : null;
}

// ---- `#|` option lines ----------------------------------------------------------------------

const optionLine = Decoration.line({ class: 'cm-wd-chunk-option' });

function optionDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  const tree = syntaxTree(state);
  let last = -1;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (line.from <= last || !line.text.startsWith('#|')) continue;
      // Only inside a fence whose info string is a chunk header: `{r ...}`.
      for (let node = tree.resolveInner(line.from, 1); node.parent; node = node.parent) {
        if (node.name !== 'FencedCode') continue;
        const info = node.getChild('CodeInfo');
        if (info && state.sliceDoc(info.from, info.to).trimStart().startsWith('{')) {
          builder.add(line.from, line.from, optionLine);
          last = line.from;
        }
        break;
      }
    }
  }
  return builder.finish();
}

const chunkOptions = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = optionDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = optionDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const optionTheme = EditorView.baseTheme({
  '.cm-wd-chunk-option, .cm-wd-chunk-option span': {
    color: 'var(--wd-on-surface-variant)',
    fontStyle: 'italic',
  },
});

// ---- Insert commands ---------------------------------------------------------------------------

function chunk(id: string, label: string, lang: string): InsertCommand {
  const text = `\`\`\`{${lang}}\n#| label: name\n\n\`\`\``;
  const start = text.indexOf('label: ') + 7;
  return {
    id,
    label,
    icon: 'code-blocks',
    run: (view) => insertBlock(view, text, { from: start, to: start + 4 }),
  };
}

export const quartoInserts: InsertCommand[] = [
  ...pandocInserts,
  chunk('quarto-chunk-r', 'Code chunk: R', 'r'),
  chunk('quarto-chunk-python', 'Code chunk: Python', 'python'),
  chunk('quarto-chunk-julia', 'Code chunk: Julia', 'julia'),
  chunk('quarto-chunk-sql', 'Code chunk: SQL', 'sql'),
  {
    id: 'quarto-callout',
    label: 'Callout',
    icon: 'info',
    // The type is selected: type note, tip, important, warning or caution over it.
    run: (view) => insertBlock(view, '::: {.callout-note}\nContent\n:::', { from: 13, to: 17 }),
  },
  {
    id: 'quarto-xref',
    label: 'Cross-reference',
    icon: 'link',
    run: (view) => insertInline(view, '@fig-label', { from: 5, to: 10 }),
  },
  {
    id: 'quarto-tabset',
    label: 'Tabset',
    icon: 'code-blocks',
    run: (view) =>
      insertBlock(
        view,
        '::: {.panel-tabset}\n\n## First tab\n\nContent\n\n## Second tab\n\nContent\n\n:::',
        { from: 25, to: 34 },
      ),
  },
  {
    id: 'quarto-figure',
    label: 'Figure with label',
    icon: 'image',
    run: (view) => insertBlock(view, '![Caption](image.png){#fig-label}', { from: 2, to: 9 }),
  },
];

/** Pandoc syntax and chunk code, in a language of its own ahead of the base one in the slot. */
const syntax = Prec.high([
  markdown({
    base: markdownLanguage,
    codeLanguages: chunkLanguage,
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
  chunkOptions,
  optionTheme,
]);

export const flavorEditor: FlavorEditor = {
  syntax,
  inserts: quartoInserts,
  completions: [citationSource, labelSource],
};
