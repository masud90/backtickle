/**
 * Headings in the Pandoc packs: the attributes after the text (`# Title {#id .class}`), and ids
 * made by Pandoc's own algorithm (see `identifiers.ts`). A heading with `.unlisted` (or
 * `.unnumbered` is only a class) stays out of the outline; `.hidden` and the rest are classes of
 * the document, namespaced.
 */
import type { StateCore } from 'markdown-it';
import type { Heading } from '../../types';
import { wdEnv } from '../env';
import { headingText } from '../headings';
import { type Attributes, applyAttributes, hasClass, parseAttributes } from './attributes';
import { PandocSlugger, pandocIdentifier } from './identifiers';

const TRAILING = /[ \t]*\{((?:[^{}"\\\n]|"(?:[^"\\\n]|\\.)*"|\\.)*)\}[ \t]*$/u;

/** Between the block and the inline rules: cuts `{...}` off the end of the text of a heading. */
export function headingAttributesRule(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const open = tokens[i];
    if (open?.type !== 'heading_open') continue;
    const inline = tokens[i + 1];
    if (inline?.type !== 'inline') continue;
    const match = TRAILING.exec(inline.content);
    if (!match || match.index === 0 || match[1] === undefined) continue;
    const attrs = parseAttributes(match[1]);
    if (attrs?.raw !== '') continue;
    inline.content = inline.content.slice(0, match.index);
    open.meta = { ...open.meta, attrs };
    applyAttributes(open, attrs);
  }
}

/** The last core rule: ids and the list of headings. */
export function pandocHeadingsRule(state: StateCore): void {
  const wd = wdEnv(state.env);
  const slugger = wd.slugger instanceof PandocSlugger ? wd.slugger : null;
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const open = tokens[i];
    if (open?.type !== 'heading_open') continue;
    const inline = tokens[i + 1];
    const text = inline?.type === 'inline' ? headingText(inline.children) : '';
    const attrs = (open.meta as { attrs?: Attributes } | null)?.attrs;
    const level = Number(open.tag.slice(1)) as Heading['level'];
    const unlisted = hasClass(attrs, 'unlisted');
    let id = attrs?.id ?? '';
    if (id !== '') {
      if (!unlisted) slugger?.reserve(id);
    } else if (unlisted) {
      id = pandocIdentifier(text);
    } else {
      id = slugger ? slugger.slug(text) : pandocIdentifier(text);
    }
    open.attrSet('id', id);
    if (unlisted) continue;
    wd.headings.push({ level, text, id, line: (open.map ? open.map[0] : 0) + wd.lineOffset });
    if (level === 1) wd.hasH1 = true;
  }
}
