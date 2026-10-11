/**
 * The two reading aids of the editor (Phase 4): the reading ruler and the focus-line spotlight.
 * Both are CodeMirror extensions that cost nothing while off. Their colors come from
 * `styles/a11y.css` (`--wd-ruler`, the 35% opacity of the dimmed lines).
 */
import { syntaxTree } from '@codemirror/language';
import { type EditorState, type Extension, RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type LayerMarker,
  layer,
  RectangleMarker,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';

export interface A11yEditorOptions {
  ruler: boolean;
  spotlight: boolean;
}

// ---- reading ruler ------------------------------------------------------------------------------

/**
 * A band one visual line high behind the line with the cursor, across the whole width of the
 * editor. A soft-wrapped line gets the band under the part that holds the cursor.
 */
const rulerLayer = layer({
  above: false,
  class: 'cm-wd-ruler-layer',
  markers(view): readonly LayerMarker[] {
    const head = view.state.selection.main.head;
    const coords = view.coordsAtPos(head);
    if (!coords) return [];
    const base = view.scrollDOM.getBoundingClientRect();
    const top = coords.top - base.top + view.scrollDOM.scrollTop;
    const width = Math.max(view.scrollDOM.scrollWidth, view.scrollDOM.clientWidth);
    return [new RectangleMarker('cm-wd-ruler', 0, top, width, coords.bottom - coords.top)];
  },
  update(update: ViewUpdate) {
    return (
      update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged
    );
  },
});

// ---- focus-line spotlight -----------------------------------------------------------------------

const bright = Decoration.line({ class: 'cm-wd-bright' });

/** The frontmatter at the top of the document (`---` to `---` or `...`), as a range, or null. */
function frontmatterRange(state: EditorState): { from: number; to: number } | null {
  const doc = state.doc;
  if (doc.lines < 3 || doc.line(1).text.trimEnd() !== '---') return null;
  for (let n = 2; n <= doc.lines; n++) {
    const text = doc.line(n).text.trimEnd();
    if (text === '---' || text === '...') return { from: 0, to: doc.line(n).to };
  }
  return null;
}

/** The document range of the Markdown block that holds `pos` (the top-level node), or its line. */
export function blockAround(state: EditorState, pos: number): { from: number; to: number } {
  const line = state.doc.lineAt(pos);
  const front = frontmatterRange(state);
  if (front && pos <= front.to) return front;
  const tree = syntaxTree(state);
  for (let node = tree.resolveInner(pos, 1); node; ) {
    const parent = node.parent;
    if (!parent) break; // the document itself
    if (parent.parent === null) {
      // `node` is a child of the document: a paragraph, a list, a code block, a table.
      if (node.from <= line.to && node.to >= line.from && node.from < node.to) {
        return { from: node.from, to: node.to };
      }
      break;
    }
    node = parent;
  }
  return { from: line.from, to: line.to };
}

function brightLines(view: EditorView): DecorationSet {
  const state = view.state;
  const { from, to } = blockAround(state, state.selection.main.head);
  const builder = new RangeSetBuilder<Decoration>();
  const last = state.doc.lineAt(Math.min(to, state.doc.length)).number;
  for (let n = state.doc.lineAt(from).number; n <= last; n++) {
    builder.add(state.doc.line(n).from, state.doc.line(n).from, bright);
  }
  return builder.finish();
}

const spotlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = brightLines(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = brightLines(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const spotlightClass = EditorView.editorAttributes.of({ class: 'cm-wd-spotlight' });

const NONE: Extension = [];
const RULER: Extension = rulerLayer;
const SPOTLIGHT: Extension = [spotlightClass, spotlightPlugin];
const BOTH: Extension = [RULER, SPOTLIGHT];

/** The extension for the options; the same value for the same options, so a compartment can compare. */
export function a11yExtension(options: A11yEditorOptions): Extension {
  if (options.ruler && options.spotlight) return BOTH;
  if (options.ruler) return RULER;
  if (options.spotlight) return SPOTLIGHT;
  return NONE;
}
