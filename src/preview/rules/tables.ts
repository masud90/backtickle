/**
 * Table column alignment as a class (`align-left`, `align-center`, `align-right`) instead of the
 * inline `style` attribute markdown-it writes. The content security policy forbids inline style
 * attributes (`style-src-attr 'none'`), and the sanitizer removes them anyway.
 */
import type { MarkdownIt, StateCore } from 'markdown-it';

/** The inline style markdown-it puts on aligned table cells, for example `text-align:center`. */
const CELL_ALIGNMENT = /^text-align:(left|center|right)$/;

function tableAlignmentRule(state: StateCore): void {
  for (const token of state.tokens) {
    if (token.type !== 'th_open' && token.type !== 'td_open') continue;
    const alignment = CELL_ALIGNMENT.exec(String(token.attrGet('style') ?? ''))?.[1];
    if (!alignment) continue;
    token.attrs = (token.attrs ?? []).filter(([name]) => name !== 'style');
    token.attrJoin('class', `align-${alignment}`);
  }
}

export function installTables(md: MarkdownIt): void {
  md.core.ruler.push('wd_table_alignment', tableAlignmentRule);
}
