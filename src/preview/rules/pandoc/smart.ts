/**
 * Pandoc's `smart` extension: curly quotes (markdown-it's own rule), `--` as an en dash, `---` as
 * an em dash and `...` as an ellipsis. Not markdown-it's typographer replacements `(c)`, `+-`
 * and the others, which Pandoc does not do.
 */
import type { MarkdownIt, StateCore } from 'markdown-it';
import { previewOptions } from '../../options';

function dashesRule(state: StateCore): void {
  // The setting also switches markdown-it's own quote rule, which
  // runs right after this one and reads the option.
  const smart = previewOptions().smartPunctuation;
  state.md.options.typographer = smart;
  if (!smart) return;
  for (const block of state.tokens) {
    if (block.type !== 'inline' || !block.children) continue;
    let inAutolink = false;
    for (const token of block.children) {
      if (token.type === 'link_open' && token.info === 'auto') inAutolink = true;
      else if (token.type === 'link_close') inAutolink = false;
      else if (token.type === 'text' && !inAutolink && /-{2}|\.{3}/.test(token.content)) {
        token.content = token.content
          .replace(/---/g, '—')
          .replace(/--/g, '–')
          .replace(/\.{3}/g, '…');
      }
    }
  }
}

export function installSmart(md: MarkdownIt): void {
  md.set({ typographer: true });
  md.enable('smartquotes');
  md.core.ruler.before('smartquotes', 'wd_pandoc_dashes', dashesRule);
}
