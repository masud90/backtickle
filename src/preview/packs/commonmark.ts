/**
 * The CommonMark pack: the plain spec and nothing else. No frontmatter, tables, task lists,
 * strikethrough, autolink literals, footnotes, alerts, math or emoji. (Code blocks are drawn as
 * code cards, and headings get ids, in every flavor.)
 */
import MarkdownItConstructor, { type MarkdownIt } from 'markdown-it';
import { BlockPipeline, type EnginePipeline, type PipelineOptions } from '../engine';
import { installCodeRules } from '../rules/code';
import { headingsRule } from '../rules/headings';

export function createCommonMarkMarkdownIt(): MarkdownIt {
  // The 'commonmark' preset enables exactly the rules of the spec and closes tags with " />".
  const md = new MarkdownItConstructor('commonmark', {
    html: true,
    linkify: false,
    typographer: false,
  });
  installCodeRules(md);
  md.core.ruler.push('wd_headings', headingsRule);
  return md;
}

export function createCommonMarkPipeline(options?: PipelineOptions): EnginePipeline {
  return new BlockPipeline('commonmark', createCommonMarkMarkdownIt(), options);
}
