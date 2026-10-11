/** Questions about the Markdown syntax tree that more than one editor module asks. */
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';

/** The syntax tree, parsed far enough to answer questions about `pos` (it can still be partial). */
export function treeUpTo(state: EditorState, pos: number) {
  return ensureSyntaxTree(state, Math.min(state.doc.length, pos), 30) ?? syntaxTree(state);
}

const CODE_NODES = new Set([
  'FencedCode',
  'CodeBlock',
  'CommentBlock',
  'HTMLBlock',
  'ProcessingInstructionBlock',
]);

/** Whether `pos` is inside a code block or an HTML block, where Markdown syntax does not apply. */
export function insideCode(state: EditorState, pos: number): boolean {
  const tree = treeUpTo(state, pos + 1);
  for (let node: SyntaxNode | null = tree.resolveInner(pos, 1); node; node = node.parent) {
    if (CODE_NODES.has(node.name)) return true;
  }
  return false;
}
