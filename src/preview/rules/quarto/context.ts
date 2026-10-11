/**
 * What the Quarto pack needs to know about the whole document before it renders any block: the cross-reference labels and their numbers, the included
 * files, and `bibliography`, `crossref`, `number-sections` and `csl` from the project's
 * `_quarto.yml` when the document does not set them.
 *
 * `needs` can only see the source, but the files it asks for depend on what already arrived (the
 * bibliography the project names, the files that an included file includes). `prepare` remembers
 * those in this module, so the next `needs` asks for them: each arrival renders again, and the
 * chain ends when nothing new is named. What `prepare` uses is always filtered by the document's
 * own hrefs, so a remembered name from another document can never add a file to this one.
 */
import { load } from 'js-yaml';
import { hashString } from '../../hash';
import type { ContextInputs, ContextNeeds, DocContext, Label } from '../../types';
import { crossrefOptions, type LineOrigin, scanLabels } from './labels';
import { includeHrefs, MAX_INCLUDE_DEPTH, resolveIncludeKey } from './state';

const INCLUDE_LINE = /^\{\{<\s*include\s+([^>]*?)\s*>\}\}$/;
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * The lines of the document with the text of every `{{< include >}}` paragraph put in its place
 * (nesting and cycles as the renderer treats them), so that figures, tables, equations and
 * listings are numbered in reading order. `origin` says, for each line, the line of the document
 * it stands for (an included line counts as the line of the shortcode).
 */
export function expandIncludes(
  lines: readonly string[],
  textOf: (key: string) => string | undefined,
): { lines: string[]; origin: LineOrigin[] } {
  const out: string[] = [];
  const origin: LineOrigin[] = [];
  const walk = (
    source: readonly string[],
    parent: string,
    depth: number,
    stack: string[],
    at: number | null,
  ) => {
    let fence = '';
    for (let i = 0; i < source.length; i++) {
      const line = source[i] as string;
      const here = at ?? i;
      const marks = FENCE_LINE.exec(line)?.[1];
      if (marks) {
        if (fence === '') fence = marks;
        else if (marks.startsWith(fence.charAt(0)) && marks.length >= fence.length) fence = '';
      }
      const match = fence === '' && !marks ? INCLUDE_LINE.exec(line.trim()) : null;
      const alone =
        (i === 0 || (source[i - 1] as string).trim() === '') &&
        (i === source.length - 1 || (source[i + 1] as string).trim() === '');
      if (match && alone && depth < MAX_INCLUDE_DEPTH) {
        const href = (match[1] ?? '').trim().replace(/^(["'])(.*)\1$/, '$2');
        const key = resolveIncludeKey(parent, href);
        const text = href === '' ? undefined : textOf(key);
        if (text !== undefined && !stack.includes(key)) {
          out.push('');
          origin.push({ line: here, included: at !== null });
          walk(text.split(/\r\n?|\n/), key, depth + 1, [...stack, key], here);
          out.push('');
          origin.push({ line: here, included: at !== null });
          continue;
        }
      }
      out.push(line);
      origin.push({ line: here, included: at !== null });
    }
  };
  walk(lines, '', 0, [], null);
  return { lines: out, origin };
}

const PROJECT_KEYS = ['bibliography', 'crossref', 'number-sections', 'csl'] as const;
const MAX_REMEMBERED = 200;

/** Text of the files included, by key, from the last `prepare`. */
const includeTexts = new Map<string, string>();
/** The bibliography hrefs (relative to the document) the last project named. */
let projectBibliographies: string[] = [];

function dirParts(path: string): string[] {
  const parts = path.split('/');
  parts.pop();
  return parts;
}

/** `target` (absolute) as a path relative to the folder of `from` (absolute). */
function relativeTo(from: string, target: string): string {
  const base = dirParts(from).filter((part) => part !== '');
  const goal = target.split('/').filter((part) => part !== '');
  let common = 0;
  while (common < base.length && common < goal.length - 1 && base[common] === goal[common]) {
    common++;
  }
  return [...Array(base.length - common).fill('..'), ...goal.slice(common)].join('/');
}

/** An absolute path from the folder of `file` and an href (`../a.bib`) written next to it. */
function joinFromFile(file: string, href: string): string {
  if (href.startsWith('/')) return href;
  const parts = dirParts(file).filter((part) => part !== '');
  for (const part of href.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

function parseProject(project: ContextInputs['project']): Record<string, unknown> {
  if (!project) return {};
  try {
    const data = load(project.text, { json: true, maxAliases: 20 });
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return {};
    const picked: Record<string, unknown> = {};
    for (const key of PROJECT_KEYS) {
      if (Object.hasOwn(data, key)) picked[key] = (data as Record<string, unknown>)[key];
    }
    return picked;
  } catch {
    return {};
  }
}

/** The document's metadata with what the project supplies where the document says nothing. */
export function mergeProject(
  metadata: Record<string, unknown>,
  inputs: ContextInputs,
): Record<string, unknown> {
  if (!inputs.project) return metadata;
  const project = parseProject(inputs.project);
  const merged = { ...metadata };
  for (const key of PROJECT_KEYS) {
    if (Object.hasOwn(metadata, key) || !Object.hasOwn(project, key)) continue;
    let value = project[key];
    if (key === 'bibliography' && inputs.path !== null) {
      // The project's hrefs are relative to the project file; the shell reads from the document.
      const items = Array.isArray(value) ? value : [value];
      value = items.map((item) =>
        typeof item === 'string'
          ? relativeTo(inputs.path as string, joinFromFile(inputs.project?.path ?? '', item))
          : item,
      );
    }
    merged[key] = value;
  }
  return merged;
}

/** The bibliography hrefs a metadata names. */
export function bibliographyHrefs(metadata: Record<string, unknown>): string[] {
  const value = metadata.bibliography;
  return (Array.isArray(value) ? value : [value])
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .map((item) => item.trim());
}

/**
 * The files the document includes, with the files they include in turn (up to the nesting
 * limit): keys to hrefs as the shell takes them.
 */
function collectIncludes(source: string, textOf: (key: string) => string | undefined): string[] {
  const keys: string[] = [];
  const visit = (text: string, parent: string, depth: number) => {
    if (depth > MAX_INCLUDE_DEPTH) return;
    for (const href of includeHrefs(text)) {
      const key = resolveIncludeKey(parent, href);
      if (key === '' || keys.includes(key)) continue;
      keys.push(key);
      const inner = textOf(key);
      if (inner !== undefined) visit(inner, key, depth + 1);
    }
  };
  visit(source, '', 1);
  return keys;
}

export function needsQuarto(source: string, pandocNeeds: ContextNeeds): ContextNeeds {
  const includes = collectIncludes(source, (key) => includeTexts.get(key));
  const bibliographies = [...pandocNeeds.bibliographies];
  for (const href of projectBibliographies) {
    if (!bibliographies.includes(href)) bibliographies.push(href);
  }
  return { bibliographies, includes, vault: false, project: true };
}

export interface QuartoContextParts {
  metadata: Record<string, unknown>;
  labels: Map<string, Label>;
  includes: Map<string, string>;
  signature: string;
}

/** The pieces of the context that are Quarto's: merged metadata, labels, included texts. */
export function prepareQuarto(
  source: string,
  inputs: ContextInputs,
  pandoc: Pick<DocContext, 'metadata' | 'labels' | 'signature'>,
): QuartoContextParts {
  const metadata = mergeProject(pandoc.metadata, inputs);
  if (inputs.project) {
    const named = bibliographyHrefs(metadata);
    projectBibliographies = Object.hasOwn(pandoc.metadata, 'bibliography') ? [] : named;
  } else {
    projectBibliographies = [];
  }

  // The included files that arrived, found from the document outward.
  for (const [key, file] of inputs.includes) {
    if (file) {
      includeTexts.set(key, file.text);
      if (includeTexts.size > MAX_REMEMBERED) {
        includeTexts.delete(includeTexts.keys().next().value as string);
      }
    }
  }
  const includes = new Map<string, string>();
  for (const key of collectIncludes(source, (name) => inputs.includes.get(name)?.text)) {
    const text = inputs.includes.get(key)?.text;
    if (text !== undefined) includes.set(key, text);
  }

  const options = crossrefOptions(metadata);
  const lines = source.split(/\r\n?|\n/);
  const expanded = expandIncludes(lines, (name) => inputs.includes.get(name)?.text);
  const found = scanLabels(expanded.lines, options.numberSections, expanded.origin);
  const labels = new Map(pandoc.labels);
  for (const [key, label] of found) labels.set(key, label);

  const signature = hashString(
    JSON.stringify([
      pandoc.signature,
      [...found].map(([key, label]) => [key, label.number, label.text]),
      options,
      [...includes].map(([key, text]) => [key, hashString(text)]),
    ]),
  );
  return { metadata, labels, includes, signature };
}

/** The `@fig-` style references, blanked out, so that they are not read as citations. */
const XREF = /@[A-Za-z]{2,4}-[\w:.-]*\w/g;

export function withoutCrossReferences(source: string): string {
  if (!source.includes('@')) return source;
  return source.replace(XREF, (all) =>
    /^@(?:fig|tbl|sec|eq|lst)-/i.test(all) ? ' '.repeat(all.length) : all,
  );
}

/** The labels a completion offers: Quarto style keys, with a short description. */
export function labelCompletions(
  labels: ReadonlyMap<string, Label>,
  options: ReturnType<typeof crossrefOptions>,
): Array<{ key: string; label: string }> {
  const out: Array<{ key: string; label: string }> = [];
  for (const [key, label] of labels) {
    if (!/^(?:fig|tbl|sec|eq|lst)-/.test(key)) continue;
    const word = options.title[label.kind as keyof typeof options.title] ?? '';
    const head =
      label.kind === 'sec' && label.number === '' ? '' : `${word} ${label.number}`.trim();
    out.push({ key, label: [head, label.text].filter((part) => part !== '').join(': ') });
  }
  return out;
}
