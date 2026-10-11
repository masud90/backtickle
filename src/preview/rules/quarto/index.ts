/** The Quarto rules, installed on top of the Pandoc pack's markdown-it. */
import type { MarkdownIt } from 'markdown-it';
import { createReferencesRule } from '../pandoc/references';
import { installChunks } from './chunks';
import { installQuartoDivs } from './divs';
import { installShortcodes } from './shortcodes';
import { installQuartoTitleDate } from './title-date';
import { installXref } from './xref';

export function installQuarto(md: MarkdownIt): void {
  installChunks(md);
  installXref(md);
  installQuartoDivs(md);
  installShortcodes(md);
  installQuartoTitleDate(md);
  // Quarto puts the `reference-section-title` heading at level 2.
  md.core.ruler.at('wd_references', createReferencesRule(2));
}
