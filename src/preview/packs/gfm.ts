/// <reference path="../vendor.d.ts" />
/**
 * The GFM pack: CommonMark plus the GitHub Flavored Markdown extensions, and what the preview
 * adds on top: tables with alignment, task lists, strikethrough,
 * autolink literals, GitHub alerts, footnotes, math, emoji shortcodes, YAML frontmatter.
 *
 * Maintained plugins where they fit markdown-it 15 (footnotes; the emoji table); small rules of our own
 * for the rest, because they have to produce the HTML structure the preview, the tests and the
 * shell rely on.
 */
import MarkdownItConstructor, { type MarkdownIt } from 'markdown-it';
import footnote from 'markdown-it-footnote';
import { BlockPipeline, type EnginePipeline, type PipelineOptions } from '../engine';
import { installAutolink } from '../rules/autolink';
import { calloutsRule, renderCalloutTitle } from '../rules/callouts';
import { installCodeRules, installGraphvizFence, installMermaidFence } from '../rules/code';
import { installEmoji } from '../rules/emoji';
import { installFrontmatter } from '../rules/frontmatter';
import { installHashtagPills } from '../rules/hashtags';
import { headingsRule } from '../rules/headings';
import { installMath } from '../rules/math';
import { installStrikethrough } from '../rules/strikethrough';
import { installTables } from '../rules/tables';
import { renderTaskCheckbox, tasksRule } from '../rules/tasks';

export function createGfmMarkdownIt(): MarkdownIt {
  // The default preset has tables and strikethrough. Raw HTML is on (the sanitizer deals with
  // it). Linkify is off: `autolink.ts` implements the autolinks of the GFM spec exactly.
  const md = new MarkdownItConstructor({ html: true, linkify: false, typographer: false });

  installFrontmatter(md);
  installStrikethrough(md);
  installAutolink(md);
  installTables(md);
  installMath(md);
  installHashtagPills(md);
  installCodeRules(md);
  installMermaidFence(md);
  installGraphvizFence(md);

  md.use(footnote);
  // `:tada:` style shortcodes only (the table of markdown-it-emoji, our own faster scanning).
  installEmoji(md);

  md.core.ruler.after('block', 'wd_callouts', calloutsRule);
  md.renderer.rules.callout_title = renderCalloutTitle;
  md.core.ruler.push('wd_tasks', tasksRule);
  md.renderer.rules.task_checkbox = renderTaskCheckbox;
  // Last: the ids need the final text of every heading.
  md.core.ruler.push('wd_headings', headingsRule);
  return md;
}

export function createGfmPipeline(options?: PipelineOptions): EnginePipeline {
  return new BlockPipeline('gfm', createGfmMarkdownIt(), options);
}
