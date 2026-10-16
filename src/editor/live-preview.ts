/**
 * Live preview in the editor: the Markdown is shown formatted as it is written.
 *
 * Outside the lines that hold the caret or a selection, the syntax marks are hidden: heading
 * `#`s, emphasis stars, code ticks, the brackets and address of a link, quote marks. Bullets
 * become dots, task boxes become checkboxes that can be clicked, a rule becomes a line and a
 * local image is drawn in place (through the document's resolver, as in the preview; a remote
 * image shows its alt text). The lines the caret is on show the plain source, so editing is
 * never hidden. The text itself is never changed by this module, only how it is drawn.
 *
 * It is a lazy chunk: it is loaded once the setting is on.
 */
import { syntaxTree } from '@codemirror/language';
import { type EditorState, type Extension, type Range, RangeSet } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import type { SyntaxNodeRef } from '@lezer/common';

type ImageResolver = (source: string) => Promise<string>;

const resolvers = new WeakMap<EditorView, ImageResolver | null>();

/** How the editor of `view` finds local images (the document's folder); null: none drawn. */
export function setLivePreviewImages(view: EditorView, resolve: ImageResolver | null): void {
  resolvers.set(view, resolve);
}

/** The line numbers (1-based) that hold the caret or part of a selection. */
function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return lines;
}

const hide = Decoration.replace({});

class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-lp-bullet';
    span.textContent = '•';
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
}

class CheckboxWidget extends WidgetType {
  readonly done: boolean;
  readonly at: number;
  constructor(done: boolean, at: number) {
    super();
    this.done = done;
    this.at = at;
  }
  override eq(other: CheckboxWidget): boolean {
    return other.done === this.done && other.at === this.at;
  }
  override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-lp-task';
    box.checked = this.done;
    box.setAttribute('aria-label', this.done ? 'Done task' : 'Open task');
    box.addEventListener('mousedown', (event) => event.preventDefault());
    box.addEventListener('click', (event) => {
      event.preventDefault();
      // `[ ]` <-> `[x]`: only the one character between the brackets changes.
      const pos = this.at + 1;
      const current = view.state.sliceDoc(pos, pos + 1);
      if (current !== ' ' && current.toLowerCase() !== 'x') return;
      view.dispatch({
        changes: { from: pos, to: pos + 1, insert: current === ' ' ? 'x' : ' ' },
        userEvent: 'input.toggle-task',
      });
    });
    return box;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

class RuleWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  override toDOM(): HTMLElement {
    const rule = document.createElement('span');
    rule.className = 'cm-lp-rule';
    rule.setAttribute('aria-hidden', 'true');
    return rule;
  }
}

/** Addresses resolved before: images do not flicker when the decorations are made again. */
const resolved = new Map<string, string>();

class ImageWidget extends WidgetType {
  readonly src: string;
  readonly alt: string;
  constructor(src: string, alt: string) {
    super();
    this.src = src;
    this.alt = alt;
  }
  override eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }
  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'cm-lp-image';
    const image = document.createElement('img');
    image.alt = this.alt;
    image.decoding = 'async';
    image.loading = 'lazy';
    image.addEventListener('load', () => view.requestMeasure(), { once: true });
    image.addEventListener('error', () => this.missing(wrap), { once: true });
    wrap.append(image);
    const source = this.src;
    // Remote images are not fetched from the editor: the app makes no requests of its own,
    // and the preview's setting for remote images decides there.
    if (/^data:image\//i.test(source)) {
      image.src = source;
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(source)) {
      this.missing(wrap);
    } else {
      const known = resolved.get(source);
      const resolve = resolvers.get(view);
      if (known) image.src = known;
      else if (!resolve) this.missing(wrap);
      else {
        resolve(source).then(
          (address) => {
            resolved.set(source, address);
            image.src = address;
          },
          () => this.missing(wrap),
        );
      }
    }
    return wrap;
  }
  private missing(wrap: HTMLElement): void {
    wrap.replaceChildren();
    wrap.classList.add('cm-lp-image-missing');
    wrap.textContent = this.alt === '' ? this.src : this.alt;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

const bullet = Decoration.replace({ widget: new BulletWidget() });
const rule = Decoration.replace({ widget: new RuleWidget() });
const quoteLine = Decoration.line({ class: 'cm-lp-quote' });
const codeLine = Decoration.line({ class: 'cm-lp-codeblock' });
const linkText = Decoration.mark({ class: 'cm-lp-link' });
const headingLines = [1, 2, 3, 4, 5, 6].map((level) =>
  Decoration.line({ class: `cm-lp-heading cm-lp-h${level}` }),
);

function childrenOf(node: SyntaxNodeRef, name: string): Array<{ from: number; to: number }> {
  const found: Array<{ from: number; to: number }> = [];
  const cursor = node.node.cursor();
  if (!cursor.firstChild()) return found;
  do {
    if (cursor.name === name) found.push({ from: cursor.from, to: cursor.to });
  } while (cursor.nextSibling());
  return found;
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const active = activeLines(state);
  const isActive = (pos: number) => active.has(doc.lineAt(pos).number);
  const ranges: Range<Decoration>[] = [];
  const tree = syntaxTree(state);

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(name);
        if (heading) {
          const level = Number(heading[1]);
          const line = doc.lineAt(node.from);
          ranges.push((headingLines[level - 1] as Decoration).range(line.from));
          return;
        }
        switch (name) {
          case 'HeaderMark': {
            if (isActive(node.from)) return;
            const parent = node.node.parent?.name ?? '';
            if (parent.startsWith('Setext')) {
              // The underline of a setext heading is a line of its own.
              ranges.push(hide.range(node.from, node.to));
              return;
            }
            // `## ` at the start, or the closing `##` at the end.
            const after = doc.sliceString(node.to, node.to + 1);
            const end =
              after === ' ' && node.from === doc.lineAt(node.from).from ? node.to + 1 : node.to;
            const before = node.from > 0 ? doc.sliceString(node.from - 1, node.from) : '';
            const start =
              before === ' ' && node.from !== doc.lineAt(node.from).from
                ? node.from - 1
                : node.from;
            if (end > start) ranges.push(hide.range(start, end));
            return;
          }
          case 'EmphasisMark':
          case 'StrikethroughMark':
            if (!isActive(node.from) && node.to > node.from)
              ranges.push(hide.range(node.from, node.to));
            return;
          case 'CodeMark': {
            // Only the ticks of inline code: the fences of a code block stay.
            if (node.node.parent?.name !== 'InlineCode' || isActive(node.from)) return;
            ranges.push(hide.range(node.from, node.to));
            return;
          }
          case 'Link': {
            if (isActive(node.from) || isActive(node.to)) return false;
            const marks = childrenOf(node, 'LinkMark');
            const open = marks[0];
            const close = marks[1];
            // `[text](url)` and `[text][ref]`: the text stays, the rest is hidden.
            if (!open || !close || open.from !== node.from) return false;
            if (close.from <= open.to) return false;
            ranges.push(hide.range(open.from, open.to));
            ranges.push(linkText.range(open.to, close.from));
            ranges.push(hide.range(close.from, node.to));
            return false;
          }
          case 'Image': {
            if (isActive(node.from) || isActive(node.to)) return false;
            const marks = childrenOf(node, 'LinkMark');
            const url = childrenOf(node, 'URL')[0];
            const close = marks[1];
            if (!url || !close) return false;
            const alt = doc.sliceString(node.from + 2, close.from);
            let src = doc.sliceString(url.from, url.to);
            if (src.startsWith('<') && src.endsWith('>')) src = src.slice(1, -1);
            ranges.push(
              Decoration.replace({ widget: new ImageWidget(src, alt) }).range(node.from, node.to),
            );
            return false;
          }
          case 'ListMark': {
            if (isActive(node.from)) return;
            const item = node.node.parent;
            const list = item?.parent?.name;
            const task = item ? childrenOf(item, 'Task')[0] : undefined;
            const space = doc.sliceString(node.to, node.to + 1) === ' ' ? 1 : 0;
            if (task) {
              // A task shows its checkbox only.
              ranges.push(hide.range(node.from, node.to + space));
            } else if (list === 'BulletList') {
              ranges.push(bullet.range(node.from, node.to));
            }
            return;
          }
          case 'TaskMarker': {
            if (isActive(node.from)) return;
            const done = doc.sliceString(node.from + 1, node.from + 2) !== ' ';
            ranges.push(
              Decoration.replace({ widget: new CheckboxWidget(done, node.from) }).range(
                node.from,
                node.to,
              ),
            );
            return;
          }
          case 'QuoteMark': {
            const line = doc.lineAt(node.from);
            ranges.push(quoteLine.range(line.from));
            if (isActive(node.from)) return;
            const space = doc.sliceString(node.to, node.to + 1) === ' ' ? 1 : 0;
            ranges.push(hide.range(node.from, node.to + space));
            return;
          }
          case 'HorizontalRule':
            if (!isActive(node.from)) ranges.push(rule.range(node.from, node.to));
            return;
          case 'FencedCode':
          case 'CodeBlock': {
            const first = doc.lineAt(node.from).number;
            const last = doc.lineAt(node.to).number;
            for (let n = first; n <= last; n++) ranges.push(codeLine.range(doc.line(n).from));
            return false;
          }
          default:
            return;
        }
      },
    });
  }
  return RangeSet.of(ranges, true);
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate) {
      const linesMoved =
        update.selectionSet &&
        !sameLines(activeLines(update.startState), activeLines(update.state));
      if (
        update.docChanged ||
        update.viewportChanged ||
        linesMoved ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = build(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

function sameLines(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const line of a) if (!b.has(line)) return false;
  return true;
}

const theme = EditorView.baseTheme({
  '.cm-lp-heading': { fontWeight: '700', lineHeight: '1.3' },
  '.cm-lp-h1': { fontSize: '1.75em', paddingTop: '0.4em' },
  '.cm-lp-h2': { fontSize: '1.45em', paddingTop: '0.3em' },
  '.cm-lp-h3': { fontSize: '1.25em', paddingTop: '0.2em' },
  '.cm-lp-h4': { fontSize: '1.1em' },
  '.cm-lp-bullet': {
    color: 'var(--wd-on-surface-variant)',
    display: 'inline-block',
    minWidth: '0.6em',
  },
  '.cm-lp-task': {
    margin: '0 0.35em 0 0',
    verticalAlign: 'middle',
    width: '1em',
    height: '1em',
    accentColor: 'var(--wd-tertiary)',
    cursor: 'pointer',
  },
  '.cm-lp-rule': {
    display: 'inline-block',
    width: '100%',
    verticalAlign: 'middle',
    borderTop: '1px solid var(--wd-outline-variant)',
  },
  '.cm-lp-quote': {
    // A bar at the left edge that does not move the text.
    backgroundImage: 'linear-gradient(to right, var(--wd-outline-variant) 3px, transparent 3px)',
    color: 'var(--wd-on-surface-variant)',
  },
  '.cm-lp-codeblock': {
    backgroundColor: 'var(--wd-inline-code-bg)',
    fontFamily: 'var(--wd-font-mono, ui-monospace, monospace)',
  },
  '.cm-lp-link': {
    color: 'var(--wd-primary)',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
  },
  '.cm-lp-image': { display: 'inline-block', maxWidth: '100%', verticalAlign: 'bottom' },
  '.cm-lp-image img': {
    display: 'block',
    maxWidth: '100%',
    maxHeight: '320px',
    borderRadius: '6px',
  },
  '.cm-lp-image-missing': {
    padding: '0 6px',
    borderRadius: '4px',
    border: '1px dashed var(--wd-outline-variant)',
    color: 'var(--wd-on-surface-variant)',
  },
});

/** The live preview: hidden syntax, drawn bullets, checkboxes, rules and images. */
export const livePreviewExtension: Extension = [plugin, theme];
