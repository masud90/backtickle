/**
 * Where a window of a large Pandoc document must not be cut (`PipelineOptions.unsafeSplit`):
 * inside a fenced div, in front of a definition list term or definition (the list goes on across
 * blank lines), in front of a list item with a fancy or example marker, and inside a CriticMarkup
 * span. The answer for every line is worked out once per source (the lines array) and remembered.
 */
import { parseOpener } from './divs';

const CLOSER = /^:{3,}[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const MARKER = /^[:~](?:[ \t]+\S)/;
const FANCY =
  /^(?:\((?:@[\w-]*|#|[A-Za-z]{1,6}|\d{1,9})\)|(?:#|[A-Za-z]{1,6}|\d{1,9})[.)])(?:[ \t]|$)/;
const CRITIC_OPEN = /\{(\+\+|--|~~|==|>>)/g;
const CRITIC_CLOSE: Record<string, string> = {
  '++': '++}',
  '--': '--}',
  '~~': '~~}',
  '==': '==}',
  '>>': '<<}',
};

const cache = new WeakMap<readonly string[], Uint8Array>();

function isBlank(line: string | undefined): boolean {
  return line === undefined || line.trim() === '';
}

function scan(lines: readonly string[]): Uint8Array {
  const unsafe = new Uint8Array(lines.length);
  let depth = 0;
  let fence = '';
  let critic = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (depth > 0 || critic !== '') unsafe[i] = 1;

    const marks = FENCE.exec(line)?.[1];
    if (marks) {
      if (fence === '') fence = marks;
      else if (marks.startsWith(fence.charAt(0)) && marks.length >= fence.length) fence = '';
      continue;
    }
    if (fence !== '') continue;

    const first = line.charCodeAt(0);
    if (first === 0x3a || first === 0x7e) {
      if (MARKER.test(line)) unsafe[i] = 1;
      if (first === 0x3a && line.startsWith(':::')) {
        if (CLOSER.test(line)) {
          if (depth > 0) depth--;
        } else if (parseOpener(line)) {
          depth++;
        }
      }
    } else if (first !== undefined && !Number.isNaN(first) && first !== 0x20 && first !== 0x09) {
      if (FANCY.test(line)) unsafe[i] = 1;
      // A term line: the next line, or the one after a blank line, is a definition.
      let next = lines[i + 1];
      if (isBlank(next)) next = lines[i + 2];
      if (next !== undefined && MARKER.test(next) && !isBlank(line)) unsafe[i] = 1;
    }

    if (line.includes('{')) {
      let from = 0;
      if (critic !== '') {
        const at = line.indexOf(critic);
        if (at < 0) continue;
        critic = '';
        from = at + 3;
      }
      CRITIC_OPEN.lastIndex = from;
      for (let match = CRITIC_OPEN.exec(line); match; match = CRITIC_OPEN.exec(line)) {
        const closer = CRITIC_CLOSE[match[1] as string] as string;
        const at = line.indexOf(closer, match.index + 3);
        if (at < 0) {
          critic = closer;
          break;
        }
        CRITIC_OPEN.lastIndex = at + closer.length;
      }
    } else if (critic !== '' && line.includes(critic)) {
      critic = '';
    }
  }
  return unsafe;
}

export function pandocUnsafeSplit(lines: readonly string[], index: number): boolean {
  let unsafe = cache.get(lines);
  if (!unsafe) {
    unsafe = scan(lines);
    cache.set(lines, unsafe);
  }
  return unsafe[index] === 1;
}
