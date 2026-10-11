/**
 * The Quarto / R Markdown pack: everything the Pandoc
 * pack renders, plus code chunks with option pills, figure chunks, inline chunks, cross-references
 * with numbering, callouts, tabsets, columns, shortcodes (with includes), and Mermaid chunks.
 * Code is never run. The Pandoc rules are reused, not copied: this pack builds on
 * `createPandocMarkdownIt`.
 */
import type { MarkdownIt } from 'markdown-it';
import type { CompletionData } from '@/editor/complete';
import { BlockPipeline, type EnginePipeline, type PipelineOptions } from '../engine';
import { hashString } from '../hash';
import { installGraphvizFence, installMermaidFence } from '../rules/code';
import { citationCompletions, isCitationPlan, prepareCitations } from '../rules/pandoc/citations';
import { needsPandoc, preparePandoc } from '../rules/pandoc/context';
import { createPandocSlugger } from '../rules/pandoc/identifiers';
import { unsafeSplit as tablesUnsafeSplit } from '../rules/pandoc/tables';
import { pandocUnsafeSplit } from '../rules/pandoc/windows';
import { installQuarto } from '../rules/quarto';
import {
  bibliographyHrefs,
  labelCompletions,
  needsQuarto,
  prepareQuarto,
  withoutCrossReferences,
} from '../rules/quarto/context';
import { optionsOf } from '../rules/quarto/labels';
import type { ContextInputs, ContextNeeds, DocContext } from '../types';
import '../rules/quarto/quarto.css';
import { createPandocMarkdownIt, preload, readBibliography } from './pandoc';

export function createQuartoMarkdownIt(): MarkdownIt {
  const md = createPandocMarkdownIt();
  installQuarto(md);
  // After the chunk rules: `{mermaid}` chunks and ```mermaid fences are diagrams.
  installMermaidFence(md, { braced: true });
  installGraphvizFence(md, { braced: true });
  return md;
}

function prepare(source: string, inputs: ContextInputs): DocContext {
  const base = preparePandoc(source, inputs);
  const parts = prepareQuarto(source, inputs, base);
  // Only the bibliographies this document (or its project) names: the shell may hold others.
  const wanted = new Set(bibliographyHrefs(parts.metadata));
  const { bibliography, pending } = readBibliography(parts.metadata, {
    ...inputs,
    bibliographies: inputs.bibliographies.filter((file) => wanted.has(file.href)),
  });
  const plan = prepareCitations({
    source: withoutCrossReferences(source),
    bibliography,
    metadata: parts.metadata,
  });
  if (pending) plan.pending = true;
  const title = parts.metadata['reference-section-title'];
  return {
    metadata: parts.metadata,
    labels: parts.labels,
    citationKeys: plan.keys,
    bibliography: plan,
    vault: null,
    includes: parts.includes,
    signature: hashString(
      `${parts.signature}|${plan.signature}|${pending ? 'p' : ''}|${typeof title === 'string' ? title : ''}`,
    ),
  };
}

function completions(context: DocContext): CompletionData {
  const plan = context.bibliography;
  return {
    citations: isCitationPlan(plan) ? citationCompletions(plan) : [],
    labels: labelCompletions(context.labels, optionsOf(context)),
  };
}

const needs = (source: string): ContextNeeds => needsQuarto(source, needsPandoc(source));

export function createQuartoPipeline(options?: PipelineOptions): EnginePipeline {
  return new BlockPipeline('quarto', createQuartoMarkdownIt(), {
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
