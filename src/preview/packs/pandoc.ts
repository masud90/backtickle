/// <reference path="../vendor.d.ts" />
/**
 * The Pandoc / MultiMarkdown pack: CommonMark plus
 * Pandoc's default extensions that the spec lists: title block (YAML, `%` lines, MMD header),
 * definition lists, subscript, superscript and strikeout, abbreviations, line blocks, fancy and
 * example lists, inline footnotes, smart punctuation, attributes on headings, images, links,
 * code, spans and fenced divs, raw blocks, CriticMarkup, math, and heading ids made by Pandoc's
 * algorithm.
 *
 * Not here (they are installed by separate modules): tables
 * and citations. The rules are our own: they have to produce the HTML structure of the contract,
 * namespace the classes of a document, and keep the counts of prose right.
 */
import MarkdownItConstructor, { type MarkdownIt } from 'markdown-it';
import footnote from 'markdown-it-footnote';
import type { CompletionData } from '@/editor/complete';
import {
  type BibliographySource,
  guessFormat,
  inlineSource,
  isBibtexLoaded,
  loadBibtex,
  mergeBibliographies,
  parseBibliography,
} from '../bibliography';
import { BlockPipeline, type EnginePipeline, type PipelineOptions } from '../engine';
import { hashString } from '../hash';
import { installCodeRules, installGraphvizFence } from '../rules/code';
import { installHashtagPills } from '../rules/hashtags';
import { installMath } from '../rules/math';
import { installAbbreviations } from '../rules/pandoc/abbr';
import {
  citationCompletions,
  installCitations,
  isCitationPlan,
  prepareCitations,
} from '../rules/pandoc/citations';
import { installPandocCode } from '../rules/pandoc/code';
import { needsPandoc, preparePandoc } from '../rules/pandoc/context';
import { installCritic } from '../rules/pandoc/critic';
import { installDefinitionLists } from '../rules/pandoc/deflist';
import { installDivs } from '../rules/pandoc/divs';
import { installExamples } from '../rules/pandoc/examples';
import { headingAttributesRule, pandocHeadingsRule } from '../rules/pandoc/headings';
import { createPandocSlugger } from '../rules/pandoc/identifiers';
import { installInlineAttributes } from '../rules/pandoc/inline-attrs';
import { installLineBlocks } from '../rules/pandoc/line-block';
import { installPandocLists } from '../rules/pandoc/lists';
import { installMarks } from '../rules/pandoc/marks';
import { referencesRule } from '../rules/pandoc/references';
import { installSmart } from '../rules/pandoc/smart';
import { installPandocTables, unsafeSplit as tablesUnsafeSplit } from '../rules/pandoc/tables';
import { installTitleBlock } from '../rules/pandoc/title-block';
import { pandocUnsafeSplit } from '../rules/pandoc/windows';
import { installTables } from '../rules/tables';
import { renderTaskCheckbox, tasksRule } from '../rules/tasks';
import type { ContextInputs, ContextNeeds, DocContext } from '../types';

export function createPandocMarkdownIt(): MarkdownIt {
  // CommonMark rules (not the GFM preset): tables, strikethrough and the rest are Pandoc's own.
  const md = new MarkdownItConstructor('commonmark', {
    html: true,
    linkify: false,
    typographer: false,
  });

  installTitleBlock(md);
  installCodeRules(md);
  installPandocCode(md);
  installGraphvizFence(md);
  installMath(md);
  installHashtagPills(md);
  installPandocLists(md);
  installDefinitionLists(md);
  installLineBlocks(md);
  installDivs(md);
  installAbbreviations(md);
  // Pandoc's own table rules first, then the Phase 1 alignment classes for every pipe table.
  md.enable('table');
  installPandocTables(md);
  installTables(md);

  installMarks(md);
  installCritic(md);
  installSmart(md);
  installExamples(md);
  // Before the footnotes, so that their text is read as well (the plugin's tail rule runs first).
  installInlineAttributes(md);
  md.use(footnote);
  installCitations(md);

  md.core.ruler.after('block', 'wd_pandoc_heading_attrs', headingAttributesRule);
  // Task lists: on by default in Pandoc (`task_lists`), with the Phase 1 task box.
  md.core.ruler.push('wd_tasks', tasksRule);
  md.renderer.rules.task_checkbox = renderTaskCheckbox;
  // After the inline rules, before the ids: the reference list and its title heading.
  md.core.ruler.push('wd_references', referencesRule);
  // Last: the ids need the final text of every heading.
  md.core.ruler.push('wd_pandoc_headings', pandocHeadingsRule);
  return md;
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** Parsed bibliography files by path, so that typing does not parse them again. */
const parsedFiles = new Map<
  string,
  { text: string; format: string; items: BibliographySource['items'] }
>();

/** The merged bibliography of the document, and whether a BibTeX file waits for its parser. */
export function readBibliography(metadata: Record<string, unknown>, inputs: ContextInputs) {
  const sources: BibliographySource[] = [];
  let pending = false;
  for (const file of inputs.bibliographies) {
    const format = guessFormat(file.path);
    if (!format) continue;
    if (format === 'bibtex' && !isBibtexLoaded()) {
      pending = true;
      continue;
    }
    let known = parsedFiles.get(file.path);
    if (!known || known.text !== file.text || known.format !== format) {
      known = { text: file.text, format, items: parseBibliography(file.text, format).items };
      parsedFiles.set(file.path, known);
      if (parsedFiles.size > 20) parsedFiles.delete(parsedFiles.keys().next().value as string);
    }
    sources.push({ name: fileName(file.path), items: known.items });
  }
  sources.push(inlineSource(metadata));
  return { bibliography: mergeBibliographies(sources), pending };
}

function prepare(source: string, inputs: ContextInputs): DocContext {
  const base = preparePandoc(source, inputs);
  const { bibliography, pending } = readBibliography(base.metadata, inputs);
  const plan = prepareCitations({ source, bibliography, metadata: base.metadata });
  if (pending) plan.pending = true;
  const title = base.metadata['reference-section-title'];
  return {
    ...base,
    citationKeys: plan.keys,
    bibliography: plan,
    signature: hashString(
      `${base.signature}|${plan.signature}|${pending ? 'p' : ''}|${typeof title === 'string' ? title : ''}`,
    ),
  };
}

/** Starts the BibTeX parser (a chunk of its own) when a document's bibliography has a .bib file. */
export function preload(inputs: ContextInputs): Promise<void> | undefined {
  if (isBibtexLoaded()) return undefined;
  if (!inputs.bibliographies.some((file) => guessFormat(file.path) === 'bibtex')) return undefined;
  return loadBibtex();
}

function completions(context: DocContext): CompletionData {
  const plan = context.bibliography;
  return {
    citations: isCitationPlan(plan) ? citationCompletions(plan) : [],
  };
}

const needs = (source: string): ContextNeeds => needsPandoc(source);

export function createPandocPipeline(options?: PipelineOptions): EnginePipeline {
  return new BlockPipeline('pandoc', createPandocMarkdownIt(), {
    needs,
    prepare,
    preload,
    completions,
    unsafeSplit: (lines, index) =>
      pandocUnsafeSplit(lines, index) || tablesUnsafeSplit(lines, index),
    slugger: createPandocSlugger,
    ...options,
  });
}
