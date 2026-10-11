/**
 * The CodeMirror paste handler of smart paste. It decides from the clipboard and the
 * syntax at the caret; everything but the plain paste is an extra transaction on top of it, so
 * the first Undo gives back exactly what an ordinary paste would have inserted.
 */
import { isolateHistory } from '@codemirror/commands';
import { type EditorState, type Extension, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { flavorFacet } from '../markdown';
import { insideCode, treeUpTo } from '../syntax';
import { decidePaste, type PasteDecision } from './decide';
import { rowsFromHtml, tableFromRows } from './table';

const LINK_NODES = new Set(['Link', 'Image', 'Autolink', 'URL']);

function hasAncestor(state: EditorState, pos: number, side: 1 | -1, names: Set<string>): boolean {
  const tree = treeUpTo(state, pos + 1);
  for (let node: SyntaxNode | null = tree.resolveInner(pos, side); node; node = node.parent) {
    if (names.has(node.name)) return true;
  }
  return false;
}

/** Whether `pos` sits in YAML frontmatter (`---` ... `---` at the top of the document). */
export function insideFrontmatter(state: EditorState, pos: number): boolean {
  const doc = state.doc;
  if (doc.lines < 2 || doc.line(1).text.trimEnd() !== '---' || pos <= 0) return false;
  for (let n = 2; n <= doc.lines; n++) {
    const text = doc.line(n).text.trimEnd();
    if (text === '---' || text === '...') return pos <= doc.line(n).to;
  }
  return false;
}

/** Whether a paste at `pos` must stay plain: code blocks, chunks, inline code, frontmatter. */
export function plainContext(state: EditorState, pos: number): boolean {
  return (
    insideCode(state, pos) ||
    hasAncestor(state, pos, 1, new Set(['InlineCode'])) ||
    insideFrontmatter(state, pos)
  );
}

/** The Markdown to put in place of the plain paste, or null to leave the plain paste alone. */
async function replacement(
  decision: PasteDecision,
  selectedText: string,
  html: string,
  uri: string,
  state: EditorState,
): Promise<string | null> {
  const flavor = state.facet(flavorFacet);
  switch (decision.kind) {
    case 'link':
      return `[${selectedText}](${decision.url})`;
    case 'table-tsv':
      return tableFromRows(decision.rows, flavor);
    case 'table-html': {
      const rows = rowsFromHtml(html);
      return rows ? tableFromRows(rows, flavor) : null;
    }
    case 'html': {
      const { htmlToMarkdown } = await import('../paste/convert');
      const markdown = htmlToMarkdown(html, { flavor, baseUrl: uri || undefined });
      return markdown.trim() === '' ? null : markdown;
    }
    default:
      return null;
  }
}

function onPaste(event: ClipboardEvent, view: EditorView): boolean {
  const data = event.clipboardData;
  const state = view.state;
  if (!data || state.readOnly || state.selection.ranges.length !== 1) return false;
  const text = data.getData('text/plain');
  const html = data.getData('text/html');
  if (text === '' && html === '') return false;
  const { from, to } = state.selection.main;
  const decision = decidePaste({
    text,
    html,
    flavor: state.facet(flavorFacet),
    selectedText: state.sliceDoc(from, to),
    selectionIsLink:
      from !== to &&
      (hasAncestor(state, from, 1, LINK_NODES) || hasAncestor(state, to, -1, LINK_NODES)),
    inCode: plainContext(state, from) || (to !== from && plainContext(state, to)),
  });
  if (decision.kind === 'plain') return false;

  event.preventDefault();
  const selectedText = state.sliceDoc(from, to);
  // The plain paste first; the smart one replaces it as its own undo step.
  const plainText = text !== '' ? text : html;
  const plain = state.update(state.replaceSelection(plainText), {
    userEvent: 'input.paste',
    scrollIntoView: true,
  });
  view.dispatch(plain);
  const pastedTo = plain.newSelection.main.head;
  const doc = view.state.doc;
  void replacement(
    decision,
    selectedText,
    html,
    (data.getData('text/uri-list').split('\n')[0] ?? '').trim(),
    state,
  )
    .then((markdown) => {
      // Skip when nothing to add, or the document changed while the converter loaded.
      if (markdown === null || view.state.doc !== doc) return;
      view.dispatch({
        changes: { from, to: pastedTo, insert: markdown },
        selection: { anchor: from + view.state.toText(markdown).length },
        userEvent: 'input.paste',
        scrollIntoView: true,
        annotations: [isolateHistory.of('full'), Transaction.addToHistory.of(true)],
      });
    })
    .catch(() => {
      // A converter failure leaves the plain paste in place.
    });
  return true;
}

/** The paste handler extension (installed by the controller). */
export const smartPaste: Extension = EditorView.domEventHandlers({ paste: onPaste });
