/**
 * Markdown language support for the editor: the parser for the document's flavor plus the syntax
 * tags and decorations the theme colors.
 */
import { commonmarkLanguage, markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { type Extension, Facet, RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { styleTags, Tag, tags } from '@lezer/highlight';
import { type FlavorId, type ParserBase, parserBase } from './flavor';

/**
 * Tags that let the theme tell apart things the stock Markdown grammar tags alike. Each one
 * refines a standard tag, so a style written for the parent tag still applies to it.
 */
export const syntaxTags = {
  /** The `#` characters of a heading: primary color, as in the mock. */
  headingMark: Tag.define(tags.processingInstruction),
  /** `code` between backticks: gets the inline-code background. Fenced code is not affected. */
  inlineCode: Tag.define(tags.monospace),
};

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

const refinedTags = styleTags({
  [HEADING_NODES.map((heading) => `${heading}/HeaderMark`).join(' ')]: syntaxTags.headingMark,
  InlineCode: syntaxTags.inlineCode,
});

/** The flavor a state was created for (read it with `state.facet(flavorFacet)`). */
export const flavorFacet = Facet.define<FlavorId, FlavorId>({
  combine: (values) => values[0] ?? 'gfm',
});

const parsers = new Map<ParserBase, Extension>();

/**
 * One parser per grammar, shared by every document: each tab's state points at the same language
 * object instead of holding its own copy. Fenced code is highlighted by the language named on the
 * fence; the grammars come from `@codemirror/language-data` and load on first use, so a document
 * without code fences loads none of them.
 */
function parserSupport(base: ParserBase): Extension {
  let support = parsers.get(base);
  if (!support) {
    support = markdown({
      base: base === 'commonmark' ? commonmarkLanguage : markdownLanguage,
      codeLanguages: languages,
      extensions: { props: [refinedTags] },
      // Both are features of later phases (autocomplete UI, smart paste); keep the editor plain.
      completeHTMLTags: false,
      pasteURLAsLink: false,
      // Return and Backspace in lists are bound in lists.ts, which adds to the language's own.
      addKeymap: false,
    });
    parsers.set(base, support);
  }
  return support;
}

/**
 * Parsing for a flavor: strict CommonMark for `commonmark`, GFM (tables, task lists,
 * strikethrough, autolinks) for every other flavor in Phase 1. Put it in a compartment to switch
 * flavors without touching the document or the undo history.
 */
export function markdownSupport(flavor: FlavorId = 'gfm'): Extension {
  return [flavorFacet.of(flavor), parserSupport(parserBase(flavor))];
}

const openTask = Decoration.mark({ class: 'cm-wd-task' });
const doneTask = Decoration.mark({ class: 'cm-wd-task cm-wd-task-done' });

function taskMarkerDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  let last = -1;
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.name !== 'TaskMarker' || node.from <= last) return;
        last = node.from;
        // `[ ]` is open; `[x]` and `[X]` are done.
        const done = view.state.sliceDoc(node.from + 1, node.from + 2) !== ' ';
        builder.add(node.from, node.to, done ? doneTask : openTask);
      },
    });
  }
  return builder.finish();
}

/**
 * Colors task markers: `[ ]` as a list marker (secondary), `[x]` in tertiary. The stock grammar
 * gives both the same tag, so the checked state needs its own decoration.
 */
export const taskMarkers = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = taskMarkerDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = taskMarkerDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
