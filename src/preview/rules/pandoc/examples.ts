/**
 * Example lists (`(@)` and `(@label)`): their numbers run through the whole document, so they are
 * counted in `prepare` (a scan of the source) and stored in the context as labels:
 *   `exline:<line>`  the number of the item that starts on that 0-based source line;
 *   `ex:<label>`     the number of the item with that label.
 * `render` reads them, so a window of a large document, or a block that is cached, shows the
 * right numbers. References `(@label)` in the text become the number in parentheses.
 */
import type { MarkdownIt, StateBlock, StateCore } from 'markdown-it';
import type { Label } from '../../types';
import { wdEnv } from '../env';

const ITEM = /^[ \t>]*\(@([\w-]*)\)(?:[ \t]|$)/;
const REFERENCE = /\(@([\w-]+)\)/g;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Numbers every example item of the source, in document order, outside code fences. */
export function collectExamples(lines: readonly string[]): Map<string, Label> {
  const labels = new Map<string, Label>();
  let count = 0;
  let fence = '';
  for (let line = 0; line < lines.length; line++) {
    const text = lines[line] as string;
    const first = text.charCodeAt(0);
    // Fences first; example items start with `(` after at most a quote mark and some spaces.
    const marks = FENCE.exec(text)?.[1];
    if (marks) {
      if (fence === '') fence = marks;
      else if (marks.startsWith(fence.charAt(0)) && marks.length >= fence.length) fence = '';
      continue;
    }
    if (fence !== '' || !(first === 0x28 || first === 0x20 || first === 0x3e || first === 0x09)) {
      continue;
    }
    const match = ITEM.exec(text);
    if (!match) continue;
    count++;
    const number = String(count);
    labels.set(`exline:${line}`, { kind: 'example', number, text: `(${number})`, line });
    const name = match[1] ?? '';
    const key = `ex:${name}`;
    if (name !== '' && !labels.has(key)) {
      labels.set(key, { kind: 'example', number, text: `(${number})`, line });
    }
  }
  return labels;
}

/** The number of the example item that starts on this line of the window being parsed. */
export function exampleNumber(state: StateBlock, line: number): number {
  const wd = wdEnv(state.env);
  const label = wd.context?.labels.get(`exline:${line + wd.lineOffset}`);
  const number = label ? Number(label.number) : 1;
  return Number.isFinite(number) ? number : 1;
}

/** After the text is joined: `(@label)` becomes `(N)` when the document has that example. */
function referencesRule(state: StateCore): void {
  const labels = wdEnv(state.env).context?.labels;
  if (!labels) return;
  for (const block of state.tokens) {
    if (block.type !== 'inline' || !block.children) continue;
    for (const token of block.children) {
      if (token.type !== 'text' || !token.content.includes('(@')) continue;
      token.content = token.content.replace(REFERENCE, (all: string, name: string) => {
        return labels.get(`ex:${name}`)?.text ?? all;
      });
    }
  }
}

export function installExamples(md: MarkdownIt): void {
  md.core.ruler.after('text_join', 'wd_pandoc_example_refs', referencesRule);
}
