/**
 * Picks the part of a note that an embed shows (`![[Note#Heading]]`, `![[Note#^block]]`) from the
 * note's text, before it is rendered. Pure text work; headings and block ids inside fenced code
 * are not looked at.
 */
import { slugify } from '../../slug';

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const LIST_ITEM = /^(\s*)(?:[-*+]|\d{1,9}[.)])[ \t]+/;

/** The text without its YAML frontmatter (an embed shows the note, not its properties). */
export function stripFrontmatter(text: string): string {
  if (!/^---[ \t]*\r?\n/.test(text)) return text;
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[i] as string)) return lines.slice(i + 1).join('\n');
  }
  return text;
}

const normalize = (text: string): string =>
  text
    .replace(/[*_`~=]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** Lines that are not inside fenced code, as a mask. */
function codeMask(lines: readonly string[]): boolean[] {
  const mask: boolean[] = [];
  let fence = '';
  for (const line of lines) {
    const marks = FENCE.exec(line)?.[1];
    if (marks && fence === '') {
      fence = marks;
      mask.push(true);
    } else if (marks?.startsWith(fence.charAt(0)) && marks.length >= fence.length) {
      fence = '';
      mask.push(true);
    } else {
      mask.push(fence !== '');
    }
  }
  return mask;
}

/** The section of a heading: the heading line and everything up to the next heading of the same or a higher level. */
export function extractHeading(text: string, heading: string): string | null {
  const lines = text.split(/\r?\n/);
  const code = codeMask(lines);
  const wanted = normalize(heading);
  const wantedSlug = slugify(heading);
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    if (code[i]) continue;
    const match = HEADING.exec(lines[i] as string);
    if (!match) continue;
    const here = (match[1] as string).length;
    if (start < 0) {
      const title = match[2] as string;
      if (normalize(title) === wanted || slugify(title) === wantedSlug) {
        start = i;
        level = here;
      }
    } else if (here <= level) {
      return lines.slice(start, i).join('\n');
    }
  }
  return start < 0 ? null : lines.slice(start).join('\n');
}

/** The block that ends with `^id`, without the marker. */
export function extractBlock(text: string, id: string): string | null {
  const lines = text.split(/\r?\n/);
  const code = codeMask(lines);
  const marker = new RegExp(`(?:^|[ \\t])\\^${id.replace(/[^A-Za-z0-9-]/g, '\\$&')}[ \\t]*$`);
  const at = lines.findIndex((line, i) => !code[i] && marker.test(line));
  if (at < 0) return null;
  const blank = (index: number) => (lines[index] ?? '').trim() === '';
  const stripped = (line: string) => line.replace(marker, '').replace(/[ \t]+$/, '');

  if (stripped(lines[at] as string).trim() === '') {
    // The id is alone on its line: it belongs to the block before it.
    let end = at - 1;
    while (end >= 0 && blank(end)) end--;
    if (end < 0) return null;
    let start = end;
    while (start > 0 && !blank(start - 1)) start--;
    return lines.slice(start, end + 1).join('\n');
  }
  const item = LIST_ITEM.exec(lines[at] as string);
  if (item) return stripped(lines[at] as string);
  let start = at;
  while (start > 0 && !blank(start - 1)) start--;
  const block = lines.slice(start, at + 1);
  block[block.length - 1] = stripped(lines[at] as string);
  return block.join('\n');
}
